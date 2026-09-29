import { api, consulta } from '../api.js';
import { meta, familia } from '../estado.js';
import { alCambiarInventario } from '../cambios.js';
import { html, pintar, on, $, numero, plural, fechaHora, haceTiempo, chipFamilia, revisionBadge, avisoError } from '../ui.js';
import { dialogoRevision } from '../componentes/revision.js';
import { opcionesFamilias } from '../componentes/articulo.js';

export function montar(raiz, { query }) {
  const filtros = { familia: query.familia ?? '', pagina: 1 };

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera">
        <div class="titulo"><h1>Revisiones del inventario</h1>
          <p>Registro de cada vez que una familia comprueba que su material coincide con lo inventariado.</p></div>
        <div class="acciones">
          <select class="control" data-familia style="width:auto;min-width:240px">${opcionesFamilias(filtros.familia, { vacia: 'Todas las familias' })}</select>
          <button type="button" class="boton exito" data-accion="revisar">✓ Registrar revisión</button>
        </div>
      </div>
      <div class="rejilla" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start" data-rejilla>
        <div class="tarjeta" data-lista><div class="cargando"></div></div>
        <div class="tarjeta tarjeta-cuerpo" data-estado></div>
      </div>
    </div>`);

  const lista = $('[data-lista]', raiz);
  const panelEstado = $('[data-estado]', raiz);
  if (window.matchMedia('(max-width: 900px)').matches) $('[data-rejilla]', raiz).style.gridTemplateColumns = '1fr';

  function pintarEstado() {
    const orden = { vencida: 0, nunca: 1, pronto: 2, al_dia: 3 };
    const familias = [...meta.familias].sort((a, b) => orden[a.revision.estado] - orden[b.revision.estado]);
    pintar(panelEstado, html`
      <div class="titulo-bloque"><h3>Estado por familia</h3><span class="tenue pequeno">plazo: ${meta.ajustes.dias_aviso_revision} días</span></div>
      <div class="lista-simple">
        ${familias.map((f) => html`<div>
          <span class="punto" style="--c:${f.color}"></span>
          <span class="nombre"><b style="font-weight:600">${f.nombre}</b><br><span class="tenue pequeno">${f.ultimo_repaso ? `Repaso ${haceTiempo(f.ultimo_repaso)}` : 'Nunca'}</span></span>
          ${revisionBadge(f.revision, { corto: true })}
        </div>`)}
      </div>`);
  }

  async function cargar() {
    history.replaceState(null, '', `#/revisiones${consulta({ familia: filtros.familia })}`);
    try {
      const res = await api.get(`/revisiones${consulta({ familia: filtros.familia, pagina: filtros.pagina, por_pagina: 30 })}`);
      const paginas = Math.max(1, Math.ceil(res.total / 30));
      pintar(lista, res.items.length ? html`
        <div class="tabla-envoltorio"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Familia</th><th>Alcance</th><th class="num">Material</th><th>Revisado por</th><th>Notas</th></tr></thead>
          <tbody>${res.items.map((r) => html`<tr>
            <td><div class="principal">${fechaHora(r.fecha)}</div><div class="secundario">${haceTiempo(r.fecha)}</div></td>
            <td>${chipFamilia(familia(r.familia_id) ?? { color: r.familia_color, nombre: r.familia_nombre })}</td>
            <td>${r.espacio_id ? html`<a href="#/plano?espacio=${r.espacio_id}"><span class="mono">${r.espacio_codigo}</span></a> ${r.espacio_nombre}` : html`<b>Toda la familia</b>`}</td>
            <td class="num">${numero(r.articulos)} art. · ${numero(r.unidades)} uds.</td>
            <td>${r.usuario}</td>
            <td style="max-width:280px;white-space:pre-line">${r.notas || html`<span class="tenue">—</span>`}</td>
          </tr>`)}</tbody>
        </table></div>
        <div class="paginacion"><span>${plural(res.total, 'revisión', 'revisiones')}</span>
          <span class="acciones">
            <button type="button" class="boton pequeno" data-pagina="${filtros.pagina - 1}" ${filtros.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
            <button type="button" class="boton pequeno" data-pagina="${filtros.pagina + 1}" ${filtros.pagina >= paginas ? 'disabled' : ''}>Siguiente →</button>
          </span></div>`
        : html`<div class="vacio"><span class="icono-grande">✓</span>Todavía no se ha registrado ninguna revisión${filtros.familia ? ' de esta familia' : ''}.
            <div style="margin-top:12px"><button type="button" class="boton exito" data-accion="revisar">Registrar la primera</button></div></div>`);
    } catch (err) {
      avisoError(err);
    }
    pintarEstado();
  }

  $('[data-familia]', raiz).addEventListener('change', (e) => { filtros.familia = e.target.value; filtros.pagina = 1; cargar(); });
  on(raiz, 'click', '[data-accion="revisar"]', () => dialogoRevision({ familia_id: Number(filtros.familia) || null }));
  on(raiz, 'click', '[data-pagina]', (e, b) => { filtros.pagina = Number(b.dataset.pagina); cargar(); });

  cargar();
  return alCambiarInventario(cargar);
}
