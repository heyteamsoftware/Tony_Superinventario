import { api, consulta } from '../api.js';
import { familia } from '../estado.js';
import { html, pintar, on, $, plural, fechaHora, chipFamilia, avisoError } from '../ui.js';
import { describirMovimiento, abrirFicha } from '../componentes/articulo.js';

const TIPOS = {
  alta: 'Altas', edicion: 'Ediciones', traslado: 'Traslados', estado: 'Cambios de estado',
  baja: 'Bajas', reactivacion: 'Reactivaciones', eliminacion: 'Eliminaciones',
};

export function montar(raiz, { query }) {
  const filtros = { q: query.q ?? '', tipo: query.tipo ?? '', usuario: query.usuario ?? '', desde: query.desde ?? '', hasta: query.hasta ?? '', pagina: 1 };
  let usuarios = [];

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera">
        <div class="titulo"><h1>Historial de cambios</h1><p>Quién hizo qué y cuándo. Los registros no se pueden modificar.</p></div>
      </div>
      <div class="tarjeta">
        <form class="filtros" data-filtros style="grid-template-columns:2fr 1fr 1fr 1fr 1fr">
          <label class="campo buscar"><span>Artículo o persona</span><input type="search" name="q" value="${filtros.q}" placeholder="Código, nombre…"></label>
          <label class="campo"><span>Tipo</span><select name="tipo"><option value="">Todos</option>
            ${Object.entries(TIPOS).map(([k, v]) => html`<option value="${k}" ${k === filtros.tipo ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label class="campo"><span>Usuario</span><select name="usuario" data-usuarios><option value="">Todos</option></select></label>
          <label class="campo"><span>Desde</span><input type="date" name="desde" value="${filtros.desde}"></label>
          <label class="campo"><span>Hasta</span><input type="date" name="hasta" value="${filtros.hasta}"></label>
        </form>
        <div data-lista><div class="cargando"></div></div>
      </div>
    </div>`);

  const form = $('[data-filtros]', raiz);
  const lista = $('[data-lista]', raiz);

  async function cargar() {
    history.replaceState(null, '', `#/historial${consulta({ ...filtros, pagina: '' })}`);
    try {
      const res = await api.get(`/movimientos${consulta({ ...filtros, por_pagina: 40 })}`);
      if (res.usuarios.join() !== usuarios.join()) {
        usuarios = res.usuarios;
        pintar($('[data-usuarios]', raiz), html`<option value="">Todos</option>
          ${usuarios.map((u) => html`<option ${u === filtros.usuario ? 'selected' : ''}>${u}</option>`)}`);
      }
      const paginas = Math.max(1, Math.ceil(res.total / 40));
      pintar(lista, res.items.length ? html`
        <div class="tabla-envoltorio"><table class="tabla">
          <thead><tr><th style="width:170px">Fecha</th><th>Artículo</th><th>Cambio</th><th>Usuario</th></tr></thead>
          <tbody>${res.items.map((m) => {
            const x = describirMovimiento(m);
            return html`<tr>
              <td class="tenue">${fechaHora(m.fecha)}</td>
              <td>${m.articulo_id
                ? html`<a href="#" data-ficha="${m.articulo_id}"><span class="mono">${m.articulo_codigo}</span></a>`
                : html`<span class="mono tenue">${m.articulo_codigo}</span>`}
                <div class="secundario">${m.articulo_nombre}</div>
                ${m.familia_id ? chipFamilia(familia(m.familia_id), { corto: true }) : ''}</td>
              <td><div class="principal">${x.ico} ${x.titulo}</div><div class="secundario" style="color:var(--tinta-2)">${x.detalle}</div></td>
              <td>${m.usuario}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <div class="paginacion"><span>${plural(res.total, 'registro', 'registros')} · página ${filtros.pagina} de ${paginas}</span>
          <span class="acciones">
            <button type="button" class="boton pequeno" data-pagina="${filtros.pagina - 1}" ${filtros.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
            <button type="button" class="boton pequeno" data-pagina="${filtros.pagina + 1}" ${filtros.pagina >= paginas ? 'disabled' : ''}>Siguiente →</button>
          </span></div>`
        : html`<div class="vacio"><span class="icono-grande">🕘</span>No hay registros con estos filtros.</div>`);
    } catch (err) {
      avisoError(err);
    }
  }

  let temporizador;
  form.addEventListener('input', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      for (const k of ['q', 'tipo', 'usuario', 'desde', 'hasta']) filtros[k] = form.elements[k].value;
      filtros.pagina = 1;
      cargar();
    }, e.target.name === 'q' ? 300 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(lista, 'click', '[data-ficha]', (e, a) => { e.preventDefault(); abrirFicha(Number(a.dataset.ficha)).then(cargar); });
  on(lista, 'click', '[data-pagina]', (e, b) => { filtros.pagina = Number(b.dataset.pagina); cargar(); });

  cargar();
  return () => clearTimeout(temporizador);
}
