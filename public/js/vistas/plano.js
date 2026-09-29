import { api, consulta } from '../api.js';
import { meta, familia, espacio, plantaPorCodigo, espaciosDePlanta, numeroPlanta } from '../estado.js';
import { alCambiarInventario } from '../cambios.js';
import {
  html, crudo, pintar, on, $, $$, escapar, colorTexto, numero, plural, haceTiempo,
  estadoBadge, chipFamilia, revisionBadge, avisoError,
} from '../ui.js';
import { formularioArticulo, abrirFicha } from '../componentes/articulo.js';
import { dialogoRevision, dialogoEspacio } from '../componentes/revision.js';

// ── Colores de los modos del plano ─────────────────────────────────────────
const COLOR_REVISION = { al_dia: '#b7ecd0', pronto: '#ffdf9e', vencida: '#ffb8c3', nunca: '#e1e4ee' };
const GRAVEDAD = { vencida: 3, nunca: 2, pronto: 1, al_dia: 0 };
const SIN_DATOS = '#f1f2f6';

function mezclar(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// Estado de revisión que se pinta en un aula: el de la familia filtrada o,
// sin filtro, el peor de las familias con material o uso habitual allí.
function revisionDeSala(estadoRevisiones, espacioId, familiaId) {
  const lista = estadoRevisiones[espacioId] ?? [];
  if (familiaId) return lista.find((r) => r.familia_id === familiaId)?.revision ?? null;
  return lista.map((r) => r.revision).sort((x, y) => GRAVEDAD[y.estado] - GRAVEDAD[x.estado])[0] ?? null;
}

export function montar(raiz, { query }) {
  const estado = {
    planta: plantaPorCodigo(query.planta)?.id ?? plantaPorCodigo('PB')?.id ?? meta.plantas[0]?.id,
    espacio: espacio(query.espacio)?.id ?? null,
    familia: familia(query.familia)?.id ?? null,
    modo: ['plano', 'material', 'revision'].includes(query.modo) ? query.modo : 'plano',
    q: query.q ?? '',
    filtroSala: null, // familia elegida dentro del panel del aula
    textoSala: '',
  };
  if (estado.espacio) estado.planta = espacio(estado.espacio).planta_id;

  let ocupacion = {};          // espacio_id -> { articulos, unidades, familias }
  let revisiones = {};         // espacio_id -> [{ familia_id, revision, ... }]
  let articulosSala = [];
  let peticion = 0;

  pintar(raiz, html`
    <div class="plano-vista">
      <aside class="ascensor" aria-label="Plantas" data-ascensor></aside>
      <section class="lienzo">
        <div class="barra-plano">
          <div><h1 data-titulo></h1><div class="sub" data-subtitulo></div></div>
          <div class="segmentado" role="group" aria-label="Cómo colorear el plano" data-modos>
            <button type="button" data-modo="plano">🎨 Plano</button>
            <button type="button" data-modo="material">▦ Material</button>
            <button type="button" data-modo="revision">✓ Revisiones</button>
          </div>
          <label class="buscar-plano"><span class="solo-lector">Buscar material en el plano</span>
            <input class="control" type="search" placeholder="¿Dónde está…? (ej. microscopio)" value="${estado.q}" data-buscar></label>
        </div>
        <div class="familias-filtro" data-familias role="group" aria-label="Filtrar por familia"></div>
        <div data-aviso></div>
        <div class="zona-plano" data-zona></div>
      </section>
      <aside class="panel" data-panel aria-live="polite"></aside>
    </div>`);

  const el = {
    ascensor: $('[data-ascensor]', raiz), titulo: $('[data-titulo]', raiz), subtitulo: $('[data-subtitulo]', raiz),
    modos: $('[data-modos]', raiz), familias: $('[data-familias]', raiz), aviso: $('[data-aviso]', raiz),
    zona: $('[data-zona]', raiz), panel: $('[data-panel]', raiz), buscar: $('[data-buscar]', raiz),
  };

  // Mantiene el estado en la URL sin recargar la vista (enlaces compartibles).
  function sincronizarUrl() {
    const p = meta.plantas.find((x) => x.id === estado.planta);
    const url = `#/plano${consulta({
      planta: p?.codigo, espacio: estado.espacio, familia: estado.familia,
      modo: estado.modo !== 'plano' ? estado.modo : '', q: estado.q,
    })}`;
    history.replaceState(null, '', url);
  }

  async function cargarDatos() {
    const id = ++peticion;
    const [occ, rev] = await Promise.all([
      api.get(`/plano/ocupacion${consulta({ familia: estado.familia, q: estado.q })}`),
      api.get('/plano/revisiones'),
    ]);
    if (id !== peticion) return false; // llegó una petición más reciente
    ocupacion = Object.fromEntries(occ.map((o) => [o.espacio_id, o]));
    revisiones = rev;
    return true;
  }

  async function cargarSala() {
    if (!estado.espacio) { articulosSala = []; return; }
    const res = await api.get(`/articulos${consulta({ espacio: estado.espacio, por_pagina: 500, orden: 'nombre' })}`);
    articulosSala = res.items;
  }

  // ── Ascensor (selector de planta) ─────────────────────────────────────────
  function pintarAscensor() {
    const porPlanta = (pid) => espaciosDePlanta(pid).reduce((s, e) => s + (ocupacion[e.id]?.articulos ?? 0), 0);
    const total = meta.plantas.reduce((s, p) => s + porPlanta(p.id), 0);
    pintar(el.ascensor, html`
      <div class="ascensor-titulo">Plantas</div>
      ${meta.plantas.map((p) => {
        const n = porPlanta(p.id);
        return html`
          <button type="button" class="boton-planta ${p.id === estado.planta ? 'activa' : ''}" data-planta="${p.id}"
                  aria-pressed="${p.id === estado.planta}" title="${p.nombre}">
            ${estado.q && n ? html`<span class="coincide" title="Resultados en esta planta">${n}</span>` : ''}
            <span class="num">${numeroPlanta(p)}</span>
            <span class="nombre">${p.nombre}</span>
            <span class="cuenta">${plural(n, 'artículo', 'artículos')}</span>
          </button>`;
      })}
      <div class="resumen-edificio"><b>${numero(total)}</b>${estado.familia || estado.q ? 'artículos filtrados' : 'artículos en el centro'}</div>`);
  }

  // ── Barra de familias ─────────────────────────────────────────────────────
  function pintarFamilias() {
    pintar(el.familias, html`
      <button type="button" class="chip-filtro ${estado.familia ? '' : 'activo'}" data-familia="">Todas las familias</button>
      ${meta.familias.map((f) => html`
        <button type="button" class="chip-filtro ${f.id === estado.familia ? 'activo' : ''}" style="--c:${f.color}" data-familia="${f.id}"
                title="${f.nombre} · ${f.revision.estado === 'vencida' ? 'revisión vencida' : `${f.articulos} artículos`}">
          <span class="punto"></span>${f.nombre}
          ${f.revision.estado === 'vencida' ? html`<span class="alerta-mini" aria-label="revisión vencida">!</span>` : ''}
        </button>`)}`);
  }

  function pintarAviso() {
    const vencidas = meta.familias.filter((f) => f.revision.estado === 'vencida');
    const nunca = meta.familias.filter((f) => f.revision.estado === 'nunca');
    const dias = meta.ajustes.dias_aviso_revision;
    if (vencidas.length) {
      pintar(el.aviso, html`<div class="alerta aviso-plano"><span class="ico">⚠</span><div class="texto">
        <b>${plural(vencidas.length, 'familia lleva', 'familias llevan')} más de ${dias} días sin repasar su inventario:</b>
        ${vencidas.map((f) => f.nombre).join(', ')}.</div>
        <a class="boton pequeno" href="#/familias">Ver familias</a></div>`);
    } else if (nunca.length) {
      pintar(el.aviso, html`<div class="alerta info aviso-plano"><span class="ico">ℹ</span><div class="texto">
        ${plural(nunca.length, 'familia no ha', 'familias no han')} registrado todavía ninguna revisión ni material.
        Pincha en un aula y usa <b>“Añadir material”</b> o <b>“Revisar aula”</b> para empezar.</div></div>`);
    } else {
      pintar(el.aviso, '');
    }
  }

  // ── Plano SVG ─────────────────────────────────────────────────────────────
  function colorDeSala(e) {
    const occ = ocupacion[e.id];
    if (estado.modo === 'material') {
      const max = Math.max(1, ...espaciosDePlanta(estado.planta).map((x) => ocupacion[x.id]?.articulos ?? 0));
      return occ?.articulos ? mezclar('#e3e6ff', '#3b33c9', Math.sqrt(occ.articulos / max)) : SIN_DATOS;
    }
    if (estado.modo === 'revision') {
      const rev = revisionDeSala(revisiones, e.id, estado.familia);
      return rev ? COLOR_REVISION[rev.estado] : SIN_DATOS;
    }
    return e.color ?? '#ffffff';
  }

  function pintarPlano() {
    const salas = espaciosDePlanta(estado.planta);
    const p = meta.plantas.find((x) => x.id === estado.planta);
    const fam = familia(estado.familia);
    el.titulo.textContent = p?.nombre ?? '';
    el.subtitulo.textContent = fam ? `Mostrando el material de ${fam.nombre}` : `${salas.length} espacios · pincha en un aula para gestionar su material`;
    $$('[data-modo]', el.modos).forEach((b) => b.classList.toggle('activo', b.dataset.modo === estado.modo));

    if (!salas.length) { pintar(el.zona, html`<div class="vacio">Esta planta no tiene espacios.</div>`); return; }
    const minX = Math.min(...salas.map((s) => s.x)) - 14;
    const minY = Math.min(...salas.map((s) => s.y)) - 14;
    const maxX = Math.max(...salas.map((s) => s.x + s.w)) + 14;
    const maxY = Math.max(...salas.map((s) => s.y + s.h)) + 14;
    const filtrando = Boolean(estado.familia || estado.q);

    const grupos = salas.map((e) => {
      const occ = ocupacion[e.id];
      const n = occ?.articulos ?? 0;
      const habitual = estado.familia && e.familia_ids.includes(estado.familia);
      const clases = ['sala'];
      if (e.tipo === 'comun' && estado.modo === 'plano') clases.push('comun');
      if (filtrando && !n && !habitual && estado.modo !== 'revision') clases.push('atenuada');
      if (estado.q && n) clases.push('coincide');
      if (habitual && !estado.q) clases.push('habitual');
      if (e.id === estado.espacio) clases.push('seleccionada');

      const fondo = colorDeSala(e);
      const texto = colorTexto(fondo === '#ffffff' || e.tipo === 'comun' ? null : fondo);
      const estrecha = e.w < 100 || e.h < 100;
      const rev = revisionDeSala(revisiones, e.id, estado.familia);
      const titulo = `${e.codigo} · ${e.nombre} — ${n} artículos${rev ? ` · revisión: ${rev.estado.replace('_', ' ')}` : ''}`;

      return `
        <g class="${clases.join(' ')}" data-sala="${e.id}" tabindex="0" role="button" aria-label="${escapar(titulo)}"
           style="--c:${fam?.color ?? '#4f46e5'}">
          <title>${escapar(titulo)}</title>
          <rect class="fondo" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="5" fill="${fondo}"></rect>
          <foreignObject class="contenido" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}">
            <div xmlns="http://www.w3.org/1999/xhtml" class="etiqueta-sala${estrecha ? ' estrecha' : ''}" style="color:${texto}">
              <span class="cod">${escapar(e.codigo)}</span>
              <span class="nom">${escapar(e.nombre)}</span>
              ${e.grupos && e.grupos !== e.nombre ? `<span class="gru">${escapar(e.grupos.split('\n').slice(0, 3).join(' · '))}</span>` : ''}
            </div>
          </foreignObject>
          ${n ? `<g class="insignia-sala"><rect x="${e.x + e.w - 34}" y="${e.y + 5}" width="29" height="19" rx="9.5"></rect>
                 <text x="${e.x + e.w - 19.5}" y="${e.y + 18.5}" text-anchor="middle">${n > 999 ? '999+' : n}</text></g>` : ''}
        </g>`;
    }).join('');

    const sel = salas.find((s) => s.id === estado.espacio);
    const marco = sel ? `<rect class="sala sel-marco" x="${sel.x - 3}" y="${sel.y - 3}" width="${sel.w + 6}" height="${sel.h + 6}" rx="8"
        fill="none" stroke="#4f46e5" stroke-width="3.5" style="filter:drop-shadow(0 4px 10px rgba(79,70,229,.45))"></rect>` : '';

    const leyendas = {
      plano: fam
        ? html`<span><span class="muestra" style="background:${fam.color}"></span>Con material de ${fam.nombre}</span>
               <span><span class="muestra" style="border:2px dashed ${fam.color}"></span>Uso habitual</span>`
        : html`<span>Colores del plano del centro · la cifra indica los artículos del aula</span>`,
      material: html`<span>Menos</span><span class="degradado"></span><span>Más artículos</span>`,
      revision: html`${Object.entries({ al_dia: 'Al día', pronto: 'Revisar pronto', vencida: 'Vencida', nunca: 'Sin revisar' }).map(([k, v]) => html`
        <span><span class="muestra" style="background:${COLOR_REVISION[k]}"></span>${v}</span>`)}
        <span class="tenue">${fam ? fam.nombre : 'peor estado de todas las familias'}</span>`,
    };

    pintar(el.zona, html`
      <svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Plano de ${p?.nombre ?? ''}">
        ${crudo(grupos)}${crudo(marco)}
      </svg>
      <div class="leyenda">${leyendas[estado.modo]}</div>`);
  }

  // ── Panel lateral ────────────────────────────────────────────────────────
  function pintarPanelPlanta() {
    const p = meta.plantas.find((x) => x.id === estado.planta);
    const salas = espaciosDePlanta(estado.planta);
    const totalArt = salas.reduce((s, e) => s + (ocupacion[e.id]?.articulos ?? 0), 0);
    const totalUds = salas.reduce((s, e) => s + (ocupacion[e.id]?.unidades ?? 0), 0);
    const ocupadas = salas.filter((e) => ocupacion[e.id]?.articulos).length;
    pintar(el.panel, html`
      <div class="panel-cabecera"><span class="franja"></span>
        <div class="meta">Resumen de planta</div>
        <h2>${p?.nombre}</h2>
        <p class="tenue" style="margin-top:6px">Pincha en un aula del plano para ver, añadir o revisar su material.</p>
      </div>
      <div class="panel-cuerpo">
        <div class="mini-kpis">
          <div class="mini-kpi"><b>${numero(totalArt)}</b><span>artículos</span></div>
          <div class="mini-kpi"><b>${numero(totalUds)}</b><span>unidades</span></div>
          <div class="mini-kpi"><b>${ocupadas}/${salas.length}</b><span>aulas con material</span></div>
        </div>
        <div>
          <div class="titulo-bloque"><h3>Espacios</h3></div>
          <div class="lista-espacios">
            ${salas.map((e) => {
              const rev = revisionDeSala(revisiones, e.id, estado.familia);
              return html`<button type="button" class="fila-espacio" data-ir-sala="${e.id}">
                <span class="muestra" style="background:${e.color ?? '#fff'}"></span>
                <span class="nombre"><span class="mono tenue">${e.codigo}</span> ${e.nombre}</span>
                ${estado.modo === 'revision' && rev ? revisionBadge(rev, { corto: true }) : ''}
                <span class="n">${numero(ocupacion[e.id]?.articulos ?? 0)}</span>
              </button>`;
            })}
          </div>
        </div>
      </div>`);
  }

  function pintarPanelSala() {
    const e = espacio(estado.espacio);
    const occ = ocupacion[e.id];
    const revSala = (revisiones[e.id] ?? []).slice().sort((a, b) => GRAVEDAD[b.revision.estado] - GRAVEDAD[a.revision.estado]);
    const texto = estado.textoSala.trim().toLowerCase();
    const presentes = [...new Set(articulosSala.map((a) => a.familia_id))].map(familia).filter(Boolean);
    const visibles = articulosSala.filter((a) =>
      (!estado.filtroSala || a.familia_id === estado.filtroSala)
      && (!texto || `${a.nombre} ${a.codigo} ${a.marca} ${a.modelo}`.toLowerCase().includes(texto)));
    const unidades = articulosSala.reduce((s, a) => s + a.cantidad, 0);
    const colorFranja = e.color ?? '#9aa1bd';

    pintar(el.panel, html`
      <div class="panel-cabecera">
        <span class="franja" style="--c:${colorFranja}"></span>
        <div class="meta"><span class="mono">${e.codigo}</span> · ${meta.tipos_espacio[e.tipo] ?? e.tipo} · ${e.planta_nombre}</div>
        <h2>${e.nombre}</h2>
        ${e.grupos && e.grupos !== e.nombre ? html`<div class="grupos">${e.grupos}</div>` : ''}
        ${e.familia_ids.length ? html`<div class="acciones" style="margin-top:10px">${e.familia_ids.map((id) => chipFamilia(familia(id)))}</div>` : ''}
        <div class="acciones" style="position:absolute;top:12px;right:12px">
          <button type="button" class="boton fantasma pequeno icono" data-accion="editar-sala" title="Editar datos del aula">✎</button>
          <button type="button" class="boton fantasma pequeno icono" data-accion="cerrar-sala" title="Cerrar (Esc)">✕</button>
        </div>
      </div>
      <div class="panel-cuerpo">
        <div class="acciones-panel">
          <button type="button" class="boton primario" data-accion="anadir">＋ Añadir material</button>
          <button type="button" class="boton exito" data-accion="revisar">✓ Revisar aula</button>
        </div>
        <div class="mini-kpis">
          <div class="mini-kpi"><b>${numero(articulosSala.length)}</b><span>artículos</span></div>
          <div class="mini-kpi"><b>${numero(unidades)}</b><span>unidades</span></div>
          <div class="mini-kpi"><b>${presentes.length}</b><span>${presentes.length === 1 ? 'familia' : 'familias'}</span></div>
        </div>

        ${revSala.length ? html`
          <div>
            <div class="titulo-bloque"><h3>Revisión por familia</h3></div>
            <div class="lista-revisiones">
              ${revSala.map((r) => {
                const f = familia(r.familia_id);
                return html`<div class="fila-revision">
                  <span class="punto" style="--c:${f.color}"></span>
                  <span class="nombre">${f.nombre}<small>${r.ultimo_repaso ? `Último repaso ${haceTiempo(r.ultimo_repaso)}` : 'Nunca revisado aquí'} · ${plural(r.articulos, 'artículo', 'artículos')}</small></span>
                  ${revisionBadge(r.revision, { corto: true })}
                  <button type="button" class="boton pequeno" data-accion="revisar" data-familia="${f.id}" title="Revisar ${f.nombre} en esta aula">Revisar</button>
                </div>`;
              })}
            </div>
          </div>` : ''}

        <div>
          <div class="titulo-bloque"><h3>Material del aula</h3>
            <a class="pequeno" href="#/inventario?espacio=${e.id}">Ver en tabla →</a></div>
          ${articulosSala.length > 6 ? html`<input class="control" type="search" placeholder="Filtrar en esta aula…" value="${estado.textoSala}" data-filtro-sala style="margin-bottom:8px">` : ''}
          ${presentes.length > 1 ? html`<div class="pestanas-familia" style="margin-bottom:10px">
            <button type="button" class="chip ${estado.filtroSala ? '' : 'activo'}" data-filtro-familia="">Todas (${articulosSala.length})</button>
            ${presentes.map((f) => html`<button type="button" class="chip ${f.id === estado.filtroSala ? 'activo' : ''}" data-filtro-familia="${f.id}" style="--c:${f.color}">
              <span class="punto"></span>${f.codigo} (${articulosSala.filter((a) => a.familia_id === f.id).length})</button>`)}
          </div>` : ''}
          ${visibles.length ? html`<div class="lista-articulos" data-lista-sala>
            ${visibles.map((a) => html`
              <button type="button" class="item-articulo" data-articulo="${a.id}" style="--c:${a.familia_color}">
                <span class="barra"></span>
                <span style="min-width:0"><span class="nom" style="display:block">${a.nombre}</span>
                  <span class="det"><span class="mono">${a.codigo}</span>${a.estado !== 'bueno' ? estadoBadge(a.estado) : ''}
                    ${a.ubicacion_detalle ? html`<span>· ${a.ubicacion_detalle}</span>` : ''}</span></span>
                <span class="cant">${numero(a.cantidad)}<small>uds.</small></span>
              </button>`)}
          </div>` : html`<div class="vacio"><span class="icono-grande">📦</span>
            ${articulosSala.length ? 'Nada coincide con el filtro.' : 'Todavía no hay material registrado en este espacio.'}
            ${articulosSala.length ? '' : html`<div style="margin-top:12px"><button type="button" class="boton primario" data-accion="anadir">＋ Añadir el primero</button></div>`}
          </div>`}
        </div>
        ${occ && estado.familia ? html`<p class="tenue pequeno">El plano está filtrado por ${familia(estado.familia).nombre}; aquí se muestra todo el material del aula.</p>` : ''}
      </div>`);
  }

  function pintarPanel() {
    if (estado.espacio) pintarPanelSala();
    else pintarPanelPlanta();
  }

  function pintarTodo() {
    pintarAscensor();
    pintarFamilias();
    pintarAviso();
    pintarPlano();
    pintarPanel();
    sincronizarUrl();
  }

  async function refrescar({ sala = true } = {}) {
    try {
      const [ok] = await Promise.all([cargarDatos(), sala ? cargarSala() : null]);
      if (ok !== false) pintarTodo();
    } catch (err) {
      avisoError(err);
    }
  }

  async function seleccionarSala(id) {
    if (estado.espacio === id) return;
    estado.espacio = id;
    estado.filtroSala = null;
    estado.textoSala = '';
    if (id) estado.planta = espacio(id).planta_id;
    pintarPlano();
    pintar(el.panel, html`<div class="cargando"></div>`);
    try { await cargarSala(); } catch (err) { avisoError(err); }
    pintarAscensor();
    pintarPanel();
    sincronizarUrl();
  }

  function familiaPorDefecto() {
    if (estado.filtroSala) return estado.filtroSala;
    if (estado.familia) return estado.familia;
    const e = espacio(estado.espacio);
    return e?.familia_ids.length === 1 ? e.familia_ids[0] : null;
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  on(el.ascensor, 'click', '[data-planta]', (e, b) => {
    estado.planta = Number(b.dataset.planta);
    if (estado.espacio && espacio(estado.espacio).planta_id !== estado.planta) { estado.espacio = null; articulosSala = []; }
    pintarTodo();
  });
  on(el.modos, 'click', '[data-modo]', (e, b) => {
    estado.modo = b.dataset.modo;
    pintarPlano();
    pintarPanel();
    sincronizarUrl();
  });
  on(el.familias, 'click', '[data-familia]', (e, b) => {
    estado.familia = b.dataset.familia ? Number(b.dataset.familia) : null;
    refrescar({ sala: false });
  });
  let temporizador;
  el.buscar.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      estado.q = el.buscar.value.trim();
      await refrescar({ sala: false });
      // Si la planta actual no tiene resultados, salta a la primera que sí.
      if (estado.q) {
        const conResultados = meta.plantas.find((p) => espaciosDePlanta(p.id).some((x) => ocupacion[x.id]?.articulos));
        const aqui = espaciosDePlanta(estado.planta).some((x) => ocupacion[x.id]?.articulos);
        if (conResultados && !aqui) { estado.planta = conResultados.id; estado.espacio = null; pintarTodo(); }
      }
    }, 250);
  });

  on(el.zona, 'click', '[data-sala]', (e, g) => seleccionarSala(Number(g.dataset.sala)));
  on(el.zona, 'keydown', '[data-sala]', (e, g) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seleccionarSala(Number(g.dataset.sala)); }
  });
  el.zona.addEventListener('click', (e) => { if (e.target.tagName === 'svg' || e.target === el.zona) seleccionarSala(null); });

  on(el.panel, 'click', '[data-ir-sala]', (e, b) => seleccionarSala(Number(b.dataset.irSala)));
  on(el.panel, 'click', '[data-articulo]', (e, b) => abrirFicha(Number(b.dataset.articulo)));
  on(el.panel, 'click', '[data-filtro-familia]', (e, b) => {
    estado.filtroSala = b.dataset.filtroFamilia ? Number(b.dataset.filtroFamilia) : null;
    pintarPanelSala();
  });
  on(el.panel, 'input', '[data-filtro-sala]', (e, input) => {
    estado.textoSala = input.value;
    pintarPanelSala();
    const nuevo = $('[data-filtro-sala]', el.panel);
    nuevo.focus();
    nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length);
  });
  on(el.panel, 'click', '[data-accion]', async (e, b) => {
    const accion = b.dataset.accion;
    if (accion === 'cerrar-sala') return seleccionarSala(null);
    if (accion === 'anadir') return formularioArticulo({ valores: { espacio_id: estado.espacio, familia_id: familiaPorDefecto() } });
    if (accion === 'revisar') {
      return dialogoRevision({ espacio_id: estado.espacio, familia_id: b.dataset.familia ? Number(b.dataset.familia) : familiaPorDefecto() });
    }
    if (accion === 'editar-sala') return dialogoEspacio(espacio(estado.espacio));
    return undefined;
  });

  const teclas = (e) => {
    if (e.key === 'Escape' && estado.espacio && !document.querySelector('dialog[open]')) seleccionarSala(null);
  };
  document.addEventListener('keydown', teclas);
  const quitarOyente = alCambiarInventario(() => refrescar());

  pintarTodo();
  refrescar();

  return () => {
    document.removeEventListener('keydown', teclas);
    quitarOyente();
    clearTimeout(temporizador);
  };
}
