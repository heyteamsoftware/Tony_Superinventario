import { randomBytes } from 'node:crypto';
import { reglas, validar } from '../lib/validar.js';
import { ErrorApi, noEncontrado, datosNoValidos } from '../lib/errores.js';
import { crearLimitador } from '../lib/limitador.js';
import { crear, ESTADOS_ACTIVOS, reglaFoto } from './articulos.js';
import { listarCategorias } from './catalogo.js';

// Acceso del alumnado por QR: cada familia tiene un token secreto. Con él solo
// se puede ver el formulario de alta (aulas y categorías) y AÑADIR material de
// esa familia. No hay lectura, edición, traslado ni borrado del inventario.

const { texto, entero, enumerado } = reglas;

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// Tope de altas por token: si un QR se filtra, limita cuánto se puede ensuciar
// el inventario hasta que alguien lo revoque. Se cuenta por token y no por IP
// porque todo el centro sale por la misma IP. No hay límite de intentos con
// tokens erróneos a propósito: con 144 bits adivinar uno es inviable y un
// bloqueo por IP dejaría sin acceso a toda la clase si un alumno trasteara.
export const limites = {
  altas: crearLimitador({ ventanaMs: 10 * 60_000, max: 200 }),
  fotos: crearLimitador({ ventanaMs: 10 * 60_000, max: 200 }),
};
setInterval(() => { limites.altas.limpiar(); limites.fotos.limpiar(); }, 10 * 60_000).unref();

// ── Gestión del token (lado profesorado) ─────────────────────────────────

function familiaExiste(db, id) {
  const f = db.prepare('SELECT id, codigo, nombre, color, acceso_token FROM familias WHERE id = ?').get(id);
  if (!f) throw noEncontrado('Familia');
  return f;
}

export function estadoAcceso(db, familiaId) {
  const f = familiaExiste(db, familiaId);
  return { familia_id: f.id, activo: f.acceso_token !== null, token: f.acceso_token };
}

// Genera un token nuevo. Si ya había uno, el anterior deja de funcionar.
export function generarAcceso(db, familiaId) {
  familiaExiste(db, familiaId);
  const token = randomBytes(18).toString('base64url'); // 144 bits
  db.prepare('UPDATE familias SET acceso_token = ? WHERE id = ?').run(token, familiaId);
  return estadoAcceso(db, familiaId);
}

export function revocarAcceso(db, familiaId) {
  familiaExiste(db, familiaId);
  db.prepare('UPDATE familias SET acceso_token = NULL WHERE id = ?').run(familiaId);
}

// ── Lado alumnado ────────────────────────────────────────────────────────

export function familiaPorToken(db, token) {
  if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) return null;
  return db.prepare('SELECT id, codigo, nombre, color FROM familias WHERE acceso_token = ?').get(token) ?? null;
}

// Datos para pintar el formulario: solo lo necesario para dar de alta.
export function datosFormulario(db, familia) {
  const habituales = new Set(db.prepare('SELECT espacio_id FROM espacio_familias WHERE familia_id = ?').all(familia.id).map((r) => r.espacio_id));
  const espacios = db.prepare(`
    SELECT e.id, e.codigo, e.nombre, p.nombre AS planta
    FROM espacios e JOIN plantas p ON p.id = e.planta_id
    ORDER BY p.orden DESC, e.codigo`).all()
    .map((e) => ({ ...e, habitual: habituales.has(e.id) }));
  return {
    familia: { codigo: familia.codigo, nombre: familia.nombre, color: familia.color },
    espacios,
    categorias: listarCategorias(db).map((c) => c.nombre),
    estados: ESTADOS_ACTIVOS,
  };
}

const ESQUEMA_ALTA = {
  alumno: texto({ requerido: true, max: 60 }),
  nombre: texto({ requerido: true, max: 200 }),
  espacio_id: entero({ requerido: true, min: 1 }),
  cantidad: entero({ min: 1, max: 9999 }),
  estado: enumerado(ESTADOS_ACTIVOS),
  categoria: texto({ max: 80 }),
  ubicacion_detalle: texto({ max: 200 }),
  marca: texto({ max: 200 }),
  modelo: texto({ max: 200 }),
  numero_serie: texto({ max: 200 }),
  observaciones: texto({ max: 1000 }),
  foto_id: reglaFoto(),
};

// Alta de material. La familia sale SIEMPRE del token; se ignora cualquier
// otro campo que venga en la petición (valor, proveedor, familia, etc.).
export function altaAlumno(db, familia, entrada) {
  const { alumno, ...datos } = validar(ESQUEMA_ALTA, entrada);
  // Solo puede usar una foto que se subió con el QR de esta misma familia.
  if (datos.foto_id) {
    const foto = db.prepare('SELECT origen FROM fotos WHERE id = ?').get(datos.foto_id);
    if (foto?.origen !== `qr:${familia.codigo}`) throw datosNoValidos({ foto_id: 'La foto no es válida. Súbela de nuevo.' });
  }
  const art = crear(db, { ...datos, familia_id: familia.id }, `${alumno} (QR)`, { detalleAlta: { via: 'qr' } });
  return {
    id: art.id,
    codigo: art.codigo,
    nombre: art.nombre,
    cantidad: art.cantidad,
    espacio_codigo: art.espacio_codigo,
    espacio_nombre: art.espacio_nombre,
    categoria: art.categoria_nombre,
  };
}

export function demasiadasPeticiones() {
  return new ErrorApi(429, 'Demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.');
}
