import { api, consulta } from '../api.js';
import { html, pintar, on } from '../ui.js';

// Hoja de etiquetas imprimibles. El QR abre la ficha del artículo en la app
// (desde cualquier móvil conectado a la red del centro).
export async function montar(raiz, { query }) {
  const ids = String(query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  pintar(raiz, html`<div class="pagina"><div class="cargando"></div></div>`);

  const articulos = ids.length
    ? (await api.get(`/articulos${consulta({ ids: ids.join(','), bajas: 'incluir', por_pagina: 500 })}`)).items
    : [];
  // Dirección de la app (vale también si se sirve bajo una subcarpeta).
  const origen = `${location.origin}${location.pathname}`;

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera no-imprimir">
        <div class="titulo"><h1>Etiquetas</h1>
          <p>${articulos.length} etiquetas. Imprímelas en papel adhesivo y pégalas en cada artículo: el QR abre su ficha.</p></div>
        <div class="acciones">
          <button type="button" class="boton" data-volver>← Volver</button>
          <button type="button" class="boton primario" data-imprimir>🖨 Imprimir</button>
        </div>
      </div>
      ${articulos.length ? html`<div class="hoja-etiquetas">
        ${articulos.map((a) => html`
          <div class="etiqueta" style="--c:${a.familia_color}">
            <img src="api/qr.svg${consulta({ texto: `${origen}#/articulo/${a.id}` })}" alt="QR de ${a.codigo}">
            <div style="min-width:0">
              <div class="cod">${a.codigo}</div>
              <div class="nom">${a.nombre}</div>
              <div class="lug">${a.espacio_codigo} · ${a.espacio_nombre}</div>
              <span class="fam">${a.familia_nombre}</span>
              <div class="centro">CIFP Tony Gallardo</div>
            </div>
          </div>`)}
      </div>` : html`<div class="vacio">No hay artículos que etiquetar. Selecciónalos en el inventario.</div>`}
    </div>`);

  on(raiz, 'click', '[data-imprimir]', () => window.print());
  on(raiz, 'click', '[data-volver]', () => history.back());
}
