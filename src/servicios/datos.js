import { transaccion } from '../db/index.js';
import { generarCsv, parsearCsv } from '../lib/csv.js';
import { normalizar } from '../lib/texto.js';
import { ErrorApi } from '../lib/errores.js';
import { ESQUEMA_ARTICULO, ESTADOS_ACTIVOS, crear, listar } from './articulos.js';
import { buscarCategoriaPorNombre } from './catalogo.js';

// Columnas del CSV: la exportación y la importación usan las mismas, así que
// un fichero exportado se puede volver a importar tal cual.
const COLUMNAS = [
  { cab: 'Código', campo: 'codigo' },
  { cab: 'Nombre', campo: 'nombre' },
  { cab: 'Familia', campo: 'familia_nombre' },
  { cab: 'Planta', campo: 'planta_nombre' },
  { cab: 'Espacio (código)', campo: 'espacio_codigo' },
  { cab: 'Espacio', campo: 'espacio_nombre' },
  { cab: 'Ubicación detallada', campo: 'ubicacion_detalle' },
  { cab: 'Categoría', campo: 'categoria_nombre' },
  { cab: 'Cantidad', campo: 'cantidad' },
  { cab: 'Estado', campo: 'estado' },
  { cab: 'Marca', campo: 'marca' },
  { cab: 'Modelo', campo: 'modelo' },
  { cab: 'Nº de serie', campo: 'numero_serie' },
  { cab: 'Valor unitario (€)', campo: 'valor', formato: (v) => (v == null ? '' : String(v).replace('.', ',')) },
  { cab: 'Fecha adquisición', campo: 'fecha_adquisicion' },
  { cab: 'Proveedor', campo: 'proveedor' },
  { cab: 'Descripción', campo: 'descripcion' },
  { cab: 'Observaciones', campo: 'observaciones' },
  { cab: 'Fecha baja', campo: 'fecha_baja' },
  { cab: 'Motivo baja', campo: 'motivo_baja' },
  { cab: 'Última modificación', campo: 'actualizado_en', formato: (v) => v?.slice(0, 16).replace('T', ' ') },
];

export function exportarCsv(db, filtros, orden) {
  const { items } = listar(db, filtros, { ...orden, porPagina: Infinity });
  return generarCsv(
    COLUMNAS.map((c) => c.cab),
    items.map((a) => COLUMNAS.map((c) => (c.formato ? c.formato(a[c.campo]) : a[c.campo]))),
  );
}

export function plantillaCsv() {
  const cab = ['Nombre', 'Familia', 'Espacio (código)', 'Ubicación detallada', 'Categoría', 'Cantidad', 'Estado',
    'Marca', 'Modelo', 'Nº de serie', 'Valor unitario (€)', 'Fecha adquisición', 'Proveedor', 'Descripción', 'Observaciones'];
  const ejemplo = ['Camilla articulada', 'SAN', 'P1-03', 'Fondo del aula', 'Material sanitario', '2', 'bueno',
    'Acme', 'CX-200', '', '350,00', '15/09/2025', 'Suministros Médicos S.L.', '', 'Revisada en septiembre'];
  return generarCsv(cab, [ejemplo]);
}

// Nombre de columna normalizado -> campo interno.
const ALIAS = {
  nombre: 'nombre', articulo: 'nombre',
  familia: 'familia', 'familia profesional': 'familia',
  'espacio (codigo)': 'espacio_codigo', 'codigo espacio': 'espacio_codigo', aula: 'espacio',
  espacio: 'espacio',
  'ubicacion detallada': 'ubicacion_detalle', ubicacion: 'ubicacion_detalle',
  categoria: 'categoria',
  cantidad: 'cantidad', unidades: 'cantidad',
  estado: 'estado',
  marca: 'marca', modelo: 'modelo',
  'no de serie': 'numero_serie', 'n de serie': 'numero_serie', 'numero de serie': 'numero_serie', 'num serie': 'numero_serie',
  'valor unitario (€)': 'valor', 'valor unitario': 'valor', valor: 'valor', precio: 'valor',
  'fecha adquisicion': 'fecha_adquisicion', 'fecha de adquisicion': 'fecha_adquisicion', fecha: 'fecha_adquisicion',
  proveedor: 'proveedor', descripcion: 'descripcion', observaciones: 'observaciones',
};

const clave = (s) => normalizar(s).replace(/º/g, 'o').replace(/\s+/g, ' ');
const MAX_FILAS = 5000;

// Valida el CSV completo antes de tocar la base de datos: o entran todas las
// filas o ninguna. Con simular=true solo informa de lo que se haría.
export function importarCsv(db, texto, usuario, { simular = false } = {}) {
  if (typeof texto !== 'string' || !texto.trim()) throw new ErrorApi(400, 'El fichero está vacío');
  const [cabecera, ...filas] = parsearCsv(texto);
  if (!filas.length) throw new ErrorApi(400, 'El fichero no tiene filas de datos');
  if (filas.length > MAX_FILAS) throw new ErrorApi(400, `Máximo ${MAX_FILAS} filas por importación`);

  const mapa = cabecera.map((c) => ALIAS[clave(c)] ?? null);
  const faltan = ['nombre', 'familia'].filter((c) => !mapa.includes(c));
  if (!mapa.includes('espacio') && !mapa.includes('espacio_codigo')) faltan.push('espacio');
  if (faltan.length) throw new ErrorApi(400, `Faltan columnas obligatorias: ${faltan.join(', ')}`);

  const familias = db.prepare('SELECT id, codigo, nombre FROM familias').all();
  const espacios = db.prepare('SELECT id, codigo, nombre FROM espacios').all();
  const buscarFamilia = (v) => familias.find((f) => clave(f.codigo) === clave(v) || clave(f.nombre) === clave(v)
    || clave(`Familia profesional de ${f.nombre}`) === clave(v));
  const buscarEspacio = (v) => espacios.find((e) => clave(e.codigo) === clave(v) || clave(e.nombre) === clave(v));

  const errores = [];
  const preparadas = [];
  const categoriasNuevas = new Map();

  filas.forEach((fila, i) => {
    const numero = i + 2; // +1 por la cabecera, +1 porque Excel cuenta desde 1
    const crudo = {};
    mapa.forEach((campo, col) => {
      if (!campo) return;
      // Deshace la protección anti-fórmulas que añade la exportación.
      const v = (fila[col] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
      if (v !== '' && crudo[campo] === undefined) crudo[campo] = v;
    });
    const mensajes = [];

    const familia = crudo.familia ? buscarFamilia(crudo.familia) : null;
    if (!crudo.familia) mensajes.push('Falta la familia');
    else if (!familia) mensajes.push(`Familia desconocida: "${crudo.familia}"`);

    const refEspacio = crudo.espacio_codigo ?? crudo.espacio;
    const espacio = refEspacio ? buscarEspacio(refEspacio) : null;
    if (!refEspacio) mensajes.push('Falta el espacio');
    else if (!espacio) mensajes.push(`Espacio desconocido: "${refEspacio}"`);

    let estado = crudo.estado ? normalizar(crudo.estado) : undefined;
    if (estado && !ESTADOS_ACTIVOS.includes(estado)) {
      mensajes.push(`Estado no válido: "${crudo.estado}" (${ESTADOS_ACTIVOS.join(', ')})`);
      estado = undefined;
    }

    let categoria_id = null;
    if (crudo.categoria) {
      const existente = buscarCategoriaPorNombre(db, crudo.categoria);
      if (existente) categoria_id = existente.id;
      else categoriasNuevas.set(clave(crudo.categoria), crudo.categoria);
    }

    const datos = {
      nombre: crudo.nombre, descripcion: crudo.descripcion, familia_id: familia?.id, espacio_id: espacio?.id,
      cantidad: crudo.cantidad ?? '1', estado, ubicacion_detalle: crudo.ubicacion_detalle, marca: crudo.marca,
      modelo: crudo.modelo, numero_serie: crudo.numero_serie, valor: crudo.valor,
      fecha_adquisicion: crudo.fecha_adquisicion, proveedor: crudo.proveedor, observaciones: crudo.observaciones,
    };
    // Reutiliza las reglas del alta manual para dar los mismos mensajes.
    for (const [campo, regla] of Object.entries(ESQUEMA_ARTICULO)) {
      if (campo === 'familia_id' || campo === 'espacio_id' || campo === 'categoria_id') continue;
      const r = regla(datos[campo]);
      if (r.error) mensajes.push(`${campo}: ${r.error}`);
    }

    if (mensajes.length) errores.push({ fila: numero, nombre: crudo.nombre ?? '', mensajes });
    else preparadas.push({ datos, categoria: crudo.categoria && !categoria_id ? clave(crudo.categoria) : null });
  });

  const informe = {
    filas: filas.length,
    validas: preparadas.length,
    errores,
    categorias_nuevas: [...categoriasNuevas.values()],
    importados: 0,
  };
  if (simular || errores.length) return informe;

  transaccion(db, () => {
    const idsNuevas = new Map();
    for (const [k, nombre] of categoriasNuevas) {
      const { lastInsertRowid } = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(nombre);
      idsNuevas.set(k, Number(lastInsertRowid));
    }
    for (const { datos, categoria } of preparadas) {
      if (categoria) datos.categoria_id = idsNuevas.get(categoria);
      crear(db, datos, usuario, { detalleAlta: { importado: true } });
      informe.importados++;
    }
  });
  return informe;
}
