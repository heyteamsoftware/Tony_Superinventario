import { api, consulta } from '../api.js';
import { meta, familia } from '../estado.js';
import { alCambiarInventario, notificarCambio } from '../cambios.js';
import {
  html, pintar, on, $, $$, numero, plural, haceTiempo, estadoBadge, chipFamilia, abrirDialogo, leerFormulario,
  aviso, avisoError,
} from '../ui.js';
import {
  formularioArticulo, abrirFicha, opcionesEspacios, opcionesFamilias, opcionesCategorias, opcionesEstados,
} from '../componentes/articulo.js';

const FILTROS = ['q', 'familia', 'planta', 'espacio', 'categoria', 'estado', 'bajas', 'orden', 'dir', 'pagina'];
const POR_PAGINA = 50;

const COLUMNAS = [
  { id: 'codigo', titulo: 'Código' },
  { id: 'nombre', titulo: 'Artículo' },
  { id: 'familia', titulo: 'Familia' },
  { id: 'espacio', titulo: 'Espacio' },
  { id: 'categoria', titulo: 'Categoría' },
  { id: 'cantidad', titulo: 'Cant.', num: true },
  { id: 'estado', titulo: 'Estado' },
  { id: 'actualizado', titulo: 'Comprobado' },
];

export function montar(raiz, { query }) {
  const filtros = Object.fromEntries(FILTROS.map((k) => [k, query[k] ?? '']));
  filtros.orden ||= 'codigo';
  filtros.dir ||= 'asc';
  const seleccion = new Set();
  let datos = { items: [], total: 0 };

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera">
        <div class="titulo"><h1>Inventario</h1><p data-resumen>Todo el material del centro en una tabla.</p></div>
        <div class="acciones">
          <a class="boton" data-exportar href="#">⭳ Exportar a Excel</a>
          <button type="button" class="boton primario" data-accion="nuevo">＋ Nuevo artículo</button>
        </div>
      </div>
      <div class="tarjeta">
        <form class="filtros" data-filtros>
          <label class="campo buscar"><span>Buscar</span>
            <input type="search" name="q" value="${filtros.q}" placeholder="Nombre, código, marca, nº de serie…"></label>
          <label class="campo"><span>Familia</span><select name="familia">${opcionesFamilias(filtros.familia, { vacia: 'Todas' })}</select></label>
          <label class="campo"><span>Planta</span><select name="planta"><option value="">Todas</option>
            ${meta.plantas.map((p) => html`<option value="${p.id}" ${String(p.id) === filtros.planta ? 'selected' : ''}>${p.nombre}</option>`)}</select></label>
          <label class="campo"><span>Espacio</span><select name="espacio"><option value="">Todos</option>${opcionesEspacios(filtros.espacio)}</select></label>
          <label class="campo"><span>Categoría</span><select name="categoria">${opcionesCategorias(filtros.categoria, { vacia: 'Todas' })}
            <option value="sin" ${filtros.categoria === 'sin' ? 'selected' : ''}>— Sin categoría —</option></select></label>
          <label class="campo"><span>Estado</span><select name="estado"><option value="">Activos</option>${opcionesEstados(filtros.estado, { conBaja: true })}</select></label>
          <div class="campo"><span>&nbsp;</span>
            <label class="casilla" style="height:38px"><input type="checkbox" name="bajas" ${filtros.bajas === 'incluir' ? 'checked' : ''}> Incluir bajas</label></div>
        </form>
        <div class="tabla-envoltorio" data-tabla><div class="cargando"></div></div>
        <div class="paginacion" data-paginacion></div>
      </div>
      <div data-lote></div>
    </div>`);

  const el = {
    filtros: $('[data-filtros]', raiz), tabla: $('[data-tabla]', raiz), paginacion: $('[data-paginacion]', raiz),
    lote: $('[data-lote]', raiz), resumen: $('[data-resumen]', raiz), exportar: $('[data-exportar]', raiz),
  };

  const parametros = () => ({ ...filtros, pagina: filtros.pagina || 1 });

  async function cargar() {
    history.replaceState(null, '', `#/inventario${consulta({ ...filtros, orden: filtros.orden === 'codigo' ? '' : filtros.orden, dir: filtros.dir === 'asc' ? '' : filtros.dir, pagina: filtros.pagina > 1 ? filtros.pagina : '' })}`);
    el.exportar.href = `/api/articulos/exportar.csv${consulta({ ...filtros, pagina: '' })}`;
    try {
      datos = await api.get(`/articulos${consulta({ ...parametros(), por_pagina: POR_PAGINA })}`);
      pintarTabla();
    } catch (err) {
      avisoError(err);
    }
  }

  function pintarTabla() {
    const { items, total } = datos;
    const pagina = Number(filtros.pagina || 1);
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const plazo = meta.ajustes.dias_aviso_revision;
    const unidades = items.reduce((s, a) => s + a.cantidad, 0);
    el.resumen.textContent = `${plural(total, 'artículo encontrado', 'artículos encontrados')}${items.length ? ` · ${numero(unidades)} unidades en esta página` : ''}`;

    if (!items.length) {
      pintar(el.tabla, html`<div class="vacio"><span class="icono-grande">🔍</span>No hay artículos con estos filtros.</div>`);
    } else {
      const todos = items.every((a) => seleccion.has(a.id));
      pintar(el.tabla, html`
        <table class="tabla">
          <thead><tr>
            <th class="col-check"><input type="checkbox" data-todos ${todos ? 'checked' : ''} aria-label="Seleccionar todos"></th>
            ${COLUMNAS.map((c) => html`<th class="${c.num ? 'num' : ''}"><button type="button" data-orden="${c.id}">${c.titulo}${filtros.orden === c.id ? html`<span class="flecha">${filtros.dir === 'desc' ? '↓' : '↑'}</span>` : ''}</button></th>`)}
          </tr></thead>
          <tbody>
            ${items.map((a) => {
              const f = familia(a.familia_id) ?? { color: a.familia_color, codigo: a.familia_codigo, nombre: a.familia_nombre };
              const viejo = (Date.now() - Date.parse(a.revisado_en)) / 86_400_000 > plazo;
              return html`<tr class="clicable ${seleccion.has(a.id) ? 'seleccionada' : ''} ${a.estado === 'baja' ? 'baja' : ''}" data-id="${a.id}">
                <td class="col-check"><input type="checkbox" data-sel ${seleccion.has(a.id) ? 'checked' : ''} aria-label="Seleccionar ${a.codigo}"></td>
                <td class="mono">${a.codigo}</td>
                <td><div class="principal">${a.nombre}</div><div class="secundario">${[a.marca, a.modelo, a.numero_serie && `S/N ${a.numero_serie}`].filter(Boolean).join(' · ')}</div></td>
                <td>${chipFamilia(f, { corto: true })}</td>
                <td><a href="#/plano?espacio=${a.espacio_id}" data-ir-plano title="Ver en el plano"><span class="mono">${a.espacio_codigo}</span></a>
                  <div class="secundario">${a.espacio_nombre}</div></td>
                <td>${a.categoria_nombre ?? html`<span class="tenue">—</span>`}</td>
                <td class="num"><b>${numero(a.cantidad)}</b></td>
                <td>${estadoBadge(a.estado)}</td>
                <td class="${viejo ? '' : 'tenue'}" style="${viejo ? 'color:var(--peligro);font-weight:600' : ''}">${haceTiempo(a.revisado_en)}</td>
              </tr>`;
            })}
          </tbody>
        </table>`);
    }

    pintar(el.paginacion, html`
      <span>Página ${pagina} de ${paginas}</span>
      <span class="acciones">
        <button type="button" class="boton pequeno" data-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <button type="button" class="boton pequeno" data-pagina="${pagina + 1}" ${pagina >= paginas ? 'disabled' : ''}>Siguiente →</button>
      </span>`);
    pintarLote();
  }

  function pintarLote() {
    if (!seleccion.size) { pintar(el.lote, ''); return; }
    pintar(el.lote, html`
      <div class="barra-lote no-imprimir">
        <b>${plural(seleccion.size, 'seleccionado', 'seleccionados')}</b>
        <button type="button" class="boton pequeno" data-lote="trasladar">➜ Trasladar</button>
        <button type="button" class="boton pequeno" data-lote="estado">◐ Cambiar estado</button>
        <a class="boton pequeno" href="#/etiquetas?ids=${[...seleccion].join(',')}">🏷 Etiquetas</a>
        <button type="button" class="boton pequeno" data-lote="limpiar">✕</button>
      </div>`);
  }

  async function accionLote(tipo) {
    const ids = [...seleccion];
    const esTraslado = tipo === 'trasladar';
    const r = await abrirDialogo({
      titulo: esTraslado ? `Trasladar ${ids.length} artículos` : `Cambiar el estado de ${ids.length} artículos`,
      clase: 'estrecho',
      cuerpo: esTraslado
        ? html`<label class="campo"><span class="obligatorio">Llevar a</span><select name="espacio_id" data-tipo="entero" required>
            <option value="">Elige el espacio…</option>${opcionesEspacios(null)}</select></label>
            <label class="campo"><span>Motivo (opcional)</span><input name="motivo" maxlength="500"></label>
            <p class="tenue pequeno">Se mueven todas las unidades de cada artículo. Los que ya estén allí o estén de baja se omiten.</p>`
        : html`<label class="campo"><span class="obligatorio">Nuevo estado</span><select name="estado">${opcionesEstados('bueno')}</select></label>`,
      pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button><button type="submit" class="boton primario">Aplicar</button>`,
      alEnviar: (form) => api.post(esTraslado ? '/articulos/lote/traslado' : '/articulos/lote/estado', { ids, ...leerFormulario(form) }),
    });
    if (!r) return;
    aviso(`${plural(r.procesados, 'artículo actualizado', 'artículos actualizados')}${r.omitidos ? ` · ${r.omitidos} sin cambios` : ''}`);
    seleccion.clear();
    await notificarCambio();
  }

  // ── Eventos ─────────────────────────────────────────────────────────────
  let temporizador;
  el.filtros.addEventListener('input', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => aplicarFiltros(), e.target.name === 'q' ? 300 : 0);
  });
  el.filtros.addEventListener('submit', (e) => { e.preventDefault(); aplicarFiltros(); });
  function aplicarFiltros() {
    const f = leerFormulario(el.filtros);
    for (const k of ['q', 'familia', 'planta', 'espacio', 'categoria', 'estado']) filtros[k] = f[k] ?? '';
    filtros.bajas = f.bajas ? 'incluir' : '';
    filtros.pagina = '';
    cargar();
  }

  on(el.tabla, 'click', '[data-orden]', (e, b) => {
    filtros.dir = filtros.orden === b.dataset.orden && filtros.dir === 'asc' ? 'desc' : 'asc';
    filtros.orden = b.dataset.orden;
    cargar();
  });
  on(el.tabla, 'change', '[data-todos]', (e, c) => {
    datos.items.forEach((a) => (c.checked ? seleccion.add(a.id) : seleccion.delete(a.id)));
    pintarTabla();
  });
  on(el.tabla, 'click', 'tbody tr', (e, tr) => {
    if (e.target.closest('a')) return;
    const id = Number(tr.dataset.id);
    if (e.target.closest('[data-sel], .col-check')) {
      if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
      pintarTabla();
      return;
    }
    abrirFicha(id);
  });
  on(el.paginacion, 'click', '[data-pagina]', (e, b) => { filtros.pagina = b.dataset.pagina; cargar(); raiz.scrollIntoView(); });
  on(raiz, 'click', '[data-accion="nuevo"]', () => formularioArticulo({
    valores: { familia_id: Number(filtros.familia) || null, espacio_id: Number(filtros.espacio) || null },
  }));
  on(el.lote, 'click', '[data-lote]', (e, b) => {
    if (b.dataset.lote === 'limpiar') { seleccion.clear(); pintarTabla(); return; }
    accionLote(b.dataset.lote).catch(avisoError);
  });

  const quitar = alCambiarInventario(cargar);
  cargar();
  return () => { quitar(); clearTimeout(temporizador); $$('.barra-lote').forEach((b) => b.remove()); };
}
