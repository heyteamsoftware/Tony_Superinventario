import { html, pintar, $, $$, on, aviso } from '../js/ui.js';
import { iniciales } from '../js/usuario.js';
import { comprimirFoto, kb } from '../js/foto.js';

// Interfaz móvil del alumnado. El QR de cada familia trae un código secreto
// (?t=...) que solo permite VER el formulario de alta y AÑADIR material de esa
// familia: no hay forma de consultar, editar ni borrar el inventario desde aquí.

const token = new URLSearchParams(location.search).get('t') ?? '';
const raiz = document.getElementById('app');

const clavePersona = 'superinventario.alumno.nombre';
const sufijo = token.slice(0, 10);
const claveLista = `superinventario.alumno.lista.${sufijo}`;
const claveUltimo = `superinventario.alumno.ultimo.${sufijo}`;

const leer = (clave, defecto) => {
  try { const v = localStorage.getItem(clave); return v === null ? defecto : JSON.parse(v); } catch { return defecto; }
};
const guardar = (clave, valor) => {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado: simplemente no se recuerda */ }
};

const ESTADOS = { nuevo: 'Nuevo', bueno: 'Bueno', regular: 'Regular', averiado: 'Averiado' };

let datos = null;
let nombre = String(leer(clavePersona, '') ?? '');
let lista = leer(claveLista, []);
let ultimo = leer(claveUltimo, {});

// ── Red ────────────────────────────────────────────────────────────────────
async function llamar(ruta, cuerpo) {
  let res;
  try {
    const url = new URL(`../api/alumno/${encodeURIComponent(token)}${ruta}`, location.href);
    res = await fetch(url, cuerpo === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor. Comprueba el wifi o los datos y vuelve a intentarlo.'), { red: true });
  }
  let respuesta = null;
  try { respuesta = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    throw Object.assign(new Error(respuesta?.error ?? `Error ${res.status}`), { status: res.status, detalles: respuesta?.detalles ?? null });
  }
  return respuesta;
}

async function subirFoto(blob) {
  let res;
  try {
    res = await fetch(new URL(`../api/alumno/${encodeURIComponent(token)}/fotos`, location.href), {
      method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
    });
  } catch {
    throw new Error('No hay conexión. Comprueba el wifi o los datos y vuelve a intentarlo.');
  }
  let respuesta = null;
  try { respuesta = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new Error(respuesta?.error ?? `Error ${res.status}`);
  return respuesta;
}

// ── Piezas ─────────────────────────────────────────────────────────────────
const cabecera = () => html`
  <header class="al-cab">
    <img src="../img/logo-cifp.webp" alt="" width="40" height="40">
    <span class="marca-texto">
      <span class="marca-nombre">Super<b>inventario</b></span>
      <span class="marca-centro">CIFP Tony Gallardo</span>
    </span>
    ${nombre ? html`<button type="button" class="al-persona" data-cambiar title="Cambiar de nombre">
      <span class="avatar">${iniciales(nombre)}</span><span>${nombre}</span></button>` : ''}
  </header>`;

const bandaFamilia = () => html`
  <div class="al-familia" style="--c:${datos.familia.color}">
    <span class="sigla">${datos.familia.codigo}</span>
    <div><small>Estás añadiendo material de</small><h1>${datos.familia.nombre}</h1></div>
  </div>`;

function pantallaGrande(icono, titulo, texto) {
  pintar(raiz, html`${cabecera()}<div class="al-grande"><span class="ico">${icono}</span><h1>${titulo}</h1><p>${texto}</p></div>`);
}

function opcionesAulas(seleccionada) {
  const grupo = (titulo, items) => html`<optgroup label="${titulo}">${items.map((e) => html`
    <option value="${e.id}" ${e.id === seleccionada ? 'selected' : ''}>${e.codigo} · ${e.nombre}</option>`)}</optgroup>`;
  const habituales = datos.espacios.filter((e) => e.habitual);
  const resto = datos.espacios.filter((e) => !e.habitual);
  const plantas = [...new Set(resto.map((e) => e.planta))];
  return html`<option value="">Elige el aula…</option>
    ${habituales.length ? grupo(`Aulas de ${datos.familia.nombre}`, habituales) : ''}
    ${plantas.map((p) => grupo(habituales.length ? `Otras · ${p}` : p, resto.filter((e) => e.planta === p)))}`;
}

function listaHtml() {
  if (!lista.length) return '';
  return html`
    <section class="al-lista" aria-label="Material añadido desde este móvil">
      <h2><span>Añadido desde este móvil (${lista.length})</span><button type="button" data-vaciar>Vaciar lista</button></h2>
      <ul>${lista.map((a) => html`<li>
        <span class="n">${a.nombre}</span><span class="c">× ${a.cantidad}</span>
        <span class="d"><span class="mono">${a.codigo}</span> · ${a.espacio} · ${a.hora}</span>
      </li>`)}</ul>
    </section>`;
}

// ── Pantallas ──────────────────────────────────────────────────────────────
function pantallaNombre() {
  pintar(raiz, html`${cabecera()}${bandaFamilia()}
    <form class="al-centro" data-nombre novalidate>
      <h1>¡Hola! ¿Cómo te llamas?</h1>
      <p>Tu nombre quedará anotado junto al material que añadas, para que tu profesorado sepa quién lo ha registrado.</p>
      <label class="campo"><span class="obligatorio">Nombre y apellido</span>
        <input name="nombre" value="${nombre}" autocomplete="name" maxlength="60" placeholder="Ej.: Lucía Pérez"></label>
      <button type="submit" class="boton primario" style="height:54px;font-size:17px;border-radius:14px">${nombre ? 'Guardar' : 'Empezar'}</button>
    </form>`);
  $('input[name=nombre]', raiz).focus();
}

function pantallaFormulario() {
  const estadoInicial = datos.estados.includes(ultimo.estado) ? ultimo.estado : 'bueno';
  const aulaInicial = datos.espacios.some((e) => e.id === ultimo.espacio_id) ? ultimo.espacio_id : null;
  pintar(raiz, html`${cabecera()}${bandaFamilia()}
    <form class="al-cuerpo" data-alta novalidate>
      <div data-exito></div>
      <div class="al-error" data-error hidden role="alert"></div>

      <label class="campo"><span class="obligatorio">Aula donde está el material</span>
        <select name="espacio_id">${opcionesAulas(aulaInicial)}</select></label>

      <label class="campo"><span class="obligatorio">¿Qué material es?</span>
        <input name="nombre" maxlength="200" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"
               placeholder="Ej.: Ordenador portátil, Camilla…"></label>

      <div class="campo" data-foto>
        <span>Foto (opcional)</span>
        <input type="file" accept="image/*" hidden data-foto-fichero>
        <button type="button" class="foto-boton" data-foto-elegir>
          <span class="foto-previa-al" data-foto-previa aria-hidden="true">📷</span>
          <span class="foto-texto"><b data-foto-titulo>Hacer o elegir una foto</b>
            <small data-foto-estado>Se reduce sola: casi no gasta datos</small></span>
        </button>
        <button type="button" class="enlace" data-foto-quitar hidden>Quitar la foto</button>
        <input type="hidden" name="foto_id" value="">
      </div>

      <div class="campo"><span>Cantidad</span>
        <div class="stepper">
          <button type="button" data-paso="-1" aria-label="Una menos">−</button>
          <input name="cantidad" type="number" inputmode="numeric" min="1" max="9999" value="1" aria-label="Cantidad">
          <button type="button" data-paso="1" aria-label="Una más">+</button>
        </div></div>

      <fieldset class="campo" style="border:0;padding:0;margin:0;min-width:0"><span>Estado</span>
        <div class="pastillas">${datos.estados.map((e) => html`
          <label class="pastilla"><input type="radio" name="estado" value="${e}" ${e === estadoInicial ? 'checked' : ''}><span>${ESTADOS[e] ?? e}</span></label>`)}
        </div></fieldset>

      <label class="campo"><span>Categoría</span>
        <input name="categoria" list="al-categorias" maxlength="80" autocomplete="off" placeholder="Elige una o escribe una nueva" value="${ultimo.categoria ?? ''}">
        <datalist id="al-categorias" data-categorias>${datos.categorias.map((c) => html`<option value="${c}"></option>`)}</datalist>
        <span class="ayuda">Si escribes una categoría nueva, se guarda y la podrá elegir todo el mundo.</span></label>

      <details class="mas"><summary>Más datos (opcional)</summary>
        <div class="mas-cuerpo">
          <label class="campo"><span>Ubicación dentro del aula</span><input name="ubicacion_detalle" maxlength="200" placeholder="Armario 2, balda 3"></label>
          <label class="campo"><span>Marca</span><input name="marca" maxlength="200"></label>
          <label class="campo"><span>Modelo</span><input name="modelo" maxlength="200"></label>
          <label class="campo"><span>Nº de serie</span><input name="numero_serie" maxlength="200" autocapitalize="characters"></label>
          <label class="campo"><span>Observaciones</span><textarea name="observaciones" maxlength="1000"></textarea></label>
        </div></details>

      <div data-lista>${listaHtml()}</div>
      <p class="al-aviso-final">Desde aquí solo puedes añadir material. Si te equivocas o hay que corregir algo, avisa a tu profesorado.</p>

      <div class="al-barra"><button type="submit" class="boton primario" data-guardar>Guardar material</button></div>
    </form>`);
}

// ── Formularios ────────────────────────────────────────────────────────────
function limpiarErrores(form) {
  $$('.con-error', form).forEach((c) => c.classList.remove('con-error'));
  $$('.campo > .error', form).forEach((e) => e.remove());
  const banner = $('[data-error]', form);
  if (banner) banner.hidden = true;
}

function mostrarErrores(form, detalles) {
  let primero = null;
  for (const [campo, mensaje] of Object.entries(detalles)) {
    const control = form.querySelector(`[name="${campo}"]`);
    const caja = control?.closest('.campo');
    if (!caja) continue;
    caja.classList.add('con-error');
    caja.insertAdjacentHTML('beforeend', String(html`<span class="error">${mensaje}</span>`));
    primero ??= control;
  }
  if (primero) {
    primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
    primero.focus({ preventScroll: true });
  }
  return Boolean(primero);
}

function mostrarBanner(form, mensaje) {
  const banner = $('[data-error]', form);
  banner.textContent = mensaje;
  banner.hidden = false;
  banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function guardarAlta(form) {
  limpiarErrores(form);
  const f = form.elements;
  const cuerpo = {
    alumno: nombre,
    espacio_id: Number(f.espacio_id.value) || null,
    nombre: f.nombre.value,
    cantidad: f.cantidad.value === '' ? null : Number(f.cantidad.value),
    estado: form.querySelector('input[name=estado]:checked')?.value,
    categoria: f.categoria.value,
    ubicacion_detalle: f.ubicacion_detalle.value,
    marca: f.marca.value,
    modelo: f.modelo.value,
    numero_serie: f.numero_serie.value,
    observaciones: f.observaciones.value,
    foto_id: f.foto_id.value || null,
  };

  if (subiendoFoto) { mostrarBanner(form, 'Espera un momento: la foto todavía se está subiendo.'); return; }
  const errores = {};
  if (!cuerpo.espacio_id) errores.espacio_id = 'Elige el aula donde está el material';
  if (!cuerpo.nombre.trim()) errores.nombre = 'Escribe qué material es';
  if (Object.keys(errores).length) { mostrarErrores(form, errores); return; }

  const boton = $('[data-guardar]', form);
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const r = await llamar('/articulos', cuerpo);
    const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    lista = [{ codigo: r.codigo, nombre: r.nombre, cantidad: r.cantidad, espacio: r.espacio_codigo, hora }, ...lista].slice(0, 30);
    ultimo = { espacio_id: cuerpo.espacio_id, estado: cuerpo.estado, categoria: cuerpo.categoria.trim() };
    guardar(claveLista, lista);
    guardar(claveUltimo, ultimo);

    // Una categoría nueva pasa a la lista de este formulario.
    const nueva = (r.categoria ?? '').trim();
    if (nueva && !datos.categorias.some((c) => c.toLowerCase() === nueva.toLowerCase())) {
      datos.categorias.push(nueva);
      $('[data-categorias]', form).insertAdjacentHTML('beforeend', String(html`<option value="${nueva}"></option>`));
    }

    pintar($('[data-exito]', form), html`
      <div class="al-exito" role="status"><span class="tic">✓</span>
        <div><b>¡Guardado!</b><span class="codigo">${r.codigo}</span>
        <small>${r.cantidad} × ${r.nombre} · ${r.espacio_codigo}</small></div></div>`);
    pintar($('[data-lista]', form), listaHtml());

    // Listo para el siguiente: se conservan aula, estado, categoría y ubicación.
    for (const campo of ['nombre', 'marca', 'modelo', 'numero_serie', 'observaciones']) f[campo].value = '';
    f.cantidad.value = 1;
    reiniciarFoto(form);
    $('[data-exito]', form).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    f.nombre.focus({ preventScroll: true });
    navigator.vibrate?.(30);
  } catch (err) {
    if (err.status === 404) {
      pantallaGrande('🔒', 'Este QR ya no es válido', err.message);
    } else if (!(err.detalles && mostrarErrores(form, err.detalles))) {
      mostrarBanner(form, err.message);
    }
  } finally {
    const actual = $('[data-guardar]', raiz);
    if (actual) { actual.disabled = false; actual.textContent = 'Guardar material'; }
  }
}

// ── Foto ───────────────────────────────────────────────────────────────────
let subiendoFoto = false;

function reiniciarFoto(form) {
  form.elements.foto_id.value = '';
  $('[data-foto-previa]', form).textContent = '📷';
  $('[data-foto-titulo]', form).textContent = 'Hacer o elegir una foto';
  const estado = $('[data-foto-estado]', form);
  estado.textContent = 'Se reduce sola: casi no gasta datos';
  estado.classList.remove('error');
  $('[data-foto-quitar]', form).hidden = true;
}

async function procesarFoto(form, archivo) {
  const estado = $('[data-foto-estado]', form);
  const marcar = (texto, error = false) => { estado.textContent = texto; estado.classList.toggle('error', error); };
  subiendoFoto = true;
  try {
    marcar('Preparando la foto…');
    const blob = await comprimirFoto(archivo);
    marcar(`Subiendo ${kb(blob.size)}…`);
    const subida = await subirFoto(blob);
    form.elements.foto_id.value = subida.id;
    pintar($('[data-foto-previa]', form), html`<img src="../api/fotos/${subida.id}/miniatura" alt="Tu foto">`);
    $('[data-foto-titulo]', form).textContent = 'Cambiar la foto';
    $('[data-foto-quitar]', form).hidden = false;
    marcar(`Foto lista · ${kb(subida.bytes)}`);
  } catch (err) {
    marcar(err.message || 'No se ha podido subir la foto.', true);
  } finally {
    subiendoFoto = false;
  }
}

function guardarNombre(form) {
  limpiarErrores(form);
  const valor = form.elements.nombre.value.trim().replace(/\s+/g, ' ');
  if (!valor) { mostrarErrores(form, { nombre: 'Escribe tu nombre' }); return; }
  nombre = valor.slice(0, 60);
  guardar(clavePersona, nombre);
  pantallaFormulario();
}

// ── Eventos (delegados: la pantalla se vuelve a pintar entera) ─────────────
raiz.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.matches('[data-nombre]')) guardarNombre(e.target);
  else if (e.target.matches('[data-alta]')) guardarAlta(e.target);
});
on(raiz, 'click', '[data-cambiar]', () => pantallaNombre());
on(raiz, 'click', '[data-foto-elegir]', () => { if (!subiendoFoto) $('[data-foto-fichero]', raiz).click(); });
on(raiz, 'click', '[data-foto-quitar]', () => reiniciarFoto($('[data-alta]', raiz)));
raiz.addEventListener('change', (e) => {
  if (!e.target.matches('[data-foto-fichero]')) return;
  const archivo = e.target.files[0];
  e.target.value = ''; // permite volver a elegir el mismo fichero
  if (archivo) procesarFoto($('[data-alta]', raiz), archivo);
});
on(raiz, 'click', '[data-paso]', (e, boton) => {
  const campo = $('input[name=cantidad]', raiz);
  campo.value = Math.min(9999, Math.max(1, (Number(campo.value) || 1) + Number(boton.dataset.paso)));
});
on(raiz, 'click', '[data-vaciar]', () => {
  lista = [];
  guardar(claveLista, lista);
  pintar($('[data-lista]', raiz), '');
  aviso('Lista vaciada (el material sigue guardado)');
});
// Recuerda aula, estado y categoría elegidos por si se recarga la página.
raiz.addEventListener('change', (e) => {
  if (e.target.name === 'espacio_id') ultimo = { ...ultimo, espacio_id: Number(e.target.value) || null };
  else if (e.target.name === 'estado') ultimo = { ...ultimo, estado: e.target.value };
  else return;
  guardar(claveUltimo, ultimo);
});

// ── Arranque ───────────────────────────────────────────────────────────────
(async function iniciar() {
  if (!token) {
    pantallaGrande('📷', 'Falta el código de acceso', 'Escanea de nuevo el QR que te ha dado tu profesorado.');
    return;
  }
  try {
    datos = await llamar('');
  } catch (err) {
    pantallaGrande(err.status === 404 ? '🔒' : '📡', err.status === 404 ? 'Este QR ya no es válido' : 'No se puede cargar', err.message);
    return;
  }
  document.title = `Añadir material · ${datos.familia.nombre}`;
  if (nombre) pantallaFormulario(); else pantallaNombre();
})();
