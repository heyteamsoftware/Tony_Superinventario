// Utilidades de interfaz. Todo el HTML se genera con la plantilla `html`,
// que escapa automáticamente los valores interpolados (protección XSS).

class Seguro {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function valor(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Seguro) return v.s;
  if (Array.isArray(v)) return v.map(valor).join('');
  return escapar(v);
}

export function html(partes, ...valores) {
  let salida = partes[0];
  valores.forEach((v, i) => { salida += valor(v) + partes[i + 1]; });
  return new Seguro(salida);
}
export const crudo = (s) => new Seguro(s);

export function pintar(elemento, contenido) {
  elemento.innerHTML = String(contenido);
  return elemento;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// Delegación de eventos: on(raiz, 'click', '[data-accion]', fn)
export function on(raiz, evento, selector, fn) {
  raiz.addEventListener(evento, (e) => {
    const objetivo = e.target.closest(selector);
    if (objetivo && raiz.contains(objetivo)) fn(e, objetivo);
  });
}

// ── Formatos ───────────────────────────────────────────────────────────────
const fmtNumero = new Intl.NumberFormat('es-ES');
const fmtEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtFechaHora = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const numero = (n) => fmtNumero.format(n ?? 0);
export const euros = (n) => (n == null ? '—' : fmtEuros.format(n));
export const fecha = (iso) => (iso ? fmtFecha.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—');
export const fechaHora = (iso) => (iso ? fmtFechaHora.format(new Date(iso)) : '—');

export function haceTiempo(iso) {
  if (!iso) return 'nunca';
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 31) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(dias / 365.25);
  const resto = Math.floor((dias - anios * 365.25) / 30.44);
  return `hace ${anios} ${anios === 1 ? 'año' : 'años'}${resto ? ` y ${resto} ${resto === 1 ? 'mes' : 'meses'}` : ''}`;
}

export const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;

// Texto oscuro o claro según el color de fondo.
export function colorTexto(fondo) {
  if (!fondo) return '#151a2d';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fondo.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#151a2d' : '#ffffff';
}

// ── Distintivos reutilizables ──────────────────────────────────────────────
export const ESTADOS = {
  nuevo: 'Nuevo', bueno: 'Bueno', regular: 'Regular', averiado: 'Averiado', baja: 'De baja',
};
export const estadoBadge = (e) => html`<span class="estado estado-${e}">${ESTADOS[e] ?? e}</span>`;

export const chipFamilia = (f, { corto = false } = {}) => (f
  ? html`<span class="chip familia" style="--c:${f.color}" title="${f.nombre}"><span class="punto"></span><span class="txt">${corto ? f.codigo : f.nombre}</span></span>`
  : '');

const TEXTO_REVISION = {
  al_dia: ['✓', 'Al día'],
  pronto: ['⏳', 'Revisar pronto'],
  vencida: ['⚠', 'Revisión vencida'],
  nunca: ['○', 'Sin revisar'],
};
export function revisionBadge(rev, { corto = false } = {}) {
  const [ico, txt] = TEXTO_REVISION[rev.estado];
  const detalle = rev.estado === 'nunca' ? '' : ` · ${rev.dias === 0 ? 'hoy' : `${rev.dias} d`}`;
  return html`<span class="revision revision-${rev.estado}">${ico} ${corto ? '' : txt}${corto ? detalle.replace(' · ', '') : detalle}</span>`;
}
export const TEXTOS_REVISION = TEXTO_REVISION;

// ── Avisos flotantes ───────────────────────────────────────────────────────
export function aviso(mensaje, { error = false, ms = 3500 } = {}) {
  const t = document.createElement('div');
  t.className = `toast${error ? ' error' : ''}`;
  t.setAttribute('role', error ? 'alert' : 'status');
  t.textContent = mensaje;
  $('#avisos').append(t);
  setTimeout(() => {
    t.classList.add('saliendo');
    setTimeout(() => t.remove(), 250); // dura lo mismo que la animación de salida
  }, ms);
}

export function avisoError(err) {
  console.error(err);
  aviso(err?.message || 'Ha ocurrido un error', { error: true, ms: 5000 });
}

// ── Diálogos ───────────────────────────────────────────────────────────────
// Modal nativo con cierre explícito. No se depende del evento "close" del
// <dialog> porque algunos navegadores lo retrasan o no lo emiten.
export function crearModal(clase = '') {
  const d = document.createElement('dialog');
  d.className = `modal ${clase}`;
  document.body.append(d);
  let terminado = false;
  let avisar;
  const cerrado = new Promise((r) => { avisar = r; });
  const cerrar = (valor) => {
    if (terminado) return;
    terminado = true;
    if (d.open) d.close();
    d.remove();
    avisar(valor);
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } });
  d.addEventListener('close', () => cerrar());
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]') || e.target === d) cerrar(); // botón o clic en el fondo
  });
  return { d, cerrar, cerrado };
}

// abrirDialogo({ titulo, cuerpo, pie, clase, alAbrir, alEnviar }) -> Promise
// alEnviar(form, boton) puede devolver un valor (cierra y resuelve) o lanzar
// un error de validación (se muestra y el diálogo sigue abierto).
export function abrirDialogo({ titulo, cuerpo, pie, clase = '', alAbrir, alEnviar }) {
  return new Promise((resolver) => {
    const { d, cerrar, cerrado } = crearModal(clase);
    cerrado.then(resolver);
    pintar(d, html`
      <form method="dialog" novalidate>
        <div class="modal-cab">
          <h2>${titulo}</h2>
          <button type="button" class="boton fantasma icono" data-cerrar aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-cuerpo">${cuerpo}</div>
        ${pie ? html`<div class="modal-pie">${pie}</div>` : ''}
      </form>`);
    const form = d.querySelector('form');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!alEnviar) return cerrar();
      const boton = e.submitter;
      const botones = $$('button', form).filter((b) => !b.disabled);
      botones.forEach((b) => { b.disabled = true; });
      try {
        limpiarErrores(form);
        const r = await alEnviar(form, boton, d);
        if (r !== undefined) cerrar(r);
      } catch (err) {
        mostrarErrores(form, err);
      } finally {
        botones.forEach((b) => { b.disabled = false; });
      }
    });

    d.showModal();
    alAbrir?.(d, form, cerrar);
    const primero = form.querySelector('[autofocus], .modal-cuerpo input:not([type=hidden]), .modal-cuerpo select, .modal-cuerpo textarea');
    primero?.focus();
  });
}

export function confirmar({ titulo, mensaje, textoSi = 'Confirmar', peligro = false }) {
  return abrirDialogo({
    titulo,
    clase: 'estrecho',
    cuerpo: html`<p>${mensaje}</p>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button>
              <button type="submit" class="boton ${peligro ? 'peligro lleno' : 'primario'}">${textoSi}</button>`,
    alEnviar: () => true,
  }).then(Boolean);
}

export function limpiarErrores(form) {
  $$('.con-error', form).forEach((c) => c.classList.remove('con-error'));
  $$('.error', form).forEach((e) => e.remove());
}

export function mostrarErrores(form, err) {
  const detalles = err?.detalles;
  let enCampo = false;
  if (detalles) {
    for (const [campo, mensaje] of Object.entries(detalles)) {
      const control = form.elements[campo];
      const caja = control?.closest?.('.campo');
      if (!caja) continue;
      caja.classList.add('con-error');
      caja.insertAdjacentHTML('beforeend', String(html`<span class="error">${mensaje}</span>`));
      enCampo = true;
    }
  }
  if (!enCampo || !detalles) avisoError(err);
  else form.querySelector('.con-error input, .con-error select, .con-error textarea')?.focus();
}

// Lee un formulario a objeto (los valores vacíos se envían como null).
export function leerFormulario(form) {
  const datos = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') datos[el.name] = el.checked;
    else if (el.dataset.tipo === 'entero') datos[el.name] = el.value === '' ? null : Number(el.value);
    else datos[el.name] = el.value === '' ? null : el.value;
  }
  return datos;
}

export function descargar(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}
