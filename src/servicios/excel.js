import ExcelJS from 'exceljs';
import { listar } from './articulos.js';
import { miniaturaParaPdf } from './fotos.js';

// Hoja de cálculo del inventario con una columna de mini fotos. Mismas columnas
// que la exportación CSV, más "Foto" con la miniatura de cada artículo.
// Formato .xlsx: es el único que admite imágenes incrustadas por celda con
// librerías de Node (el .xls antiguo no las soporta de forma fiable).

const COLUMNAS = [
  { cab: 'Foto', ancho: 14, foto: true },
  { cab: 'Código', campo: 'codigo', ancho: 13 },
  { cab: 'Nombre', campo: 'nombre', ancho: 36 },
  { cab: 'Familia', campo: 'familia_nombre', ancho: 30 },
  { cab: 'Planta', campo: 'planta_nombre', ancho: 14 },
  { cab: 'Espacio (código)', campo: 'espacio_codigo', ancho: 12 },
  { cab: 'Espacio', campo: 'espacio_nombre', ancho: 30 },
  { cab: 'Ubicación detallada', campo: 'ubicacion_detalle', ancho: 22 },
  { cab: 'Categoría', campo: 'categoria_nombre', ancho: 26 },
  { cab: 'Cantidad', campo: 'cantidad', ancho: 10 },
  { cab: 'Estado', campo: 'estado', ancho: 12 },
  { cab: 'Marca', campo: 'marca', ancho: 16 },
  { cab: 'Modelo', campo: 'modelo', ancho: 16 },
  { cab: 'Nº de serie', campo: 'numero_serie', ancho: 18 },
  { cab: 'Valor unitario (€)', campo: 'valor', ancho: 16, moneda: true },
  { cab: 'Fecha adquisición', campo: 'fecha_adquisicion', ancho: 16 },
  { cab: 'Proveedor', campo: 'proveedor', ancho: 22 },
  { cab: 'Descripción', campo: 'descripcion', ancho: 40 },
  { cab: 'Observaciones', campo: 'observaciones', ancho: 40 },
  { cab: 'Fecha baja', campo: 'fecha_baja', ancho: 14 },
  { cab: 'Motivo baja', campo: 'motivo_baja', ancho: 24 },
  { cab: 'Última comprobación', campo: 'revisado_en', ancho: 20, fecha: true },
];

const ALTO_FILA = 62;   // puntos: sitio para una miniatura de 60 px
const LADO_FOTO = 60;   // píxeles

export async function generarExcel(db, dirFotos, filtros = {}, orden = {}) {
  const { items } = listar(db, filtros, { ...orden, porPagina: Infinity });

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Superinventario CIFP Tony Gallardo';
  libro.created = new Date();
  const hoja = libro.addWorksheet('Inventario', { views: [{ state: 'frozen', ySplit: 1 }] });

  hoja.columns = COLUMNAS.map((c) => ({ header: c.cab, width: c.ancho }));
  const cabecera = hoja.getRow(1);
  cabecera.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecera.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF151A2D' } };
  cabecera.alignment = { vertical: 'middle' };
  cabecera.height = 22;
  hoja.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNAS.length } };

  // Cada foto se incrusta una sola vez aunque la usen varios artículos.
  const imagenes = new Map();
  const imagenDe = async (fotoId) => {
    if (!imagenes.has(fotoId)) {
      const jpeg = await miniaturaParaPdf(dirFotos, fotoId);
      imagenes.set(fotoId, jpeg ? libro.addImage({ buffer: jpeg, extension: 'jpeg' }) : null);
    }
    return imagenes.get(fotoId);
  };

  for (const [indice, a] of items.entries()) {
    const fila = hoja.addRow(COLUMNAS.map((c) => {
      if (c.foto) return '';
      const v = a[c.campo];
      if (c.fecha && v) return new Date(v);
      if (c.moneda && v !== null && v !== undefined) return Number(v);
      return v ?? '';
    }));
    fila.height = ALTO_FILA;
    fila.alignment = { vertical: 'middle', wrapText: true };
    if (a.fecha_adquisicion) fila.getCell('fecha_adquisicion').numFmt = 'dd/mm/yyyy';
    COLUMNAS.forEach((c, i) => {
      if (c.moneda) hoja.getCell(fila.number, i + 1).numFmt = '#,##0.00 €';
      if (c.fecha) hoja.getCell(fila.number, i + 1).numFmt = 'dd/mm/yyyy hh:mm';
    });
    if (a.estado === 'baja') {
      fila.font = { strike: true, color: { argb: 'FF7A8099' } };
    }

    if (a.foto_id) {
      const imagen = await imagenDe(a.foto_id);
      if (imagen !== null && imagen !== undefined) {
        hoja.addImage(imagen, {
          tl: { col: 0.08, row: indice + 1 + 0.08 },
          ext: { width: LADO_FOTO, height: LADO_FOTO },
          editAs: 'oneCell',
        });
      }
    }
  }

  if (!items.length) hoja.addRow(['', 'No hay artículos con estos filtros.']);
  return libro.xlsx.writeBuffer();
}
