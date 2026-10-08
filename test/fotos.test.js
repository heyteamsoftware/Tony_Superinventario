import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { arrancar } from './ayuda.js';
import { LIMITES, purgarHuerfanas, rutaFoto } from '../src/servicios/fotos.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

// ── Imágenes de prueba ─────────────────────────────────────────────────────
// Foto "de cámara": grande y con mucho ruido (lo peor para comprimir).
const fotoGrande = (ancho = 3000, alto = 2250) => sharp({
  create: { width: ancho, height: alto, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 55 } },
}).jpeg({ quality: 85 }).toBuffer();

const fotoSencilla = (ancho = 640, alto = 480, color = '#3b82f6') => sharp({
  create: { width: ancho, height: alto, channels: 3, background: color },
}).jpeg().toBuffer();

// PNG que solo declara unas dimensiones enormes (sin datos): para comprobar que
// no se intenta decodificar.
function pngBomba(ancho, alto) {
  const trozo = (tipo, datos) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IEND', Buffer.alloc(0))]);
}

const nuevo = (extra = {}) => ({ nombre: 'Microscopio', familia_id: app.familia('SAN'), espacio_id: app.espacio('P1-04'), ...extra });
const subirFoto = async (imagen = null) => (await app.subir('/api/fotos', imagen ?? await fotoSencilla())).body;
const envejecer = (id) => app.db.prepare("UPDATE fotos SET creada_en = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
const ficheros = () => readdirSync(app.dirFotos);

describe('procesado de la foto (lo que garantiza el servidor)', () => {
  test('una foto de cámara pesada se reduce a un tamaño pequeño', async () => {
    const original = await fotoGrande();
    assert.ok(original.length > 1_000_000, `la foto de prueba debe ser pesada (${original.length} bytes)`);

    const r = await app.subir('/api/fotos', original);
    assert.equal(r.status, 201);
    assert.match(r.body.id, /^[a-f0-9]{32}$/);
    assert.ok(r.body.bytes <= LIMITES.bytesMax, `${r.body.bytes} bytes supera el tope de ${LIMITES.bytesMax}`);
    assert.ok(r.body.bytes < original.length / 8, 'debe pesar una fracción de la original');
    assert.ok(Math.max(r.body.ancho, r.body.alto) <= LIMITES.ladoMax);

    const guardada = sharp(join(app.dirFotos, `${r.body.id}.webp`));
    const meta = await guardada.metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, r.body.ancho);
    const mini = await sharp(join(app.dirFotos, `${r.body.id}-m.webp`)).metadata();
    assert.ok(Math.max(mini.width, mini.height) <= LIMITES.ladoMiniatura);
    assert.ok(readdirSync(app.dirFotos).includes(`${r.body.id}-m.webp`));
  });

  test('una foto pequeña no se agranda y mantiene su proporción', async () => {
    const r = (await app.subir('/api/fotos', await fotoSencilla(400, 300))).body;
    assert.deepEqual([r.ancho, r.alto], [400, 300]);
    const grande = (await app.subir('/api/fotos', await fotoSencilla(2600, 1300))).body;
    assert.deepEqual([grande.ancho, grande.alto], [1280, 640]);
  });

  test('se descartan los metadatos EXIF (ubicación, modelo del móvil…)', async () => {
    const conExif = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#aa3344' } })
      .jpeg().withExif({ IFD0: { ImageDescription: 'ubicacion-secreta', Make: 'MovilDePrueba' } }).toBuffer();
    assert.ok((await sharp(conExif).metadata()).exif, 'la imagen de partida debe llevar EXIF');
    const r = (await app.subir('/api/fotos', conExif)).body;
    const salida = await sharp(join(app.dirFotos, `${r.id}.webp`)).metadata();
    assert.equal(salida.exif, undefined);
    const crudo = (await import('node:fs')).readFileSync(join(app.dirFotos, `${r.id}.webp`));
    assert.ok(!crudo.includes('ubicacion-secreta') && !crudo.includes('MovilDePrueba'));
  });

  test('respeta la orientación del móvil (la foto sale derecha)', async () => {
    // 200x100 marcada como "girar 90º": debe quedar 100x200.
    const girada = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#22aa66' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const r = (await app.subir('/api/fotos', girada)).body;
    assert.deepEqual([r.ancho, r.alto], [100, 200]);
  });

  test('un PNG con transparencia se aplana sobre blanco', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = (await app.subir('/api/fotos', png, 'image/png')).body;
    const { data } = await sharp(join(app.dirFotos, `${r.id}.webp`)).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240, 'el fondo transparente debe quedar blanco');
  });
});

describe('qué se rechaza', () => {
  test('SVG y otros formatos fuera de la lista', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const r = await app.subir('/api/fotos', svg, 'image/svg+xml');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no admitido/);
    const tiff = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).tiff().toBuffer();
    assert.equal((await app.subir('/api/fotos', tiff, 'image/tiff')).status, 400);
  });

  test('ficheros que no son imágenes aunque digan serlo', async () => {
    const falso = await app.subir('/api/fotos', Buffer.from('esto no es una imagen, es texto'), 'image/jpeg');
    assert.equal(falso.status, 400);
    assert.match(falso.body.error, /no es una imagen válida/);
    const texto = await app.subir('/api/fotos', Buffer.from('hola'), 'text/plain');
    assert.equal(texto.status, 400);
    assert.match(texto.body.error, /No se ha recibido ninguna imagen/);
    const vacio = await app.subir('/api/fotos', Buffer.alloc(0), 'image/jpeg');
    assert.equal(vacio.status, 400);
  });

  test('subidas de más de 8 MB', async () => {
    const r = await app.subir('/api/fotos', Buffer.alloc(LIMITES.subidaMax + 1024, 1), 'image/jpeg');
    assert.equal(r.status, 413);
  });

  test('imágenes con un número absurdo de píxeles (bomba de descompresión)', async () => {
    const r = await app.subir('/api/fotos', pngBomba(30000, 30000), 'image/png');
    assert.equal(r.status, 400);
  });

  test('no queda nada en disco ni en la base de datos tras un rechazo', async () => {
    const antes = [ficheros().length, app.db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n];
    await app.subir('/api/fotos', Buffer.from('basura'), 'image/jpeg');
    assert.deepEqual([ficheros().length, app.db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n], antes);
  });
});

describe('asociar la foto a un artículo', () => {
  test('alta con foto, y la foto se sirve con caché larga', async () => {
    const foto = await subirFoto();
    const r = await app.post('/api/articulos', nuevo({ foto_id: foto.id }));
    assert.equal(r.status, 201);
    assert.equal(r.body.foto_id, foto.id);

    const completa = await app.get(`/api/fotos/${foto.id}`, { crudo: true });
    assert.equal(completa.status, 200);
    assert.equal(completa.headers.get('content-type'), 'image/webp');
    assert.match(completa.headers.get('cache-control'), /max-age=31536000.*immutable/);
    assert.equal((await completa.arrayBuffer()).byteLength, foto.bytes);

    const mini = await app.get(`/api/fotos/${foto.id}/miniatura`, { crudo: true });
    assert.equal(mini.status, 200);
    assert.ok((await mini.arrayBuffer()).byteLength < foto.bytes);
  });

  test('identificadores no válidos o inexistentes dan 404 (sin recorrer carpetas)', async () => {
    // Se piden con "crudo" porque algunas ya llegan normalizadas por el cliente HTTP.
    for (const id of ['abc', '../../etc/passwd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '..%5c..%5cwindows', 'g'.repeat(32), 'a'.repeat(32)]) {
      assert.equal((await app.get(`/api/fotos/${id}`, { crudo: true })).status, 404, id);
      assert.equal((await app.get(`/api/fotos/${id}/miniatura`, { crudo: true })).status, 404, id);
    }
  });

  test('foto inexistente, mal formada o ya usada por otro artículo', async () => {
    const mal = await app.post('/api/articulos', nuevo({ foto_id: 'no-es-un-id' }));
    assert.equal(mal.status, 400);
    const falsa = await app.post('/api/articulos', nuevo({ foto_id: 'f'.repeat(32) }));
    assert.equal(falsa.status, 400);
    assert.match(falsa.body.detalles.foto_id, /no existe/);

    const foto = await subirFoto();
    assert.equal((await app.post('/api/articulos', nuevo({ foto_id: foto.id }))).status, 201);
    const repetida = await app.post('/api/articulos', nuevo({ nombre: 'Otro', foto_id: foto.id }));
    assert.equal(repetida.status, 400);
    assert.match(repetida.body.detalles.foto_id, /otro artículo/);
  });

  test('cambiar y quitar la foto en la edición, con rastro en el historial', async () => {
    const f1 = await subirFoto();
    const art = (await app.post('/api/articulos', nuevo({ foto_id: f1.id }))).body;
    const f2 = await subirFoto(await fotoSencilla(300, 300, '#ef4444'));

    const cambiada = (await app.patch(`/api/articulos/${art.id}`, { foto_id: f2.id })).body;
    assert.equal(cambiada.foto_id, f2.id);
    const quitada = (await app.patch(`/api/articulos/${art.id}`, { foto_id: null })).body;
    assert.equal(quitada.foto_id, null);
    // Sin tocar la foto, se conserva.
    await app.patch(`/api/articulos/${art.id}`, { foto_id: f2.id });
    assert.equal((await app.patch(`/api/articulos/${art.id}`, { nombre: 'Otro nombre' })).body.foto_id, f2.id);

    const cambios = (await app.get(`/api/articulos/${art.id}`)).body.movimientos
      .filter((m) => m.tipo === 'edicion' && m.detalle.cambios.foto).map((m) => m.detalle.cambios.foto);
    assert.deepEqual(cambios.map((c) => c.despues).sort(), ['con foto', 'foto nueva', 'sin foto']);
  });

  test('un artículo dividido en un traslado parcial comparte la foto', async () => {
    const foto = await subirFoto();
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Lotes', cantidad: 10, foto_id: foto.id }))).body;
    const r = (await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('P1-03'), cantidad: 4 })).body;
    assert.equal(r.nuevo.foto_id, foto.id);

    // Borrar uno no borra la foto mientras el otro la use.
    envejecer(foto.id);
    await app.del(`/api/articulos/${r.nuevo.id}`);
    assert.ok(existsSync(rutaFoto(app.dirFotos, foto.id)));
    await app.del(`/api/articulos/${art.id}`);
    assert.ok(!existsSync(rutaFoto(app.dirFotos, foto.id)), 'al borrar el último artículo se libera la foto');
  });
});

describe('limpieza de fotos huérfanas', () => {
  test('al borrar un artículo se libera su foto', async () => {
    const foto = await subirFoto();
    const art = (await app.post('/api/articulos', nuevo({ foto_id: foto.id }))).body;
    envejecer(foto.id);
    await app.del(`/api/articulos/${art.id}`);
    assert.ok(!existsSync(rutaFoto(app.dirFotos, foto.id)));
    assert.ok(!existsSync(rutaFoto(app.dirFotos, foto.id, true)));
    assert.equal(app.db.prepare('SELECT 1 FROM fotos WHERE id = ?').get(foto.id), undefined);
    assert.equal((await app.get(`/api/fotos/${foto.id}`)).status, 404);
  });

  test('al reemplazar o quitar la foto, la anterior se libera', async () => {
    const f1 = await subirFoto();
    const art = (await app.post('/api/articulos', nuevo({ foto_id: f1.id }))).body;
    envejecer(f1.id);
    await app.patch(`/api/articulos/${art.id}`, { foto_id: null });
    assert.ok(!existsSync(rutaFoto(app.dirFotos, f1.id)));
  });

  test('una foto recién subida y aún sin usar se respeta durante la hora de gracia', async () => {
    const reciente = await subirFoto();
    const antigua = await subirFoto();
    envejecer(antigua.id);
    const r = purgarHuerfanas(app.db, app.dirFotos);
    assert.ok(r.fotos >= 1);
    assert.ok(existsSync(rutaFoto(app.dirFotos, reciente.id)), 'la reciente se conserva');
    assert.ok(!existsSync(rutaFoto(app.dirFotos, antigua.id)), 'la antigua sin usar se borra');
  });

  test('retira ficheros sueltos sin registro, pero no los recientes', () => {
    const viejo = join(app.dirFotos, `${'a1'.repeat(16)}.webp`);
    const reciente = join(app.dirFotos, `${'b2'.repeat(16)}.webp`);
    const ajeno = join(app.dirFotos, 'notas.txt');
    for (const f of [viejo, reciente, ajeno]) writeFileSync(f, 'x');
    const hace2h = new Date(Date.now() - 2 * 3600_000);
    utimesSync(viejo, hace2h, hace2h);
    utimesSync(ajeno, hace2h, hace2h);
    const r = purgarHuerfanas(app.db, app.dirFotos);
    assert.equal(r.ficheros, 1);
    assert.ok(!existsSync(viejo) && existsSync(reciente), 'solo el antiguo');
    assert.ok(existsSync(ajeno), 'no toca ficheros que no son fotos');
  });
});

describe('espacio ocupado', () => {
  test('/fotos/uso resume cuántas hay y cuánto pesan', async () => {
    const uso = (await app.get('/api/fotos/uso')).body;
    const real = app.db.prepare('SELECT COUNT(*) AS n, SUM(bytes + bytes_miniatura) AS b FROM fotos').get();
    assert.equal(uso.fotos, real.n);
    assert.equal(uso.bytes, real.b);
    assert.equal(uso.max, 3000 * 1024 * 1024);
  });

  test('al alcanzar el tope global se rechazan las subidas nuevas', async () => {
    process.env.FOTOS_MAX_MB = '0.01'; // ~10 KB
    try {
      const antes = ficheros().length;
      const r = await app.subir('/api/fotos', await fotoSencilla());
      assert.equal(r.status, 507);
      assert.match(r.body.error, /límite de espacio/);
      assert.equal(ficheros().length, antes, 'no se deja ningún fichero');
      assert.equal((await app.get('/api/fotos/uso')).body.max, 10486);
    } finally {
      delete process.env.FOTOS_MAX_MB;
    }
  });
});

describe('fotos desde el QR de inventario móvil', () => {
  let token;
  let tokenOtra;
  before(async () => {
    token = (await app.post(`/api/familias/${app.familia('SAN')}/acceso`)).body.token;
    tokenOtra = (await app.post(`/api/familias/${app.familia('IMA')}/acceso`)).body.token;
  });
  const alta = (t, extra) => app.post(`/api/movil/${t}/articulos`, { persona: 'Lucía', nombre: 'Lupa', espacio_id: app.espacio('P1-04'), ...extra });

  test('sube una foto con el token y la usa en el alta', async () => {
    const original = await fotoGrande(2400, 1800);
    const f = await app.subir(`/api/movil/${token}/fotos`, original);
    assert.equal(f.status, 201);
    assert.ok(f.body.bytes <= LIMITES.bytesMax);
    assert.equal(app.db.prepare('SELECT origen FROM fotos WHERE id = ?').get(f.body.id).origen, 'qr:SAN');

    const r = await alta(token, { foto_id: f.body.id });
    assert.equal(r.status, 201);
    assert.equal((await app.get(`/api/articulos/${r.body.id}`)).body.foto_id, f.body.id);
  });

  test('no puede usar una foto subida con el QR de otra familia, ni una de la app', async () => {
    const deOtra = (await app.subir(`/api/movil/${tokenOtra}/fotos`, await fotoSencilla())).body;
    const r = await alta(token, { foto_id: deOtra.id });
    assert.equal(r.status, 400);
    assert.ok(r.body.detalles.foto_id);

    const deLaApp = await subirFoto();
    assert.equal((await alta(token, { foto_id: deLaApp.id })).status, 400);
    assert.equal((await alta(token, { foto_id: 'e'.repeat(32) })).status, 400);
  });

  test('misma validación que en la app: formato, tamaño y token', async () => {
    assert.equal((await app.subir(`/api/movil/${token}/fotos`, Buffer.from('no soy una foto'))).status, 400);
    assert.equal((await app.subir(`/api/movil/${token}/fotos`, Buffer.alloc(LIMITES.subidaMax + 1024, 1))).status, 413);
    assert.equal((await app.subir(`/api/movil/${'x'.repeat(24)}/fotos`, await fotoSencilla())).status, 404);
  });

  test('el tope de subidas por token devuelve 429', async () => {
    const { limites } = await import('../src/servicios/movil.js');
    const original = limites.fotos.intentar;
    let n = 0;
    limites.fotos.intentar = (clave) => (clave === token ? ++n <= 1 : original(clave));
    try {
      const imagen = await fotoSencilla(100, 100);
      assert.equal((await app.subir(`/api/movil/${token}/fotos`, imagen)).status, 201);
      const r = await app.subir(`/api/movil/${token}/fotos`, imagen);
      assert.equal(r.status, 429);
    } finally {
      limites.fotos.intentar = original;
    }
  });

  test('con un token revocado ya no se puede subir nada', async () => {
    const efimero = (await app.post(`/api/familias/${app.familia('COM')}/acceso`)).body.token;
    await app.del(`/api/familias/${app.familia('COM')}/acceso`);
    assert.equal((await app.subir(`/api/movil/${efimero}/fotos`, await fotoSencilla())).status, 404);
  });
});

describe('carpeta de fotos con ruta relativa', () => {
  test('se sirve igual aunque la configuración sea relativa al directorio actual', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { basename } = await import('node:path');
    const { abrirDb } = await import('../src/db/index.js');
    const { crearApp } = await import('../src/app.js');
    const absoluta = mkdtempSync(join(process.cwd(), '.tmp-fotos-'));
    const db = abrirDb(':memory:');
    const servidor = crearApp(db, { dirFotos: basename(absoluta) }).listen(0); // relativa: ".tmp-fotos-xxxx"
    await new Promise((r) => servidor.once('listening', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    try {
      const subida = await fetch(`${base}/api/fotos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: await fotoSencilla(200, 100) });
      assert.equal(subida.status, 201);
      const { id } = await subida.json();
      const res = await fetch(`${base}/api/fotos/${id}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/webp');
      assert.ok((await res.arrayBuffer()).byteLength > 100);
    } finally {
      await new Promise((r) => servidor.close(r));
      db.close();
      rmSync(absoluta, { recursive: true, force: true });
    }
  });
});

describe('migración: fotos', () => {
  test('el esquema nuevo tiene la tabla y la columna, y los artículos sin foto siguen igual', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Sin foto' }))).body;
    assert.equal(art.foto_id, null);
    assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, 6);
  });
});
