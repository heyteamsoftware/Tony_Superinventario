import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { listar } from './articulos.js';
import { familiasConRevision } from './revisiones.js';
import { noEncontrado } from '../lib/errores.js';

const LOGO = fileURLToPath(new URL('../recursos/logo-cifp.png', import.meta.url));
const CENTRO = 'CIFP Tony Gallardo';

const ESTADOS = { nuevo: 'Nuevo', bueno: 'Bueno', regular: 'Regular', averiado: 'Averiado', baja: 'De baja' };
const COLOR_ESTADO = { nuevo: '#2456c9', bueno: '#0f7a4f', regular: '#b45309', averiado: '#c81e3a', baja: '#7a8099' };
const REVISION = {
  al_dia: ['Al día', '#0f7a4f'], pronto: ['Revisar pronto', '#b45309'],
  vencida: ['Revisión vencida', '#c81e3a'], nunca: ['Sin revisiones registradas', '#7a8099'],
};
const C = { tinta: '#151a2d', tenue: '#6b7290', linea: '#d9dde6', fondo: '#f1f3f8', marino: '#0f437a' };

const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtFechaHora = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtNumero = new Intl.NumberFormat('es-ES');
const fmtEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

// Las fuentes estándar del PDF usan WinAnsi: lo que no está en ese juego de
// caracteres (emojis, símbolos raros) se sustituye para no imprimir basura.
const EXTRA_WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
function limpio(texto) {
  return String(texto ?? '').normalize('NFC')
    .replace(/[​-‏︀-️]/g, '') // caracteres invisibles (unión de emojis, variantes)
    .replace(/[\s\S]/gu, (c) => {
      if (c.charCodeAt(0) <= 0xff || EXTRA_WINANSI.has(c)) return c;
      return /\p{S}/u.test(c) ? '' : '?'; // símbolos y emojis fuera; letras de otros alfabetos, "?"
    })
    .replace(/ {2,}/g, ' ');
}

const haceDias = (d) => (d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${fmtNumero.format(d)} días`);

// ── Datos ────────────────────────────────────────────────────────────────

// Material de una familia agrupado por planta y aula (orden del plano) y,
// dentro de cada aula, por nombre.
export function datosInforme(db, familiaId, { bajas = false } = {}) {
  const familia = familiasConRevision(db).find((f) => f.id === familiaId);
  if (!familia) throw noEncontrado('Familia');
  const { items } = listar(db, { familia: String(familiaId), bajas: bajas ? 'incluir' : '' }, { porPagina: Infinity, orden: 'espacio' });

  const plantas = db.prepare('SELECT id, nombre FROM plantas ORDER BY orden DESC').all()
    .map((p) => ({ ...p, espacios: new Map() }));
  for (const a of items) {
    const planta = plantas.find((p) => p.id === a.planta_id);
    if (!planta.espacios.has(a.espacio_id)) {
      planta.espacios.set(a.espacio_id, { id: a.espacio_id, codigo: a.espacio_codigo, nombre: a.espacio_nombre, articulos: [] });
    }
    planta.espacios.get(a.espacio_id).articulos.push(a);
  }

  const porNombre = (x, y) => x.nombre.localeCompare(y.nombre, 'es', { sensitivity: 'base' }) || x.codigo.localeCompare(y.codigo);
  const resultado = plantas
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      espacios: [...p.espacios.values()]
        .sort((x, y) => x.codigo.localeCompare(y.codigo))
        .map((e) => ({ ...e, articulos: e.articulos.sort(porNombre) })),
    }))
    .filter((p) => p.espacios.length);

  const activos = items.filter((a) => a.estado !== 'baja');
  return {
    familia,
    plantas: resultado,
    totales: {
      articulos: activos.length,
      unidades: activos.reduce((s, a) => s + a.cantidad, 0),
      valor: activos.reduce((s, a) => s + (a.valor ?? 0) * a.cantidad, 0),
      espacios: new Set(activos.map((a) => a.espacio_id)).size,
      bajas: items.length - activos.length,
    },
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────

export function pdfInventarioFamilia(db, familiaId, { bajas = false, valores = false, usuario = '' } = {}) {
  const datos = datosInforme(db, familiaId, { bajas });
  const { familia, totales } = datos;
  const ahora = new Date();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    bufferPages: true,
    info: {
      Title: `Inventario de ${familia.nombre} · ${CENTRO}`,
      Author: `Superinventario ${CENTRO}`,
      Subject: 'Inventario por aulas',
    },
  });
  const trozos = [];
  doc.on('data', (t) => trozos.push(t));
  const terminado = new Promise((resolver, rechazar) => {
    doc.on('end', () => resolver(Buffer.concat(trozos)));
    doc.on('error', rechazar);
  });

  const X = doc.page.margins.left;
  const ANCHO = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const LIMITE = () => doc.page.height - 58; // deja sitio al pie de página

  // Columnas de la tabla (la de "Artículo" ocupa el espacio sobrante).
  const columnas = [
    { id: 'check', titulo: '', ancho: 16 },
    { id: 'codigo', titulo: 'Código', ancho: 60 },
    { id: 'articulo', titulo: 'Artículo', ancho: 0 },
    { id: 'categoria', titulo: 'Categoría', ancho: 78 },
    { id: 'ubicacion', titulo: 'Ubicación', ancho: 72 },
    { id: 'estado', titulo: 'Estado', ancho: 50 },
    { id: 'cantidad', titulo: 'Cant.', ancho: 32, derecha: true },
    ...(valores ? [{ id: 'valor', titulo: 'Valor total', ancho: 58, derecha: true }] : []),
  ];
  columnas.find((c) => c.id === 'articulo').ancho = ANCHO - columnas.reduce((s, c) => s + c.ancho, 0);
  let x = X;
  for (const c of columnas) { c.x = x; x += c.ancho; }
  const col = (id) => columnas.find((c) => c.id === id);

  // ── Piezas de dibujo ──────────────────────────────────────────────────
  function cabeceraPrincipal() {
    doc.rect(0, 0, doc.page.width, 6).fill(familia.color);
    doc.image(LOGO, X, 22, { width: 54 });
    doc.fillColor(C.tenue).font('Helvetica-Bold').fontSize(8)
      .text(`SUPERINVENTARIO · ${CENTRO.toUpperCase()}`, X + 66, 26, { characterSpacing: 0.6 });
    doc.fillColor(C.tinta).font('Helvetica-Bold').fontSize(19)
      .text(limpio(`Inventario de ${familia.nombre}`), X + 66, 38, { width: ANCHO - 66 });
    doc.fillColor(C.tenue).font('Helvetica').fontSize(8.5)
      .text(`Material ordenado por aula · generado el ${fmtFechaHora.format(ahora)}${usuario ? ` por ${limpio(usuario)}` : ''}`,
        X + 66, doc.y + 2, { width: ANCHO - 66 });
    doc.y = Math.max(doc.y, 22 + 54) + 14;

    // Resumen en cifras
    const cajas = [
      ['Artículos', fmtNumero.format(totales.articulos)],
      ['Unidades', fmtNumero.format(totales.unidades)],
      ['Aulas', fmtNumero.format(totales.espacios)],
      valores ? ['Valor total', fmtEuros.format(totales.valor)] : ['Código de familia', familia.codigo],
    ];
    const anchoCaja = (ANCHO - 3 * 8) / 4;
    const y = doc.y;
    cajas.forEach(([etiqueta, valor], i) => {
      const cx = X + i * (anchoCaja + 8);
      doc.roundedRect(cx, y, anchoCaja, 40, 5).fill(C.fondo);
      doc.fillColor(C.tinta).font('Helvetica-Bold').fontSize(14).text(valor, cx + 10, y + 7, { width: anchoCaja - 20 });
      doc.fillColor(C.tenue).font('Helvetica').fontSize(7.5).text(etiqueta.toUpperCase(), cx + 10, y + 26, { width: anchoCaja - 20, characterSpacing: 0.4 });
    });
    doc.y = y + 50;

    // Estado de revisión
    const [textoRev, colorRev] = REVISION[familia.revision.estado];
    const detalleRev = familia.ultimo_repaso
      ? `Último repaso: ${fmtFecha.format(new Date(familia.ultimo_repaso))} (${haceDias(familia.revision.dias)})`
      : 'No consta ningún repaso del inventario';
    doc.circle(X + 4, doc.y + 4.5, 3.5).fill(colorRev);
    doc.fillColor(colorRev).font('Helvetica-Bold').fontSize(9).text(textoRev, X + 13, doc.y, { continued: true })
      .fillColor(C.tenue).font('Helvetica').text(`   ${detalleRev}${totales.bajas ? `   ·   Incluye ${totales.bajas} artículos dados de baja` : ''}`);
    doc.y += 10;
  }

  function cabeceraContinuacion() {
    doc.rect(0, 0, doc.page.width, 4).fill(familia.color);
    doc.fillColor(C.tenue).font('Helvetica').fontSize(8)
      .text(limpio(`Inventario de ${familia.nombre} · ${CENTRO}`), X, 22, { width: ANCHO });
    doc.moveTo(X, 36).lineTo(X + ANCHO, 36).lineWidth(0.5).strokeColor(C.linea).stroke();
    doc.y = 46;
  }

  function nuevaPagina() {
    doc.addPage();
    cabeceraContinuacion();
  }

  function tituloPlanta(planta) {
    if (doc.y + 70 > LIMITE()) nuevaPagina();
    doc.y += 6;
    doc.fillColor(C.marino).font('Helvetica-Bold').fontSize(10.5)
      .text(limpio(planta.nombre).toUpperCase(), X, doc.y, { characterSpacing: 1 });
    doc.moveTo(X, doc.y + 2).lineTo(X + ANCHO, doc.y + 2).lineWidth(1.2).strokeColor(C.marino).stroke();
    doc.y += 8;
  }

  function cabeceraAula(espacio, planta, continuacion = false) {
    const activos = espacio.articulos.filter((a) => a.estado !== 'baja');
    const uds = activos.reduce((s, a) => s + a.cantidad, 0);
    const y = doc.y;
    doc.roundedRect(X, y, ANCHO, 20, 4).fill(C.fondo);
    doc.rect(X, y, 3, 20).fill(familia.color);
    doc.fillColor(C.tinta).font('Helvetica-Bold').fontSize(9.5)
      .text(limpio(`${espacio.codigo} · ${espacio.nombre}${continuacion ? ' (continuación)' : ''}`), X + 10, y + 6, { width: ANCHO - 170, lineBreak: false, ellipsis: true });
    doc.fillColor(C.tenue).font('Helvetica').fontSize(8)
      .text(`${limpio(planta.nombre)} · ${activos.length} art. · ${fmtNumero.format(uds)} uds.`, X + ANCHO - 160, y + 6.5, { width: 150, align: 'right' });
    doc.y = y + 24;
    // Cabecera de columnas (todas a la misma altura: text() mueve doc.y)
    const yColumnas = doc.y;
    doc.fillColor(C.tenue).font('Helvetica-Bold').fontSize(6.8);
    for (const c of columnas) {
      if (c.titulo) doc.text(c.titulo.toUpperCase(), c.x + 3, yColumnas, { width: c.ancho - 6, align: c.derecha ? 'right' : 'left', characterSpacing: 0.3, lineBreak: false });
    }
    doc.y = yColumnas + 10;
    doc.moveTo(X, doc.y).lineTo(X + ANCHO, doc.y).lineWidth(0.6).strokeColor(C.linea).stroke();
    doc.y += 1;
  }

  function filaArticulo(a) {
    const detalle = [a.marca, a.modelo, a.numero_serie && `S/N ${a.numero_serie}`].filter(Boolean).join(' · ');
    const anchoArt = col('articulo').ancho - 6;
    doc.font('Helvetica-Bold').fontSize(8.3);
    let alto = doc.heightOfString(limpio(a.nombre), { width: anchoArt });
    if (detalle) { doc.font('Helvetica').fontSize(7); alto += doc.heightOfString(limpio(detalle), { width: anchoArt }) + 1; }
    doc.font('Helvetica').fontSize(7.8);
    alto = Math.max(alto,
      doc.heightOfString(limpio(a.categoria_nombre ?? '—'), { width: col('categoria').ancho - 6 }),
      doc.heightOfString(limpio(a.ubicacion_detalle || '—'), { width: col('ubicacion').ancho - 6 }));
    return { alto: alto + 8, detalle };
  }

  function pintarFila(a, { alto, detalle }, par) {
    const y = doc.y;
    const baja = a.estado === 'baja';
    if (par) doc.rect(X, y, ANCHO, alto).fill('#fafbfd');
    // Casilla para marcar en la revisión física
    doc.rect(col('check').x + 3, y + 4, 8.5, 8.5).lineWidth(0.7).strokeColor('#9aa1bd').stroke();

    const texto = (id, valor, opciones = {}) => doc.text(limpio(valor), col(id).x + 3, y + 4, { width: col(id).ancho - 6, ...opciones });
    doc.fillColor(C.tenue).font('Courier-Bold').fontSize(7.6);
    texto('codigo', a.codigo);
    doc.fillColor(baja ? C.tenue : C.tinta).font('Helvetica-Bold').fontSize(8.3);
    texto('articulo', a.nombre, { strike: baja });
    if (detalle) doc.fillColor(C.tenue).font('Helvetica').fontSize(7).text(limpio(detalle), col('articulo').x + 3, doc.y + 1, { width: col('articulo').ancho - 6 });
    doc.fillColor(C.tinta).font('Helvetica').fontSize(7.8);
    texto('categoria', a.categoria_nombre ?? '—');
    texto('ubicacion', a.ubicacion_detalle || '—');
    doc.fillColor(COLOR_ESTADO[a.estado]).font('Helvetica-Bold').fontSize(7.6);
    texto('estado', ESTADOS[a.estado]);
    doc.fillColor(C.tinta).font('Helvetica-Bold').fontSize(8.5);
    texto('cantidad', fmtNumero.format(a.cantidad), { align: 'right' });
    if (valores) {
      doc.font('Helvetica').fontSize(7.8);
      texto('valor', a.valor == null ? '—' : fmtEuros.format(a.valor * a.cantidad), { align: 'right' });
    }
    doc.moveTo(X, y + alto).lineTo(X + ANCHO, y + alto).lineWidth(0.4).strokeColor(C.linea).stroke();
    doc.y = y + alto;
  }

  function bloqueFirma() {
    const alto = 118;
    if (doc.y + alto + 16 > LIMITE()) nuevaPagina();
    doc.y += 16;
    const y = doc.y;
    doc.roundedRect(X, y, ANCHO, alto, 6).lineWidth(0.8).strokeColor(C.linea).stroke();
    doc.fillColor(C.tinta).font('Helvetica-Bold').fontSize(10).text('Revisión física del inventario', X + 14, y + 12);
    doc.fillColor(C.tenue).font('Helvetica').fontSize(7.8).text(
      'Marque la casilla de cada artículo comprobado. Después registre la revisión en el Superinventario '
      + '(Familias > Revisar) para que conste la fecha del último repaso.', X + 14, y + 27, { width: ANCHO - 28 });
    const linea = (etiqueta, lx, ly, ancho) => {
      doc.fillColor(C.tenue).font('Helvetica').fontSize(8).text(etiqueta, lx, ly);
      doc.moveTo(lx + doc.widthOfString(etiqueta) + 4, ly + 9).lineTo(lx + ancho, ly + 9).lineWidth(0.6).strokeColor('#9aa1bd').stroke();
    };
    const mitad = (ANCHO - 28) / 2;
    linea('Revisado por:', X + 14, y + 56, mitad - 12);
    linea('Fecha:', X + 14 + mitad + 12, y + 56, mitad - 12);
    linea('Firma:', X + 14, y + 80, mitad - 12);
    linea('Observaciones:', X + 14 + mitad + 12, y + 80, mitad - 12);
    doc.moveTo(X + 14, y + 104).lineTo(X + ANCHO - 14, y + 104).lineWidth(0.6).strokeColor('#9aa1bd').stroke();
    doc.y = y + alto;
  }

  function piesDePagina() {
    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      const margenInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // escribir en el margen sin crear páginas nuevas
      const y = doc.page.height - 34;
      doc.moveTo(X, y - 6).lineTo(X + ANCHO, y - 6).lineWidth(0.5).strokeColor(C.linea).stroke();
      doc.fillColor(C.tenue).font('Helvetica').fontSize(7.5)
        .text(limpio(`Superinventario · ${CENTRO} · ${familia.nombre}`), X, y, { width: ANCHO - 90, lineBreak: false, ellipsis: true });
      doc.text(`Página ${i - start + 1} de ${count}`, X + ANCHO - 90, y, { width: 90, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margenInferior;
    }
  }

  // ── Composición ───────────────────────────────────────────────────────
  cabeceraPrincipal();

  if (!datos.plantas.length) {
    doc.y += 20;
    doc.fillColor(C.tenue).font('Helvetica').fontSize(11)
      .text('Esta familia no tiene material registrado en el inventario.', X, doc.y, { width: ANCHO, align: 'center' });
  }

  for (const planta of datos.plantas) {
    tituloPlanta(planta);
    for (const espacio of planta.espacios) {
      const medidas = espacio.articulos.map((a) => filaArticulo(a));
      // Cabecera de aula + al menos la primera fila en la misma página.
      if (doc.y + 36 + (medidas[0]?.alto ?? 0) > LIMITE()) nuevaPagina();
      cabeceraAula(espacio, planta);
      espacio.articulos.forEach((a, i) => {
        if (doc.y + medidas[i].alto > LIMITE()) {
          nuevaPagina();
          cabeceraAula(espacio, planta, true);
        }
        pintarFila(a, medidas[i], i % 2 === 1);
      });
      doc.y += 12;
    }
  }

  bloqueFirma();
  piesDePagina();
  doc.end();
  return terminado.then((pdf) => ({ pdf, familia }));
}
