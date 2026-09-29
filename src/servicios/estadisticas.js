import { construirFiltro, parsearMovimiento } from './articulos.js';
import { normalizar } from '../lib/texto.js';

const DESDE = `
  FROM articulos a
  JOIN familias f ON f.id = a.familia_id
  JOIN espacios e ON e.id = a.espacio_id
  JOIN plantas p  ON p.id = e.planta_id
  LEFT JOIN categorias c ON c.id = a.categoria_id`;

const AGREGADOS = `COUNT(a.id) AS articulos, COALESCE(SUM(a.cantidad), 0) AS unidades,
                   COALESCE(SUM(a.cantidad * a.valor), 0) AS valor`;

export function resumen(db) {
  const activos = "WHERE a.estado <> 'baja'";
  const totales = db.prepare(`
    SELECT ${AGREGADOS},
           COALESCE(SUM(a.estado = 'averiado'), 0) AS averiados,
           COUNT(DISTINCT a.espacio_id) AS espacios_ocupados
    ${DESDE} ${activos}`).get();
  totales.bajas = db.prepare("SELECT COUNT(*) AS n FROM articulos WHERE estado = 'baja'").get().n;
  totales.espacios = db.prepare('SELECT COUNT(*) AS n FROM espacios').get().n;

  return {
    totales,
    por_familia: db.prepare(`
      SELECT f.id, f.codigo, f.nombre, f.color, ${AGREGADOS}
      FROM familias f LEFT JOIN articulos a ON a.familia_id = f.id AND a.estado <> 'baja'
      GROUP BY f.id ORDER BY articulos DESC, f.nombre`).all(),
    por_planta: db.prepare(`
      SELECT p.id, p.codigo, p.nombre, ${AGREGADOS}
      FROM plantas p
      LEFT JOIN espacios e ON e.planta_id = p.id
      LEFT JOIN articulos a ON a.espacio_id = e.id AND a.estado <> 'baja'
      GROUP BY p.id ORDER BY p.orden DESC`).all(),
    por_estado: db.prepare(`
      SELECT a.estado, ${AGREGADOS} FROM articulos a GROUP BY a.estado`).all(),
    por_categoria: db.prepare(`
      SELECT c.id, COALESCE(c.nombre, 'Sin categoría') AS nombre, ${AGREGADOS}
      ${DESDE} ${activos} GROUP BY c.id ORDER BY articulos DESC`).all(),
    recientes: db.prepare('SELECT * FROM movimientos ORDER BY fecha DESC, id DESC LIMIT 12').all().map(parsearMovimiento),
  };
}

// Ocupación de cada espacio según los mismos filtros del inventario. Alimenta
// el mapa de calor del plano y el desglose por familia de cada aula.
export function ocupacion(db, filtros) {
  const { sql, params } = construirFiltro(filtros);
  const porEspacio = db.prepare(`SELECT a.espacio_id, ${AGREGADOS} ${DESDE} ${sql} GROUP BY a.espacio_id`).all(params);
  const porFamilia = db.prepare(`
    SELECT a.espacio_id, a.familia_id, COUNT(a.id) AS articulos, COALESCE(SUM(a.cantidad), 0) AS unidades
    ${DESDE} ${sql} GROUP BY a.espacio_id, a.familia_id`).all(params);

  return porEspacio.map((e) => ({
    ...e,
    familias: porFamilia
      .filter((f) => f.espacio_id === e.espacio_id)
      .map(({ familia_id, articulos, unidades }) => ({ familia_id, articulos, unidades }))
      .sort((x, y) => y.articulos - x.articulos),
  }));
}

export function listarMovimientos(db, { articulo, tipo, usuario, desde, hasta, q, pagina = 1, porPagina = 50 } = {}) {
  const where = [];
  const params = {};
  if (articulo) { where.push('m.articulo_id = :articulo'); params.articulo = Number(articulo); }
  if (tipo) { where.push('m.tipo = :tipo'); params.tipo = String(tipo); }
  if (usuario) { where.push('normalizar(m.usuario) = normalizar(:usuario)'); params.usuario = String(usuario); }
  if (desde) { where.push('m.fecha >= :desde'); params.desde = String(desde); }
  if (hasta) { where.push('m.fecha < :hasta'); params.hasta = `${hasta}T99`; }
  if (q) {
    where.push("normalizar(m.articulo_codigo || ' ' || m.articulo_nombre || ' ' || m.usuario) LIKE :q ESCAPE '\\'");
    params.q = `%${normalizar(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM movimientos m ${clausula}`).get(params).n;
  const items = db.prepare(`
    SELECT m.* FROM movimientos m ${clausula}
    ORDER BY m.fecha DESC, m.id DESC LIMIT :lim OFFSET :off`)
    .all({ ...params, lim: porPagina, off: (pagina - 1) * porPagina })
    .map(parsearMovimiento);
  const usuarios = db.prepare('SELECT DISTINCT usuario FROM movimientos ORDER BY usuario COLLATE NOCASE').all().map((u) => u.usuario);
  return { items, total, pagina, por_pagina: porPagina, usuarios };
}
