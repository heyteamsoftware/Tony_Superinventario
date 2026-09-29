import { ESTADOS, transaccion } from '../db/index.js';
import { reglas, validar } from '../lib/validar.js';
import { ErrorApi, noEncontrado, datosNoValidos } from '../lib/errores.js';
import { ahora, normalizar } from '../lib/texto.js';

export const ESTADOS_ACTIVOS = ESTADOS.filter((e) => e !== 'baja');

const { texto, entero, decimal, fecha, enumerado } = reglas;

export const ESQUEMA_ARTICULO = {
  nombre: texto({ requerido: true, max: 200 }),
  descripcion: texto({ max: 2000 }),
  familia_id: entero({ requerido: true, min: 1 }),
  espacio_id: entero({ requerido: true, min: 1 }),
  categoria_id: entero({ min: 1 }),
  cantidad: entero({ min: 0, max: 1_000_000 }),
  estado: enumerado(ESTADOS_ACTIVOS),
  ubicacion_detalle: texto({ max: 200 }),
  marca: texto({ max: 200 }),
  modelo: texto({ max: 200 }),
  numero_serie: texto({ max: 200 }),
  valor: decimal({ min: 0, max: 10_000_000 }),
  fecha_adquisicion: fecha(),
  proveedor: texto({ max: 200 }),
  observaciones: texto({ max: 4000 }),
};

const CAMPOS_EDITABLES = Object.keys(ESQUEMA_ARTICULO);

const SELECT_ARTICULO = `
  SELECT a.*,
         f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.color AS familia_color,
         e.codigo AS espacio_codigo, e.nombre AS espacio_nombre,
         p.id AS planta_id, p.codigo AS planta_codigo, p.nombre AS planta_nombre,
         c.nombre AS categoria_nombre
  FROM articulos a
  JOIN familias f  ON f.id = a.familia_id
  JOIN espacios e  ON e.id = a.espacio_id
  JOIN plantas p   ON p.id = e.planta_id
  LEFT JOIN categorias c ON c.id = a.categoria_id`;

const ORDENES = {
  codigo: 'a.codigo',
  nombre: 'a.nombre COLLATE NOCASE',
  familia: 'f.nombre',
  espacio: 'e.codigo',
  categoria: 'c.nombre',
  cantidad: 'a.cantidad',
  estado: 'a.estado',
  valor: 'a.valor',
  actualizado: 'a.actualizado_en',
};

// ── Filtros ──────────────────────────────────────────────────────────────

const listaEnteros = (v) =>
  String(v ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);

// Traduce los filtros de la URL a un WHERE parametrizado. Se comparte entre
// el listado, la exportación CSV y la ocupación del plano.
export function construirFiltro(filtros = {}) {
  const where = [];
  const params = {};

  const enLista = (columna, valor, nombre) => {
    const ids = listaEnteros(valor);
    if (!ids.length) return;
    const marcas = ids.map((id, i) => {
      params[`${nombre}${i}`] = id;
      return `:${nombre}${i}`;
    });
    where.push(`${columna} IN (${marcas.join(', ')})`);
  };

  enLista('a.id', String(filtros.ids ?? '').split(',').slice(0, 1000).join(','), 'id');
  enLista('a.familia_id', filtros.familia, 'fam');
  enLista('e.planta_id', filtros.planta, 'pla');
  enLista('a.espacio_id', filtros.espacio, 'esp');
  if (filtros.categoria === 'sin') where.push('a.categoria_id IS NULL');
  else enLista('a.categoria_id', filtros.categoria, 'cat');

  const estados = String(filtros.estado ?? '').split(',').filter((e) => ESTADOS.includes(e));
  if (estados.length) {
    where.push(`a.estado IN (${estados.map((e, i) => { params[`est${i}`] = e; return `:est${i}`; }).join(', ')})`);
  } else if (filtros.bajas === 'solo') {
    where.push("a.estado = 'baja'");
  } else if (filtros.bajas !== 'incluir') {
    where.push("a.estado <> 'baja'");
  }

  // Cada palabra debe aparecer en algún campo de texto (sin tildes ni mayúsculas).
  const palabras = normalizar(filtros.q).split(/\s+/).filter(Boolean).slice(0, 8);
  palabras.forEach((p, i) => {
    params[`q${i}`] = `%${p.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`normalizar(a.codigo || ' ' || a.nombre || ' ' || a.descripcion || ' ' || a.marca || ' ' ||
      a.modelo || ' ' || a.numero_serie || ' ' || a.ubicacion_detalle || ' ' || a.proveedor || ' ' ||
      a.observaciones) LIKE :q${i} ESCAPE '\\'`);
  });

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listar(db, filtros = {}, { pagina = 1, porPagina = 50, orden = 'codigo', dir = 'asc' } = {}) {
  const { sql, params } = construirFiltro(filtros);
  const columna = ORDENES[orden] ?? ORDENES.codigo;
  const sentido = dir === 'desc' ? 'DESC' : 'ASC';
  const base = `${SELECT_ARTICULO} ${sql}`;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(params).n;
  const limite = porPagina === Infinity ? -1 : porPagina;
  const items = db
    .prepare(`${base} ORDER BY ${columna} ${sentido} NULLS LAST, a.id ${sentido} LIMIT :lim OFFSET :off`)
    .all({ ...params, lim: limite, off: limite === -1 ? 0 : (pagina - 1) * porPagina });
  return { items, total, pagina, por_pagina: porPagina === Infinity ? total : porPagina };
}

export function obtener(db, id) {
  const art = db.prepare(`${SELECT_ARTICULO} WHERE a.id = ?`).get(id);
  if (!art) throw noEncontrado('Artículo');
  return art;
}

export function movimientosDe(db, id) {
  return db
    .prepare('SELECT * FROM movimientos WHERE articulo_id = ? ORDER BY fecha DESC, id DESC')
    .all(id)
    .map(parsearMovimiento);
}

export const parsearMovimiento = (m) => ({ ...m, detalle: JSON.parse(m.detalle) });

// ── Utilidades internas ──────────────────────────────────────────────────

function registrar(db, articulo, tipo, detalle, usuario) {
  db.prepare(`
    INSERT INTO movimientos (articulo_id, articulo_codigo, articulo_nombre, familia_id, espacio_id, tipo, detalle, usuario, fecha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    tipo === 'eliminacion' ? null : articulo.id,
    articulo.codigo, articulo.nombre, articulo.familia_id, articulo.espacio_id, tipo, JSON.stringify(detalle ?? {}), usuario, ahora(),
  );
}

function comprobarReferencias(db, datos) {
  const errores = {};
  const existe = (tabla, id) => db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id);
  if (datos.familia_id != null && !existe('familias', datos.familia_id)) errores.familia_id = 'La familia no existe';
  if (datos.espacio_id != null && !existe('espacios', datos.espacio_id)) errores.espacio_id = 'El espacio no existe';
  if (datos.categoria_id != null && !existe('categorias', datos.categoria_id)) errores.categoria_id = 'La categoría no existe';
  if (Object.keys(errores).length) throw datosNoValidos(errores);
}

// El código es la etiqueta física del artículo: se genera una vez por familia
// y no cambia nunca (tampoco se reutiliza tras un borrado).
function siguienteCodigo(db, familiaId) {
  const fam = db.prepare('SELECT codigo, siguiente_num FROM familias WHERE id = ?').get(familiaId);
  db.prepare('UPDATE familias SET siguiente_num = siguiente_num + 1 WHERE id = ?').run(familiaId);
  return `${fam.codigo}-${String(fam.siguiente_num).padStart(5, '0')}`;
}

const refEspacio = (db, id) => db.prepare('SELECT id, codigo, nombre FROM espacios WHERE id = ?').get(id);

function insertar(db, datos, usuario) {
  const momento = ahora();
  const fila = {
    descripcion: '', categoria_id: null, cantidad: 1, estado: 'bueno', ubicacion_detalle: '',
    marca: '', modelo: '', numero_serie: '', valor: null, fecha_adquisicion: null,
    proveedor: '', observaciones: '',
    ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && v !== undefined)),
    codigo: siguienteCodigo(db, datos.familia_id),
    creado_por: usuario,
    creado_en: momento,
    actualizado_en: momento,
    revisado_en: momento,
  };
  const columnas = Object.keys(fila);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO articulos (${columnas.join(', ')}) VALUES (${columnas.map((c) => `:${c}`).join(', ')})`)
    .run(fila);
  return Number(lastInsertRowid);
}

// ── Operaciones ──────────────────────────────────────────────────────────

export function crear(db, entrada, usuario, { detalleAlta = {} } = {}) {
  const datos = validar(ESQUEMA_ARTICULO, entrada);
  return transaccion(db, () => {
    comprobarReferencias(db, datos);
    const id = insertar(db, datos, usuario);
    const art = obtener(db, id);
    registrar(db, art, 'alta', { espacio: refEspacio(db, art.espacio_id), cantidad: art.cantidad, ...detalleAlta }, usuario);
    return art;
  });
}

export function actualizar(db, id, entrada, usuario) {
  const datos = validar(ESQUEMA_ARTICULO, entrada, { parcial: true });
  return transaccion(db, () => {
    const antes = obtener(db, id);
    if (antes.estado === 'baja' && 'estado' in datos) {
      throw new ErrorApi(409, 'El artículo está dado de baja: reactívalo para cambiar su estado');
    }
    comprobarReferencias(db, datos);

    const cambios = Object.fromEntries(
      Object.entries(datos).filter(([campo, valor]) => CAMPOS_EDITABLES.includes(campo) && antes[campo] !== valor),
    );
    if (!Object.keys(cambios).length) return antes;

    const asignaciones = Object.keys(cambios).map((c) => `${c} = :${c}`).join(', ');
    db.prepare(`UPDATE articulos SET ${asignaciones}, actualizado_en = :ahora, revisado_en = :ahora WHERE id = :id`)
      .run({ ...cambios, ahora: ahora(), id });
    const despues = obtener(db, id);

    // Un cambio de espacio o de estado se registra con su propio tipo para
    // que el historial se lea con claridad.
    if ('espacio_id' in cambios) {
      registrar(db, despues, 'traslado', {
        desde: refEspacio(db, antes.espacio_id), hasta: refEspacio(db, despues.espacio_id), cantidad: despues.cantidad,
      }, usuario);
    }
    if ('estado' in cambios) {
      registrar(db, despues, 'estado', { antes: antes.estado, despues: despues.estado }, usuario);
    }
    const resto = {};
    for (const campo of Object.keys(cambios)) {
      if (campo === 'espacio_id' || campo === 'estado') continue;
      if (campo === 'familia_id') resto.familia = { antes: antes.familia_nombre, despues: despues.familia_nombre };
      else if (campo === 'categoria_id') resto.categoria = { antes: antes.categoria_nombre, despues: despues.categoria_nombre };
      else resto[campo] = { antes: antes[campo], despues: despues[campo] };
    }
    if (Object.keys(resto).length) registrar(db, despues, 'edicion', { cambios: resto }, usuario);
    return despues;
  });
}

const ESQUEMA_TRASLADO = {
  espacio_id: entero({ requerido: true, min: 1 }),
  cantidad: entero({ min: 1 }),
  ubicacion_detalle: texto({ max: 200 }),
  motivo: texto({ max: 500 }),
};

// Traslada el artículo entero o solo parte de sus unidades. En un traslado
// parcial el resto se queda en origen y las unidades movidas pasan a ser un
// artículo nuevo (con su propio código) en el destino.
export function trasladar(db, id, entrada, usuario) {
  const datos = validar(ESQUEMA_TRASLADO, entrada);
  return transaccion(db, () => {
    const art = obtener(db, id);
    if (art.estado === 'baja') throw new ErrorApi(409, 'No se puede trasladar un artículo dado de baja');
    const destino = refEspacio(db, datos.espacio_id);
    if (!destino) throw datosNoValidos({ espacio_id: 'El espacio no existe' });
    if (destino.id === art.espacio_id) throw datosNoValidos({ espacio_id: 'El artículo ya está en ese espacio' });
    if (datos.cantidad != null && datos.cantidad > art.cantidad) {
      throw datosNoValidos({ cantidad: `Solo hay ${art.cantidad} unidades` });
    }

    const origen = refEspacio(db, art.espacio_id);
    const parcial = datos.cantidad != null && datos.cantidad < art.cantidad;

    if (!parcial) {
      db.prepare('UPDATE articulos SET espacio_id = ?, ubicacion_detalle = ?, actualizado_en = ?, revisado_en = ? WHERE id = ?')
        .run(destino.id, datos.ubicacion_detalle, ahora(), ahora(), id);
      const movido = obtener(db, id);
      registrar(db, movido, 'traslado', { desde: origen, hasta: destino, cantidad: movido.cantidad, motivo: datos.motivo }, usuario);
      return { articulo: movido, nuevo: null };
    }

    db.prepare('UPDATE articulos SET cantidad = cantidad - ?, actualizado_en = ?, revisado_en = ? WHERE id = ?')
      .run(datos.cantidad, ahora(), ahora(), id);
    const copia = Object.fromEntries(CAMPOS_EDITABLES.map((c) => [c, art[c]]));
    const nuevoId = insertar(db, { ...copia, espacio_id: destino.id, cantidad: datos.cantidad, ubicacion_detalle: datos.ubicacion_detalle }, usuario);
    const nuevo = obtener(db, nuevoId);
    const restante = obtener(db, id);
    registrar(db, restante, 'traslado', {
      desde: origen, hasta: destino, cantidad: datos.cantidad, parcial: true, nuevo_codigo: nuevo.codigo, motivo: datos.motivo,
    }, usuario);
    registrar(db, nuevo, 'alta', {
      espacio: destino, cantidad: nuevo.cantidad, origen_codigo: art.codigo, desde: origen, motivo: datos.motivo,
    }, usuario);
    return { articulo: restante, nuevo };
  });
}

export function darDeBaja(db, id, entrada, usuario) {
  const { motivo } = validar({ motivo: texto({ requerido: true, max: 500 }) }, entrada);
  return transaccion(db, () => {
    const art = obtener(db, id);
    if (art.estado === 'baja') throw new ErrorApi(409, 'El artículo ya está dado de baja');
    db.prepare("UPDATE articulos SET estado = 'baja', fecha_baja = ?, motivo_baja = ?, actualizado_en = ?, revisado_en = ? WHERE id = ?")
      .run(ahora().slice(0, 10), motivo, ahora(), ahora(), id);
    const despues = obtener(db, id);
    registrar(db, despues, 'baja', { motivo, estado_anterior: art.estado }, usuario);
    return despues;
  });
}

export function reactivar(db, id, entrada, usuario) {
  const { estado } = validar({ estado: enumerado(ESTADOS_ACTIVOS) }, entrada ?? {});
  return transaccion(db, () => {
    const art = obtener(db, id);
    if (art.estado !== 'baja') throw new ErrorApi(409, 'El artículo no está dado de baja');
    const nuevoEstado = estado ?? 'bueno';
    db.prepare('UPDATE articulos SET estado = ?, fecha_baja = NULL, motivo_baja = NULL, actualizado_en = ?, revisado_en = ? WHERE id = ?')
      .run(nuevoEstado, ahora(), ahora(), id);
    const despues = obtener(db, id);
    registrar(db, despues, 'reactivacion', { estado: nuevoEstado }, usuario);
    return despues;
  });
}

// Borrado definitivo, pensado para corregir errores de alta. El historial
// conserva una copia de los datos del artículo.
export function eliminar(db, id, usuario) {
  transaccion(db, () => {
    const art = obtener(db, id);
    registrar(db, art, 'eliminacion', {
      familia: art.familia_nombre, espacio: { codigo: art.espacio_codigo, nombre: art.espacio_nombre },
      cantidad: art.cantidad, estado: art.estado,
    }, usuario);
    db.prepare('DELETE FROM articulos WHERE id = ?').run(id);
  });
}

// ── Operaciones en lote ─────────────────────────────────────────────────

const ESQUEMA_IDS = { ids: reglas.listaIds() };

function idsDeLote(entrada) {
  const { ids } = validar(ESQUEMA_IDS, entrada);
  if (!ids.length) throw datosNoValidos({ ids: 'Selecciona al menos un artículo' });
  if (ids.length > 1000) throw datosNoValidos({ ids: 'Máximo 1000 artículos por operación' });
  return ids;
}

export function trasladarLote(db, entrada, usuario) {
  const ids = idsDeLote(entrada);
  const destino = validar({ espacio_id: entero({ requerido: true, min: 1 }), motivo: texto({ max: 500 }) }, entrada);
  return transaccion(db, () => {
    let movidos = 0;
    for (const id of ids) {
      const art = obtener(db, id);
      if (art.espacio_id === destino.espacio_id || art.estado === 'baja') continue;
      trasladar(db, id, destino, usuario);
      movidos++;
    }
    return { procesados: movidos, omitidos: ids.length - movidos };
  });
}

export function cambiarEstadoLote(db, entrada, usuario) {
  const ids = idsDeLote(entrada);
  const { estado } = validar({ estado: enumerado(ESTADOS_ACTIVOS, { requerido: true }) }, entrada);
  return transaccion(db, () => {
    let cambiados = 0;
    for (const id of ids) {
      const art = obtener(db, id);
      if (art.estado === estado || art.estado === 'baja') continue;
      actualizar(db, id, { estado }, usuario);
      cambiados++;
    }
    return { procesados: cambiados, omitidos: ids.length - cambiados };
  });
}
