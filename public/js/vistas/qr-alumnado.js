import { api } from '../api.js';
import { meta, familia } from '../estado.js';
import { html, pintar, on } from '../ui.js';
import { urlAlumnado, urlQr } from '../componentes/acceso.js';

// Cartel imprimible (uno por página) con el QR de acceso del alumnado.
//   #/qr-alumnado?familia=ID    el de una familia
//   #/qr-alumnado?todas=1       el de todas las que tengan el acceso activo
export async function montar(raiz, { query }) {
  pintar(raiz, html`<div class="pagina"><div class="cargando"></div></div>`);

  const familias = query.todas
    ? meta.familias.filter((f) => f.acceso_activo)
    : [familia(query.familia)].filter(Boolean);
  const accesos = await Promise.all(familias.map((f) => api.get(`/familias/${f.id}/acceso`).then((a) => ({ f, ...a })).catch(() => null)));
  const carteles = accesos.filter((a) => a?.activo);

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera no-imprimir">
        <div class="titulo"><h1>Carteles QR del alumnado</h1>
          <p>${carteles.length ? `${carteles.length} ${carteles.length === 1 ? 'cartel' : 'carteles'}, uno por página. Imprímelos y pégalos en las aulas o talleres de cada familia.` : 'No hay ningún acceso activo para imprimir.'}</p></div>
        <div class="acciones">
          <button type="button" class="boton" data-volver>← Volver</button>
          ${carteles.length ? html`<button type="button" class="boton primario" data-imprimir>🖨 Imprimir</button>` : ''}
        </div>
      </div>
      ${carteles.length ? html`<div class="carteles">${carteles.map(({ f, token }) => html`
        <article class="cartel" style="--c:${f.color}">
          <div class="cartel-banda"></div>
          <div class="cartel-cuerpo">
            <img class="cartel-logo" src="img/logo-cifp.webp" alt="" width="84" height="84">
            <div class="cartel-centro">CIFP Tony Gallardo · Superinventario</div>
            <h2>${f.nombre}</h2>
            <p class="cartel-sub">Añade aquí el material que encuentres</p>
            <div class="cartel-qr"><img src="${urlQr(token)}" alt="QR de acceso de ${f.nombre}"></div>
            <ol class="cartel-pasos">
              <li>Abre la cámara del móvil y <b>escanea el código</b>.</li>
              <li>Escribe <b>tu nombre</b>.</li>
              <li>Elige <b>el aula</b> y añade el material: qué es, cuántos hay y en qué estado.</li>
            </ol>
            <p class="cartel-nota">Solo permite añadir material. No se puede ver, cambiar ni borrar nada del inventario.</p>
            <p class="cartel-url">${urlAlumnado(token)}</p>
          </div>
        </article>`)}</div>`
        : html`<div class="vacio"><span class="icono-grande">📱</span>Genera primero el QR desde la tarjeta de la familia (botón «📱 QR»).</div>`}
    </div>`);

  on(raiz, 'click', '[data-imprimir]', () => window.print());
  on(raiz, 'click', '[data-volver]', () => history.back());
}
