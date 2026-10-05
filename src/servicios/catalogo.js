import { transaccion } from '../db/index.js';
import { TIPOS_ESPACIO } from '../db/semilla.js';
import { reglas, validar } from '../lib/validar.js';
import { ErrorApi, noEncontrado } from '../lib/errores.js';
import { normalizar } from '../lib/texto.js';

const { texto, color, enumerado, listaIds } = reglas;

// ── Plantas y espacios ───────────────────────────────────────────────────

export function listarPlantas(db) {
  return db.prepare('SELECT * FROM plantas ORDER BY orden DESC').all();
}

export function listarEspacios(db) {
  const espacios = db.prepare(`
    SELECT e.*, p.codigo AS planta_codigo, p.nombre AS planta_nombre,
           (SELECT COUNT(*) FROM articulos a WHERE a.espacio_id = e.id AND a.estado <> 'baja') AS articulos
    FROM espacios e JOIN plantas p ON p.id = e.planta_id
    ORDER BY p.orden DESC, e.codigo`).all();
  const relaciones = db.prepare('SELECT espacio_id, familia_id FROM espacio_familias').all();
  return espacios.map((e) => ({
    ...e,
    familia_ids: relaciones.filter((r) => r.espacio_id === e.id).map((r) => r.familia_id),
  }));
}

export function obtenerEspacio(db, id) {
  const e = listarEspacios(db).find((x) => x.id === id);
  if (!e) throw noEncontrado('Espacio');
  return e;
}

const ESQUEMA_ESPACIO = {
  nombre: texto({ requerido: true, max: 120 }),
  tipo: enumerado(Object.keys(TIPOS_ESPACIO), { requerido: true }),
  grupos: texto({ max: 1000 }),
  notas: texto({ max: 2000 }),
  familia_ids: listaIds(),
};

// La geometría del plano no se edita desde aquí: solo los datos descriptivos.
export function actualizarEspacio(db, id, entrada) {
  const datos = validar(ESQUEMA_ESPACIO, entrada, { parcial: true });
  return transaccion(db, () => {
    obtenerEspacio(db, id);
    const { familia_ids: familias, ...campos } = datos;
    if (Object.keys(campos).length) {
      const sets = Object.keys(campos).map((c) => `${c} = :${c}`).join(', ');
      db.prepare(`UPDATE espacios SET ${sets} WHERE id = :id`).run({ ...campos, id });
    }
    if (familias) {
      const existentes = new Set(db.prepare('SELECT id FROM familias').all().map((f) => f.id));
      if (familias.some((f) => !existentes.has(f))) throw new ErrorApi(400, 'Hay datos no válidos', { familia_ids: 'Alguna familia no existe' });
      db.prepare('DELETE FROM espacio_familias WHERE espacio_id = ?').run(id);
      const ins = db.prepare('INSERT INTO espacio_familias (espacio_id, familia_id) VALUES (?, ?)');
      for (const f of familias) ins.run(id, f);
    }
    return obtenerEspacio(db, id);
  });
}

// ── Familias ─────────────────────────────────────────────────────────────

export function listarFamilias(db) {
  return db.prepare(`
    SELECT f.id, f.codigo, f.nombre, f.color, (f.acceso_token IS NOT NULL) AS acceso_activo,
           COUNT(a.id) AS articulos,
           COALESCE(SUM(a.cantidad), 0) AS unidades,
           COALESCE(SUM(a.cantidad * a.valor), 0) AS valor,
           COUNT(DISTINCT a.espacio_id) AS espacios
    FROM familias f
    LEFT JOIN articulos a ON a.familia_id = f.id AND a.estado <> 'baja'
    GROUP BY f.id
    ORDER BY f.nombre`).all();
}

const ESQUEMA_FAMILIA = {
  codigo: (v) => {
    const r = texto({ requerido: true, max: 5 })(v);
    if (r.error) return r;
    const c = r.valor.toUpperCase();
    return /^[A-Z]{2,5}$/.test(c) ? { valor: c } : { error: 'De 2 a 5 letras sin tildes (ej. SAN)' };
  },
  nombre: texto({ requerido: true, max: 120 }),
  color: color(),
};

function comprobarUnicidadFamilia(db, datos, id = 0) {
  if (datos.codigo && db.prepare('SELECT 1 FROM familias WHERE codigo = ? AND id <> ?').get(datos.codigo, id)) {
    throw new ErrorApi(409, 'Ya existe una familia con ese código', { codigo: 'Código repetido' });
  }
  if (datos.nombre) {
    const repetida = db.prepare('SELECT id, nombre FROM familias WHERE id <> ?').all(id)
      .some((f) => normalizar(f.nombre) === normalizar(datos.nombre));
    if (repetida) throw new ErrorApi(409, 'Ya existe una familia con ese nombre', { nombre: 'Nombre repetido' });
  }
}

export function crearFamilia(db, entrada) {
  const datos = validar(ESQUEMA_FAMILIA, entrada);
  return transaccion(db, () => {
    comprobarUnicidadFamilia(db, datos);
    const { lastInsertRowid } = db.prepare('INSERT INTO familias (codigo, nombre, color) VALUES (?, ?, ?)')
      .run(datos.codigo, datos.nombre, datos.color);
    return listarFamilias(db).find((f) => f.id === Number(lastInsertRowid));
  });
}

// El código no es editable: forma parte de las etiquetas ya impresas.
export function actualizarFamilia(db, id, entrada) {
  const { nombre, color: col } = ESQUEMA_FAMILIA;
  const datos = validar({ nombre, color: col }, entrada, { parcial: true });
  return transaccion(db, () => {
    if (!db.prepare('SELECT 1 FROM familias WHERE id = ?').get(id)) throw noEncontrado('Familia');
    comprobarUnicidadFamilia(db, datos, id);
    if (Object.keys(datos).length) {
      const sets = Object.keys(datos).map((c) => `${c} = :${c}`).join(', ');
      db.prepare(`UPDATE familias SET ${sets} WHERE id = :id`).run({ ...datos, id });
    }
    return listarFamilias(db).find((f) => f.id === id);
  });
}

// ── Categorías ───────────────────────────────────────────────────────────

export function listarCategorias(db) {
  return db.prepare(`
    SELECT c.id, c.nombre, COUNT(a.id) AS articulos
    FROM categorias c LEFT JOIN articulos a ON a.categoria_id = c.id AND a.estado <> 'baja'
    GROUP BY c.id ORDER BY c.nombre`).all();
}

function buscarCategoriaPorNombre(db, nombre, excluirId = 0) {
  return db.prepare('SELECT id, nombre FROM categorias WHERE id <> ?').all(excluirId)
    .find((c) => normalizar(c.nombre) === normalizar(nombre));
}

// Devuelve el id de la categoría con ese nombre y, si no existe, la crea: así
// las categorías nacen al escribirlas y quedan guardadas para elegirlas luego.
// Sin distinguir mayúsculas ni tildes: "material sanitario" encuentra "Material sanitario".
export function resolverCategoria(db, nombre) {
  const existente = buscarCategoriaPorNombre(db, nombre);
  if (existente) return existente.id;
  return Number(db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(nombre).lastInsertRowid);
}

export function crearCategoria(db, entrada) {
  const { nombre } = validar({ nombre: texto({ requerido: true, max: 80 }) }, entrada);
  if (buscarCategoriaPorNombre(db, nombre)) throw new ErrorApi(409, 'Ya existe esa categoría', { nombre: 'Nombre repetido' });
  const { lastInsertRowid } = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(nombre);
  return listarCategorias(db).find((c) => c.id === Number(lastInsertRowid));
}

export function renombrarCategoria(db, id, entrada) {
  const { nombre } = validar({ nombre: texto({ requerido: true, max: 80 }) }, entrada);
  if (!db.prepare('SELECT 1 FROM categorias WHERE id = ?').get(id)) throw noEncontrado('Categoría');
  if (buscarCategoriaPorNombre(db, nombre, id)) throw new ErrorApi(409, 'Ya existe esa categoría', { nombre: 'Nombre repetido' });
  db.prepare('UPDATE categorias SET nombre = ? WHERE id = ?').run(nombre, id);
  return listarCategorias(db).find((c) => c.id === id);
}

// Los artículos de la categoría borrada quedan "sin categoría".
export function eliminarCategoria(db, id) {
  const { changes } = db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
  if (!changes) throw noEncontrado('Categoría');
}

export { buscarCategoriaPorNombre, TIPOS_ESPACIO };
