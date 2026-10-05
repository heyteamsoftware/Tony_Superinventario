import { api } from '../api.js';
import { meta, familia, espacio } from '../estado.js';
import { notificarCambio } from '../cambios.js';
import { campoFoto, activarCampoFoto, fotoSubiendo, reiniciarCampoFoto, urlFoto } from './foto-campo.js';
import {
  html, pintar, abrirDialogo, crearModal, confirmar, leerFormulario, aviso, avisoError, on, $,
  estadoBadge, chipFamilia, euros, fecha, fechaHora, haceTiempo, numero, ESTADOS,
} from '../ui.js';

// ── Selectores reutilizables ───────────────────────────────────────────────
export function opcionesEspacios(seleccionado, { excluir } = {}) {
  return meta.plantas.map((p) => html`
    <optgroup label="${p.nombre}">
      ${meta.espacios.filter((e) => e.planta_id === p.id && e.id !== excluir).map((e) => html`
        <option value="${e.id}" ${e.id === Number(seleccionado) ? 'selected' : ''}>${e.codigo} · ${e.nombre}</option>`)}
    </optgroup>`);
}

export function opcionesFamilias(seleccionada, { vacia } = {}) {
  return html`${vacia ? html`<option value="">${vacia}</option>` : ''}
    ${[...meta.familias].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((f) => html`
      <option value="${f.id}" ${f.id === Number(seleccionada) ? 'selected' : ''}>${f.nombre}</option>`)}`;
}

export function opcionesCategorias(seleccionada, { vacia = 'Sin categoría' } = {}) {
  return html`<option value="">${vacia}</option>
    ${meta.categorias.map((c) => html`<option value="${c.id}" ${c.id === Number(seleccionada) ? 'selected' : ''}>${c.nombre}</option>`)}`;
}

export function opcionesEstados(seleccionado, { conBaja = false } = {}) {
  return Object.entries(ESTADOS)
    .filter(([k]) => conBaja || k !== 'baja')
    .map(([k, v]) => html`<option value="${k}" ${k === seleccionado ? 'selected' : ''}>${v}</option>`);
}

// ── Alta y edición ─────────────────────────────────────────────────────────
// Devuelve el artículo guardado (o true si se dieron de alta varios con
// "Guardar y añadir otro"), o undefined si se cancela.
export async function formularioArticulo({ articulo = null, valores = {} } = {}) {
  const a = { cantidad: 1, estado: 'bueno', ...valores, ...(articulo ?? {}) };
  const edicion = Boolean(articulo);
  let altas = 0;
  const lugar = espacio(a.espacio_id);

  const resultado = await abrirDialogo({
    titulo: edicion ? `Editar ${articulo.codigo}` : (lugar ? `Añadir material en ${lugar.codigo} · ${lugar.nombre}` : 'Nuevo artículo'),
    clase: 'ancho',
    cuerpo: html`
      <div class="formulario">
        <label class="campo c4"><span class="obligatorio">Nombre del artículo</span>
          <input name="nombre" value="${a.nombre ?? ''}" maxlength="200" required placeholder="Ej.: Camilla articulada, Ordenador portátil…" autofocus></label>
        <label class="campo c2"><span>Categoría</span>
          <input name="categoria" list="lista-categorias" value="${a.categoria_nombre ?? ''}" maxlength="80" autocomplete="off" placeholder="Elige o escribe una nueva">
          <datalist id="lista-categorias" data-categorias>${meta.categorias.map((c) => html`<option value="${c.nombre}"></option>`)}</datalist>
          <span class="ayuda">Si no existe, se crea y queda guardada.</span></label>

        <label class="campo c3"><span class="obligatorio">Familia profesional</span>
          <select name="familia_id" data-tipo="entero" required>${opcionesFamilias(a.familia_id, { vacia: 'Elige una familia…' })}</select></label>
        <label class="campo c3"><span class="obligatorio">Espacio (aula)</span>
          <select name="espacio_id" data-tipo="entero" required>${opcionesEspacios(a.espacio_id)}</select></label>

        <label class="campo c2"><span>Cantidad</span>
          <input name="cantidad" type="number" min="0" step="1" value="${a.cantidad}" data-tipo="entero"></label>
        <label class="campo c2"><span>Estado</span>
          <select name="estado" ${a.estado === 'baja' ? 'disabled' : ''}>${opcionesEstados(a.estado, { conBaja: a.estado === 'baja' })}</select></label>
        <label class="campo c2"><span>Ubicación dentro del aula</span>
          <input name="ubicacion_detalle" value="${a.ubicacion_detalle ?? ''}" maxlength="200" placeholder="Armario 2, balda 3"></label>

        ${campoFoto(a.foto_id)}

        <div class="separador">Identificación y compra</div>
        <label class="campo c2"><span>Marca</span><input name="marca" value="${a.marca ?? ''}" maxlength="200"></label>
        <label class="campo c2"><span>Modelo</span><input name="modelo" value="${a.modelo ?? ''}" maxlength="200"></label>
        <label class="campo c2"><span>Nº de serie</span><input name="numero_serie" value="${a.numero_serie ?? ''}" maxlength="200"></label>
        <label class="campo c2"><span>Valor unitario (€)</span>
          <input name="valor" inputmode="decimal" value="${a.valor != null ? String(a.valor).replace('.', ',') : ''}" placeholder="0,00"></label>
        <label class="campo c2"><span>Fecha de adquisición</span>
          <input name="fecha_adquisicion" type="date" value="${a.fecha_adquisicion ?? ''}"></label>
        <label class="campo c2"><span>Proveedor</span><input name="proveedor" value="${a.proveedor ?? ''}" maxlength="200"></label>

        <label class="campo c3"><span>Descripción</span><textarea name="descripcion" maxlength="2000">${a.descripcion ?? ''}</textarea></label>
        <label class="campo c3"><span>Observaciones</span><textarea name="observaciones" maxlength="4000">${a.observaciones ?? ''}</textarea></label>
      </div>`,
    pie: html`
      <span class="izquierda tenue pequeno" data-contador></span>
      <button type="button" class="boton" data-cerrar>${edicion ? 'Cancelar' : 'Cerrar'}</button>
      ${edicion ? '' : html`<button type="submit" class="boton" value="otro">Guardar y añadir otro</button>`}
      <button type="submit" class="boton primario" value="guardar">Guardar</button>`,
    alAbrir: (d, form) => activarCampoFoto(form),
    alEnviar: async (form, boton) => {
      if (fotoSubiendo(form)) throw new Error('Espera un momento: la foto todavía se está subiendo.');
      const datos = leerFormulario(form);
      if (edicion) {
        const guardado = await api.patch(`/articulos/${articulo.id}`, datos);
        aviso('Cambios guardados');
        return guardado;
      }
      const creado = await api.post('/articulos', datos);
      altas++;
      if (boton?.value !== 'otro') {
        aviso(`${creado.codigo} dado de alta`);
        return creado;
      }
      // Una categoría recién creada ya se ofrece en las siguientes altas de este diálogo.
      const nueva = creado.categoria_nombre;
      const lista = form.querySelector('[data-categorias]');
      if (nueva && ![...lista.options].some((o) => o.value.toLowerCase() === nueva.toLowerCase())) {
        lista.insertAdjacentHTML('beforeend', String(html`<option value="${nueva}"></option>`));
      }
      // Inventariado rápido: conserva familia, aula, categoría y estado.
      for (const campo of ['nombre', 'marca', 'modelo', 'numero_serie', 'valor', 'descripcion', 'observaciones']) {
        form.elements[campo].value = '';
      }
      form.elements.cantidad.value = 1;
      reiniciarCampoFoto(form);
      form.querySelector('[data-contador]').textContent = `${altas} ${altas === 1 ? 'artículo añadido' : 'artículos añadidos'} · último: ${creado.codigo}`;
      form.elements.nombre.focus();
      aviso(`${creado.codigo} · ${creado.nombre} añadido`);
      return undefined;
    },
  });

  if (resultado || altas) await notificarCambio();
  return resultado ?? (altas ? true : undefined);
}

// ── Traslado ───────────────────────────────────────────────────────────────
export async function dialogoTraslado(articulo) {
  const r = await abrirDialogo({
    titulo: `Trasladar ${articulo.codigo}`,
    cuerpo: html`
      <p>Ahora está en <b>${articulo.espacio_codigo} · ${articulo.espacio_nombre}</b> (${articulo.planta_nombre}).</p>
      <div class="formulario">
        <label class="campo c6"><span class="obligatorio">Llevar a</span>
          <select name="espacio_id" data-tipo="entero" required><option value="">Elige el espacio de destino…</option>${opcionesEspacios(null, { excluir: articulo.espacio_id })}</select></label>
        ${articulo.cantidad > 1 ? html`
          <label class="campo c2"><span>Unidades a mover</span>
            <input name="cantidad" type="number" min="1" max="${articulo.cantidad}" value="${articulo.cantidad}" data-tipo="entero">
            <span class="ayuda">de ${articulo.cantidad}. Si mueves menos, se crea un artículo nuevo en el destino.</span></label>` : ''}
        <label class="campo ${articulo.cantidad > 1 ? 'c4' : 'c6'}"><span>Ubicación en el destino</span>
          <input name="ubicacion_detalle" maxlength="200" placeholder="Armario, estantería…"></label>
        <label class="campo c6"><span>Motivo (opcional)</span><input name="motivo" maxlength="500"></label>
      </div>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button>
              <button type="submit" class="boton primario">Trasladar</button>`,
    alEnviar: async (form) => {
      const datos = leerFormulario(form);
      if (datos.cantidad === articulo.cantidad) delete datos.cantidad;
      const res = await api.post(`/articulos/${articulo.id}/traslado`, datos);
      aviso(res.nuevo ? `Movidas ${res.nuevo.cantidad} unidades (nuevo código ${res.nuevo.codigo})` : 'Artículo trasladado');
      return res;
    },
  });
  if (r) await notificarCambio();
  return r;
}

// ── Baja y reactivación ────────────────────────────────────────────────────
export async function dialogoBaja(articulo) {
  const r = await abrirDialogo({
    titulo: `Dar de baja ${articulo.codigo}`,
    clase: 'estrecho',
    cuerpo: html`
      <p>El artículo deja de contar en el inventario, pero se conserva con su historial y se puede reactivar.</p>
      <label class="campo"><span class="obligatorio">Motivo de la baja</span>
        <select name="motivo_rapido" data-sin-enviar>
          <option value="">Elige o escribe abajo…</option>
          <option>Averiado sin reparación</option><option>Obsoleto</option><option>Extraviado</option>
          <option>Consumido</option><option>Donado o cedido</option><option>Robado</option>
        </select></label>
      <label class="campo"><span>Detalle</span><textarea name="motivo" maxlength="500" placeholder="Describe el motivo"></textarea></label>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button>
              <button type="submit" class="boton peligro lleno">Dar de baja</button>`,
    alAbrir: (d, form) => {
      form.elements.motivo_rapido.addEventListener('change', (e) => {
        if (e.target.value) form.elements.motivo.value = e.target.value;
      });
    },
    alEnviar: async (form) => {
      const res = await api.post(`/articulos/${articulo.id}/baja`, { motivo: form.elements.motivo.value });
      aviso('Artículo dado de baja');
      return res;
    },
  });
  if (r) await notificarCambio();
  return r;
}

async function reactivar(articulo) {
  const r = await abrirDialogo({
    titulo: `Reactivar ${articulo.codigo}`,
    clase: 'estrecho',
    cuerpo: html`<label class="campo"><span>Estado al reactivar</span><select name="estado">${opcionesEstados('bueno')}</select></label>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button><button type="submit" class="boton primario">Reactivar</button>`,
    alEnviar: (form) => api.post(`/articulos/${articulo.id}/reactivar`, leerFormulario(form)),
  });
  if (r) { aviso('Artículo reactivado'); await notificarCambio(); }
  return r;
}

async function eliminar(articulo) {
  const ok = await confirmar({
    titulo: 'Eliminar definitivamente',
    mensaje: `Se borrará ${articulo.codigo} · ${articulo.nombre}. Úsalo solo para corregir errores de alta: para material que ya no está, es mejor "Dar de baja". El historial conservará un registro.`,
    textoSi: 'Eliminar',
    peligro: true,
  });
  if (!ok) return false;
  await api.del(`/articulos/${articulo.id}`);
  aviso('Artículo eliminado');
  await notificarCambio();
  return true;
}

// ── Historial ──────────────────────────────────────────────────────────────
const CAMPOS = {
  nombre: 'Nombre', foto: 'Foto', descripcion: 'Descripción', familia: 'Familia', categoria: 'Categoría', cantidad: 'Cantidad',
  ubicacion_detalle: 'Ubicación', marca: 'Marca', modelo: 'Modelo', numero_serie: 'Nº de serie', valor: 'Valor',
  fecha_adquisicion: 'Fecha de adquisición', proveedor: 'Proveedor', observaciones: 'Observaciones',
};
const lugarTexto = (e) => (e ? `${e.codigo} · ${e.nombre}` : '—');
const vacioComo = (v) => (v === null || v === '' || v === undefined ? '(vacío)' : v);

export function describirMovimiento(m) {
  const d = m.detalle ?? {};
  switch (m.tipo) {
    case 'alta':
      return {
        ico: '＋', titulo: d.origen_codigo ? 'Alta por traslado parcial' : (d.importado ? 'Alta por importación' : (d.via === 'qr' ? 'Alta desde el QR del alumnado' : 'Alta en el inventario')),
        detalle: d.origen_codigo
          ? html`${d.cantidad} uds. separadas de <b>${d.origen_codigo}</b> y llevadas a ${lugarTexto(d.espacio)}`
          : html`${d.cantidad} ${d.cantidad === 1 ? 'unidad' : 'unidades'} en ${lugarTexto(d.espacio)}`,
      };
    case 'traslado':
      return {
        ico: '➜', titulo: d.parcial ? 'Traslado parcial' : 'Traslado',
        detalle: html`${d.parcial ? html`${d.cantidad} uds. ` : ''}de ${lugarTexto(d.desde)} a <b>${lugarTexto(d.hasta)}</b>
          ${d.nuevo_codigo ? html` · nuevo código <b>${d.nuevo_codigo}</b>` : ''}${d.motivo ? html` · ${d.motivo}` : ''}`,
      };
    case 'estado':
      return { ico: '◐', titulo: 'Cambio de estado', detalle: html`${estadoBadge(d.antes)} → ${estadoBadge(d.despues)}` };
    case 'edicion':
      return {
        ico: '✎', titulo: 'Datos modificados',
        detalle: Object.entries(d.cambios ?? {}).map(([campo, c]) => html`
          <div class="cambio">${CAMPOS[campo] ?? campo}: <del>${vacioComo(c.antes)}</del> → <ins>${vacioComo(c.despues)}</ins></div>`),
      };
    case 'baja':
      return { ico: '⊘', titulo: 'Dado de baja', detalle: html`Motivo: ${d.motivo}` };
    case 'reactivacion':
      return { ico: '↺', titulo: 'Reactivado', detalle: html`Vuelve al inventario como ${estadoBadge(d.estado)}` };
    case 'eliminacion':
      return { ico: '🗑', titulo: 'Eliminado definitivamente', detalle: html`Estaba en ${lugarTexto(d.espacio)} · ${d.cantidad} uds.` };
    default:
      return { ico: '•', titulo: m.tipo, detalle: '' };
  }
}

// ── Ficha del artículo ─────────────────────────────────────────────────────
export async function abrirFicha(id) {
  let articulo;
  try {
    articulo = await api.get(`/articulos/${id}`);
  } catch (err) {
    avisoError(err);
    return;
  }

  const { d, cerrar, cerrado } = crearModal('ancho');

  const dato = (titulo, valor, ancho = false) => html`<div class="${ancho ? 'ancho' : ''}"><dt>${titulo}</dt><dd>${valor || '—'}</dd></div>`;

  function render() {
    const a = articulo;
    const f = familia(a.familia_id) ?? { color: a.familia_color, codigo: a.familia_codigo, nombre: a.familia_nombre };
    const baja = a.estado === 'baja';
    pintar(d, html`
      <div class="modal-cab">
        <div class="ficha-cab" style="flex:1">
          <div class="sigla" style="--c:${f.color}">${f.codigo}</div>
          <div>
            <div class="codigo">${a.codigo}</div>
            <h2>${a.nombre}</h2>
            <div class="acciones" style="margin-top:6px">${estadoBadge(a.estado)} ${chipFamilia(f)}
              <span class="chip">📍 ${a.espacio_codigo} · ${a.espacio_nombre}</span></div>
          </div>
        </div>
        <button type="button" class="boton fantasma icono" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-cuerpo">
        ${baja ? html`<div class="alerta aviso"><span class="ico">⊘</span><div class="texto">Dado de baja el ${fecha(a.fecha_baja)}: <b>${a.motivo_baja}</b></div></div>` : ''}
        ${a.foto_id ? html`<a class="ficha-foto" href="${urlFoto(a.foto_id)}" target="_blank" rel="noopener" title="Ver la foto a tamaño completo">
          <img src="${urlFoto(a.foto_id)}" alt="Foto de ${a.nombre}"></a>` : ''}
        <dl class="datos">
          ${dato('Cantidad', html`<b style="font-size:18px">${numero(a.cantidad)}</b> ${a.cantidad === 1 ? 'unidad' : 'unidades'}`)}
          ${dato('Categoría', a.categoria_nombre)}
          ${dato('Lugar', html`${a.planta_nombre} · ${a.espacio_codigo} ${a.espacio_nombre}${a.ubicacion_detalle ? html`<br><span class="tenue">${a.ubicacion_detalle}</span>` : ''}`)}
          ${dato('Última comprobación', html`${haceTiempo(a.revisado_en)} <span class="tenue pequeno">(${fecha(a.revisado_en)})</span>`)}
          ${dato('Marca y modelo', [a.marca, a.modelo].filter(Boolean).join(' · '))}
          ${dato('Nº de serie', a.numero_serie ? html`<span class="mono">${a.numero_serie}</span>` : '')}
          ${dato('Valor unitario', a.valor != null ? html`${euros(a.valor)}${a.cantidad > 1 ? html` <span class="tenue pequeno">(total ${euros(a.valor * a.cantidad)})</span>` : ''}` : '')}
          ${dato('Adquisición', [a.fecha_adquisicion ? fecha(a.fecha_adquisicion) : '', a.proveedor].filter(Boolean).join(' · '))}
          ${a.descripcion ? dato('Descripción', a.descripcion, true) : ''}
          ${a.observaciones ? dato('Observaciones', a.observaciones, true) : ''}
        </dl>
        <div>
          <div class="titulo-bloque"><h3>Historial</h3><span class="tenue pequeno">Alta por ${a.creado_por} · ${fechaHora(a.creado_en)}</span></div>
          <ol class="linea-tiempo">
            ${a.movimientos.map((m) => {
              const x = describirMovimiento(m);
              return html`<li><span class="ico">${x.ico}</span><div>
                <div class="t">${x.titulo}</div><div class="d">${x.detalle}</div>
                <div class="f">${m.usuario} · ${fechaHora(m.fecha)}</div></div></li>`;
            })}
          </ol>
        </div>
      </div>
      <div class="modal-pie">
        <button type="button" class="boton peligro izquierda" data-accion="eliminar">Eliminar</button>
        <a class="boton" href="#/etiquetas?ids=${a.id}" data-accion="etiqueta">🏷 Etiqueta</a>
        ${baja
          ? html`<button type="button" class="boton primario" data-accion="reactivar">↺ Reactivar</button>`
          : html`
            <button type="button" class="boton" data-accion="baja">⊘ Dar de baja</button>
            <button type="button" class="boton" data-accion="trasladar">➜ Trasladar</button>
            <button type="button" class="boton primario" data-accion="editar">✎ Editar</button>`}
      </div>`);
  }

  async function recargar() {
    articulo = await api.get(`/articulos/${articulo.id}`);
    render();
  }

  render();
  d.showModal();

  on(d, 'click', '[data-accion]', async (e, boton) => {
    const accion = boton.dataset.accion;
    try {
      if (accion === 'etiqueta') { cerrar(); return; }
      if (accion === 'editar' && await formularioArticulo({ articulo })) await recargar();
      if (accion === 'trasladar' && await dialogoTraslado(articulo)) await recargar();
      if (accion === 'baja' && await dialogoBaja(articulo)) await recargar();
      if (accion === 'reactivar' && await reactivar(articulo)) await recargar();
      if (accion === 'eliminar' && await eliminar(articulo)) cerrar();
    } catch (err) {
      avisoError(err);
    }
  });

  await cerrado;
  $('#vista')?.focus?.({ preventScroll: true });
}
