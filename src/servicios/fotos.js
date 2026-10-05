import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorApi, datosNoValidos } from '../lib/errores.js';
import { ahora } from '../lib/texto.js';

// Fotos de los artículos. Garantías, independientemente de lo que mande el cliente:
//  · solo imágenes de una lista cerrada de formatos (nunca SVG);
//  · se reducen a LADO_MAX px y se recodifican en WebP con un tope de peso;
//  · se descartan los metadatos (EXIF: ubicación GPS, modelo del móvil…);
//  · se genera una miniatura;
//  · hay un tope global de espacio.

export const LIMITES = {
  subidaMax: 8 * 1024 * 1024,   // lo máximo que se acepta recibir
  pixelesMax: 50_000_000,       // protege de "bombas de descompresión"
  ladoMax: 1280,
  ladoMiniatura: 320,
  bytesMax: 300 * 1024,         // peso máximo de la foto ya procesada
};
const FORMATOS_ADMITIDOS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);
// Intentos de más a menos calidad hasta cumplir el tope de peso.
const INTENTOS = [
  { lado: 1280, calidad: 72 }, { lado: 1280, calidad: 60 }, { lado: 1100, calidad: 52 },
  { lado: 960, calidad: 45 }, { lado: 720, calidad: 40 },
];

const ID = /^[a-f0-9]{32}$/;
export const esIdFoto = (v) => typeof v === 'string' && ID.test(v);

export const cuotaMaxBytes = () => Math.round((Number(process.env.FOTOS_MAX_MB) || 3000) * 1024 * 1024);

let sharpCargado;
async function obtenerSharp() {
  // Carga perezosa: solo se paga el arranque de sharp cuando hay una foto.
  sharpCargado ??= import('sharp').then(({ default: sharp }) => {
    sharp.cache({ items: 8 });
    sharp.concurrency(2);
    return sharp;
  });
  return sharpCargado;
}

async function recodificar(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ErrorApi(400, 'No se ha recibido ninguna imagen. Envía la foto como cuerpo de la petición (image/jpeg, image/png…).');
  }
  const sharp = await obtenerSharp();
  const opciones = { limitInputPixels: LIMITES.pixelesMax, failOn: 'error' };

  let meta;
  try {
    meta = await sharp(buffer, opciones).metadata();
  } catch {
    throw new ErrorApi(400, 'El fichero no es una imagen válida. Prueba con otra foto.');
  }
  if (!FORMATOS_ADMITIDOS.has(meta.format)) {
    throw new ErrorApi(400, 'Formato de imagen no admitido. Usa una foto JPG, PNG o WebP.');
  }

  let principal;
  try {
    for (const { lado, calidad } of INTENTOS) {
      principal = await sharp(buffer, opciones)
        .rotate()                                   // respeta la orientación del móvil
        .flatten({ background: '#ffffff' })         // PNG transparentes sobre blanco
        .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: calidad, effort: 4 })      // sin metadatos: sharp no los conserva por defecto
        .toBuffer({ resolveWithObject: true });
      if (principal.data.length <= LIMITES.bytesMax) break;
    }
  } catch {
    throw new ErrorApi(400, 'No se ha podido procesar la foto. Prueba con otra.');
  }
  if (principal.data.length > LIMITES.bytesMax) {
    throw new ErrorApi(400, 'La foto no se puede reducir lo suficiente. Prueba con otra.');
  }

  const miniatura = await sharp(principal.data)
    .resize({ width: LIMITES.ladoMiniatura, height: LIMITES.ladoMiniatura, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 66, effort: 4 })
    .toBuffer();

  return { principal: principal.data, miniatura, ancho: principal.info.width, alto: principal.info.height };
}

export const rutaFoto = (dir, id, miniatura = false) => join(dir, `${id}${miniatura ? '-m' : ''}.webp`);

export function usoFotos(db) {
  const { fotos, bytes } = db.prepare(
    'SELECT COUNT(*) AS fotos, COALESCE(SUM(bytes + bytes_miniatura), 0) AS bytes FROM fotos').get();
  return { fotos, bytes, max: cuotaMaxBytes() };
}

// Procesa y guarda una foto (queda sin asociar a ningún artículo hasta que se
// use en un alta o edición). Devuelve su identificador.
export async function guardarFoto(db, dir, buffer, { origen, usuario = '' }) {
  if (!dir) throw new ErrorApi(503, 'Las fotos no están configuradas en este servidor.');
  const { principal, miniatura, ancho, alto } = await recodificar(buffer);

  const uso = usoFotos(db);
  if (uso.bytes + principal.length + miniatura.length > uso.max) {
    throw new ErrorApi(507, 'Se ha alcanzado el límite de espacio para fotos. Avisa al profesorado.');
  }

  const id = randomBytes(16).toString('hex');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(rutaFoto(dir, id), principal);
    writeFileSync(rutaFoto(dir, id, true), miniatura);
    db.prepare(`INSERT INTO fotos (id, bytes, bytes_miniatura, ancho, alto, origen, usuario, creada_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, principal.length, miniatura.length, ancho, alto, origen, usuario, ahora());
  } catch (err) {
    rmSync(rutaFoto(dir, id), { force: true });
    rmSync(rutaFoto(dir, id, true), { force: true });
    throw err;
  }
  return { id, bytes: principal.length, ancho, alto };
}

// Una foto solo se puede asociar a un artículo si existe y no está ya en
// otro (así nadie puede "robar" la foto de otro artículo).
export function comprobarAsociable(db, fotoId, articuloId = 0) {
  if (!db.prepare('SELECT 1 FROM fotos WHERE id = ?').get(fotoId)) {
    throw datosNoValidos({ foto_id: 'La foto no existe o ha caducado. Súbela de nuevo.' });
  }
  if (db.prepare('SELECT 1 FROM articulos WHERE foto_id = ? AND id <> ?').get(fotoId, articuloId)) {
    throw datosNoValidos({ foto_id: 'Esa foto ya pertenece a otro artículo.' });
  }
}

// Borra las fotos que ningún artículo usa. Las subidas recientes (todavía sin
// asociar) se respetan durante `gracia` ms. También retira ficheros sueltos
// sin registro (restos de un fallo a medias).
export function purgarHuerfanas(db, dir, { gracia = 60 * 60_000 } = {}) {
  if (!dir) return { fotos: 0, ficheros: 0 };
  const limite = new Date(Date.now() - gracia).toISOString();
  const huerfanas = db.prepare(`
    SELECT id FROM fotos
    WHERE creada_en < ? AND id NOT IN (SELECT foto_id FROM articulos WHERE foto_id IS NOT NULL)`).all(limite);
  for (const { id } of huerfanas) {
    db.prepare('DELETE FROM fotos WHERE id = ?').run(id);
    rmSync(rutaFoto(dir, id), { force: true });
    rmSync(rutaFoto(dir, id, true), { force: true });
  }

  let ficheros = 0;
  let entradas = [];
  try { entradas = readdirSync(dir); } catch { /* la carpeta aún no existe */ }
  if (entradas.length) {
    const conocidas = new Set(db.prepare('SELECT id FROM fotos').all().map((f) => f.id));
    for (const nombre of entradas) {
      const m = /^([a-f0-9]{32})(-m)?\.webp$/.exec(nombre);
      if (!m || conocidas.has(m[1])) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).mtimeMs < Date.now() - gracia) { rmSync(ruta, { force: true }); ficheros++; }
    }
  }
  return { fotos: huerfanas.length, ficheros };
}
