import { transaccion } from '../db/index.js';
import { reglas, validar } from '../lib/validar.js';
import { datosNoValidos, noEncontrado } from '../lib/errores.js';
import { ahora } from '../lib/texto.js';
import { listarFamilias } from './catalogo.js';

// Un "repaso" del inventario de una familia es cualquiera de estas cosas:
//   · una revisión registrada ("he comprobado el material y coincide"),
//   · un cambio real en su inventario (alta, baja, traslado, edición...).
// Si el último repaso es más antiguo que el plazo configurado, se avisa.

const DIA = 86_400_000;

export function obtenerAjustes(db) {
  const filas = db.prepare('SELECT clave, valor FROM ajustes').all();
  const a = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    dias_aviso_revision: Number(a.dias_aviso_revision ?? 365),
    dias_preaviso_revision: Number(a.dias_preaviso_revision ?? 30),
  };
}

export function actualizarAjustes(db, entrada) {
  const datos = validar({
    dias_aviso_revision: reglas.entero({ requerido: true, min: 7, max: 3650 }),
    dias_preaviso_revision: reglas.entero({ requerido: true, min: 0, max: 365 }),
  }, entrada, { parcial: true });
  const actual = { ...obtenerAjustes(db), ...datos };
  if (actual.dias_preaviso_revision >= actual.dias_aviso_revision) {
    throw datosNoValidos({ dias_preaviso_revision: 'El preaviso debe ser menor que el plazo' });
  }
  const guardar = db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(datos)) guardar.run(k, String(v));
  return obtenerAjustes(db);
}

// estado: 'al_dia' | 'pronto' (dentro del preaviso) | 'vencida' | 'nunca'
export function calcularEstado(fecha, ajustes, referencia = Date.now()) {
  if (!fecha) return { estado: 'nunca', dias: null, vence_en: null };
  const dias = Math.floor((referencia - Date.parse(fecha)) / DIA);
  const venceEn = ajustes.dias_aviso_revision - dias;
  let estado = 'al_dia';
  if (venceEn <= 0) estado = 'vencida';
  else if (venceEn <= ajustes.dias_preaviso_revision) estado = 'pronto';
  return { estado, dias, vence_en: venceEn };
}

const masReciente = (...fechas) => fechas.filter(Boolean).sort().at(-1) ?? null;

// Estado de revisión de cada familia, listo para pintar avisos.
export function familiasConRevision(db) {
  const ajustes = obtenerAjustes(db);
  const revisiones = new Map(db.prepare(`
    SELECT r.familia_id, r.fecha, r.usuario, r.espacio_id
    FROM revisiones r
    WHERE r.id = (SELECT r2.id FROM revisiones r2 WHERE r2.familia_id = r.familia_id ORDER BY r2.fecha DESC, r2.id DESC LIMIT 1)`)
    .all().map((r) => [r.familia_id, r]));
  const cambios = new Map(db.prepare(`
    SELECT m.familia_id, m.fecha, m.usuario, m.tipo
    FROM movimientos m
    WHERE m.id = (SELECT m2.id FROM movimientos m2 WHERE m2.familia_id = m.familia_id ORDER BY m2.fecha DESC, m2.id DESC LIMIT 1)`)
    .all().map((m) => [m.familia_id, m]));

  return listarFamilias(db).map((f) => {
    const rev = revisiones.get(f.id);
    const cam = cambios.get(f.id);
    const ultimo = masReciente(rev?.fecha, cam?.fecha);
    return {
      ...f,
      ultima_revision: rev ? { fecha: rev.fecha, usuario: rev.usuario, espacio_id: rev.espacio_id } : null,
      ultimo_cambio: cam ? { fecha: cam.fecha, usuario: cam.usuario, tipo: cam.tipo } : null,
      ultimo_repaso: ultimo,
      revision: calcularEstado(ultimo, ajustes),
    };
  });
}

// Estado de revisión de una familia en cada espacio donde tiene material o
// que tiene asignado como uso habitual. Una revisión de la familia completa
// cuenta para todos sus espacios.
export function espaciosDeFamilia(db, familiaId) {
  if (!db.prepare('SELECT 1 FROM familias WHERE id = ?').get(familiaId)) throw noEncontrado('Familia');
  const ajustes = obtenerAjustes(db);
  const filas = db.prepare(`
    WITH relevantes AS (
      SELECT espacio_id FROM articulos WHERE familia_id = :f AND estado <> 'baja'
      UNION SELECT espacio_id FROM espacio_familias WHERE familia_id = :f
      UNION SELECT espacio_id FROM revisiones WHERE familia_id = :f AND espacio_id IS NOT NULL
    )
    SELECT e.id AS espacio_id, e.codigo, e.nombre, p.nombre AS planta_nombre,
      (SELECT COUNT(*) FROM articulos a WHERE a.espacio_id = e.id AND a.familia_id = :f AND a.estado <> 'baja') AS articulos,
      (SELECT COALESCE(SUM(cantidad), 0) FROM articulos a WHERE a.espacio_id = e.id AND a.familia_id = :f AND a.estado <> 'baja') AS unidades,
      (SELECT MAX(fecha) FROM revisiones r WHERE r.familia_id = :f AND r.espacio_id = e.id) AS revision_espacio,
      (SELECT MAX(fecha) FROM revisiones r WHERE r.familia_id = :f AND r.espacio_id IS NULL) AS revision_familia,
      (SELECT MAX(fecha) FROM movimientos m WHERE m.familia_id = :f AND m.espacio_id = e.id) AS ultimo_cambio,
      (SELECT MIN(revisado_en) FROM articulos a WHERE a.espacio_id = e.id AND a.familia_id = :f AND a.estado <> 'baja') AS articulo_mas_antiguo
    FROM relevantes JOIN espacios e ON e.id = relevantes.espacio_id JOIN plantas p ON p.id = e.planta_id
    ORDER BY p.orden DESC, e.codigo`).all({ f: familiaId });

  return filas.map((e) => {
    const ultimo = masReciente(e.revision_espacio, e.revision_familia, e.ultimo_cambio);
    return { ...e, ultimo_repaso: ultimo, revision: calcularEstado(ultimo, ajustes) };
  });
}

export function registrarRevision(db, entrada, usuario) {
  const datos = validar({
    familia_id: reglas.entero({ requerido: true, min: 1 }),
    espacio_id: reglas.entero({ min: 1 }),
    notas: reglas.texto({ max: 2000 }),
  }, entrada);

  return transaccion(db, () => {
    if (!db.prepare('SELECT 1 FROM familias WHERE id = ?').get(datos.familia_id)) {
      throw datosNoValidos({ familia_id: 'La familia no existe' });
    }
    if (datos.espacio_id != null && !db.prepare('SELECT 1 FROM espacios WHERE id = ?').get(datos.espacio_id)) {
      throw datosNoValidos({ espacio_id: 'El espacio no existe' });
    }
    const momento = ahora();
    const ambito = `familia_id = :familia_id AND estado <> 'baja'${datos.espacio_id != null ? ' AND espacio_id = :espacio_id' : ''}`;
    const params = { familia_id: datos.familia_id, ...(datos.espacio_id != null && { espacio_id: datos.espacio_id }) };
    const { articulos, unidades } = db.prepare(`
      SELECT COUNT(*) AS articulos, COALESCE(SUM(cantidad), 0) AS unidades FROM articulos WHERE ${ambito}`).get(params);
    db.prepare(`UPDATE articulos SET revisado_en = :momento WHERE ${ambito}`).run({ ...params, momento });

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO revisiones (familia_id, espacio_id, articulos, unidades, notas, usuario, fecha)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      datos.familia_id, datos.espacio_id, articulos, unidades, datos.notas, usuario, momento,
    );
    return obtenerRevision(db, Number(lastInsertRowid));
  });
}

const SELECT_REVISION = `
  SELECT r.*, f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.color AS familia_color,
         e.codigo AS espacio_codigo, e.nombre AS espacio_nombre
  FROM revisiones r
  JOIN familias f ON f.id = r.familia_id
  LEFT JOIN espacios e ON e.id = r.espacio_id`;

function obtenerRevision(db, id) {
  return db.prepare(`${SELECT_REVISION} WHERE r.id = ?`).get(id);
}

export function listarRevisiones(db, { familia, espacio, pagina = 1, porPagina = 50 } = {}) {
  const where = [];
  const params = {};
  if (familia) { where.push('r.familia_id = :familia'); params.familia = Number(familia); }
  // Las revisiones de toda la familia también cubren cada espacio.
  if (espacio) { where.push('(r.espacio_id = :espacio OR r.espacio_id IS NULL)'); params.espacio = Number(espacio); }
  const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM revisiones r ${clausula}`).get(params).n;
  const items = db.prepare(`${SELECT_REVISION} ${clausula} ORDER BY r.fecha DESC, r.id DESC LIMIT :lim OFFSET :off`)
    .all({ ...params, lim: porPagina, off: (pagina - 1) * porPagina });
  return { items, total, pagina, por_pagina: porPagina };
}
