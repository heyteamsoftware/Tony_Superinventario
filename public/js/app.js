import { meta, recargarMeta, alCambiarMeta } from './estado.js';
import { usuarioActual, guardarUsuario, iniciales } from './usuario.js';
import { html, pintar, abrirDialogo, $, $$, avisoError } from './ui.js';
import { abrirFicha } from './componentes/articulo.js';

// Cada vista exporta montar(raiz, { params, query }) y puede devolver una
// función de limpieza que se llama al salir de ella.
const VISTAS = {
  plano: () => import('./vistas/plano.js'),
  inventario: () => import('./vistas/inventario.js'),
  familias: () => import('./vistas/familias.js'),
  revisiones: () => import('./vistas/revisiones.js'),
  historial: () => import('./vistas/historial.js'),
  datos: () => import('./vistas/datos.js'),
  etiquetas: () => import('./vistas/etiquetas.js'),
  'qr-movil': () => import('./vistas/qr-movil.js'),
};

const vista = $('#vista');
let desmontar = null;
let navegacion = 0;

function leerRuta() {
  const [ruta, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const partes = ruta.split('/').filter(Boolean);
  return { partes, query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function navegar() {
  const id = ++navegacion;
  const { partes, query } = leerRuta();

  // Los QR de las etiquetas apuntan a #/articulo/ID: se abre la ficha sobre el plano.
  if (partes[0] === 'articulo' && partes[1]) {
    history.replaceState(null, '', '#/plano');
    await navegar();
    abrirFicha(Number(partes[1]));
    return;
  }

  const nombre = VISTAS[partes[0]] ? partes[0] : 'plano';
  $$('.nav a').forEach((a) => a.classList.toggle('activo', a.dataset.seccion === nombre));
  document.body.dataset.vista = nombre;

  desmontar?.();
  desmontar = null;
  pintar(vista, html`<div class="cargando"></div>`);
  try {
    const modulo = await VISTAS[nombre]();
    if (id !== navegacion) return;
    vista.replaceChildren();
    desmontar = (await modulo.montar(vista, { params: partes.slice(1), query })) ?? null;
  } catch (err) {
    avisoError(err);
    pintar(vista, html`<div class="pagina"><div class="alerta"><span class="ico">⚠</span>
      <div class="texto">No se ha podido cargar esta sección: ${err.message}</div></div></div>`);
  }
}

// ── Usuario (sin contraseña) ────────────────────────────────────────────────
function pintarUsuario() {
  const nombre = usuarioActual() ?? '';
  pintar($('#boton-usuario'), html`<span class="avatar">${iniciales(nombre)}</span><span>${nombre || 'Identifícate'}</span>`);
}

async function pedirUsuario({ obligatorio = false } = {}) {
  const nombre = await abrirDialogo({
    titulo: obligatorio ? '¡Hola! ¿Quién eres?' : 'Cambiar de usuario',
    clase: 'estrecho',
    cuerpo: html`
      <p class="tenue">No hace falta contraseña. Tu nombre queda registrado en el historial de cada cambio que hagas desde este equipo.</p>
      <label class="campo"><span class="obligatorio">Nombre y apellido</span>
        <input name="nombre" value="${usuarioActual() ?? ''}" maxlength="80" autocomplete="name" placeholder="Ej.: Ana García (Sanidad)" required></label>`,
    pie: html`${obligatorio ? '' : html`<button type="button" class="boton" data-cerrar>Cancelar</button>`}
              <button type="submit" class="boton primario">Entrar</button>`,
    alEnviar: (form) => {
      const valor = form.elements.nombre.value.trim();
      if (!valor) throw Object.assign(new Error('Escribe tu nombre'), { detalles: { nombre: 'Escribe tu nombre' } });
      return valor;
    },
  });
  if (nombre) {
    guardarUsuario(nombre);
    pintarUsuario();
  } else if (obligatorio && !usuarioActual()) {
    return pedirUsuario({ obligatorio: true });
  }
  return nombre;
}

// ── Contador de avisos en el menú ───────────────────────────────────────────
function pintarAvisosMenu() {
  const n = meta.familias.filter((f) => f.revision?.estado === 'vencida').length;
  const marca = $('#nav-avisos');
  marca.hidden = n === 0;
  marca.textContent = n;
  marca.title = `${n} familias con la revisión vencida`;
}

// ── Arranque ────────────────────────────────────────────────────────────────
async function iniciar() {
  $('#boton-usuario').addEventListener('click', () => pedirUsuario());
  $('#busqueda-global').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.elements.q.value.trim();
    location.hash = `#/inventario${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    e.target.elements.q.blur();
  });
  window.addEventListener('hashchange', navegar);
  alCambiarMeta(pintarAvisosMenu);
  pintarUsuario();

  try {
    await recargarMeta();
  } catch (err) {
    pintar(vista, html`<div class="pagina"><div class="alerta"><span class="ico">⚠</span>
      <div class="texto">No se puede conectar con el servidor. ¿Está en marcha? (${err.message})</div></div></div>`);
    return;
  }
  await navegar();
  if (!usuarioActual()) pedirUsuario({ obligatorio: true });
}

iniciar();
