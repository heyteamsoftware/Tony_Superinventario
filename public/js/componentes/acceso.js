import { api, consulta } from '../api.js';
import { notificarCambio } from '../cambios.js';
import { html, pintar, crearModal, confirmar, aviso, avisoError, on } from '../ui.js';

// Enlace que lleva el QR de una familia: la página de inventario móvil con el
// código secreto. Se calcula respecto a la página actual para que valga
// también cuando la app está publicada en una subcarpeta del servidor.
export function urlMovil(token) {
  return new URL(`movil/?t=${token}`, location.href.split('#')[0]).href;
}

export const urlQr = (token) => `api/qr.svg${consulta({ texto: urlMovil(token) })}`;

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

// Diálogo de gestión del QR de una familia.
export async function dialogoQrMovil(familia) {
  let acceso;
  try {
    acceso = await api.get(`/familias/${familia.id}/acceso`);
  } catch (err) {
    avisoError(err);
    return;
  }
  const { d, cerrar, cerrado } = crearModal('estrecho');

  function pintarDialogo() {
    pintar(d, html`
      <div class="modal-cab"><h2>📱 QR de inventario móvil · ${familia.nombre}</h2>
        <button type="button" class="boton fantasma icono" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="modal-cuerpo">
        ${acceso.activo ? html`
          <div class="qr-dialogo">
            <div class="qr-marco"><img src="${urlQr(acceso.token)}" alt="QR de acceso de ${familia.nombre}" width="220" height="220"></div>
            <p class="tenue pequeno" style="text-align:center">Quien lo escanee abre una pantalla de móvil donde <b>solo puede añadir material de ${familia.nombre}</b>:
              no ve ni cambia el resto del inventario.</p>
            <label class="campo"><span>Enlace</span>
              <input readonly value="${urlMovil(acceso.token)}" data-enlace></label>
          </div>`
          : html`
          <p>Genera el QR de inventario móvil de esta familia. Quien lo escanee con el móvil accede a un formulario sencillo en el que
            <b>solo puede añadir material</b> (elige el aula, escribe qué es, cuántos hay y en qué estado está).</p>
          <p class="tenue">No podrán ver, editar, mover ni borrar nada del inventario. Cada alta queda registrada con su nombre y la marca "(QR)".</p>`}
      </div>
      <div class="modal-pie">
        ${acceso.activo ? html`
          <button type="button" class="boton peligro izquierda" data-accion="desactivar">Desactivar</button>
          <button type="button" class="boton" data-accion="regenerar" title="El QR actual dejará de funcionar">↻ Generar uno nuevo</button>
          <button type="button" class="boton" data-accion="copiar">Copiar enlace</button>
          <button type="button" class="boton primario" data-accion="imprimir">🖨 Imprimir cartel</button>`
          : html`
          <button type="button" class="boton" data-cerrar>Cancelar</button>
          <button type="button" class="boton primario" data-accion="generar">Generar QR</button>`}
      </div>`);
  }

  async function generar() {
    acceso = await api.post(`/familias/${familia.id}/acceso`);
    await notificarCambio();
    pintarDialogo();
  }

  on(d, 'click', '[data-accion]', async (e, boton) => {
    const accion = boton.dataset.accion;
    try {
      if (accion === 'generar') {
        await generar();
        aviso('QR generado');
      } else if (accion === 'regenerar') {
        const ok = await confirmar({
          titulo: 'Generar un QR nuevo',
          mensaje: 'El QR actual dejará de funcionar de inmediato. Tendrás que volver a imprimir los carteles y cambiar los que estén colgados.',
          textoSi: 'Generar uno nuevo',
        });
        if (ok) { await generar(); aviso('QR nuevo generado: el anterior ya no funciona'); }
      } else if (accion === 'desactivar') {
        const ok = await confirmar({
          titulo: 'Desactivar el acceso',
          mensaje: `El QR de ${familia.nombre} dejará de funcionar. Podrás generar uno nuevo cuando quieras.`,
          textoSi: 'Desactivar',
          peligro: true,
        });
        if (ok) {
          await api.del(`/familias/${familia.id}/acceso`);
          acceso = { ...acceso, activo: false, token: null };
          await notificarCambio();
          pintarDialogo();
          aviso('Acceso desactivado');
        }
      } else if (accion === 'copiar') {
        if (await copiar(urlMovil(acceso.token))) aviso('Enlace copiado');
        else { d.querySelector('[data-enlace]')?.select(); aviso('Selecciona el enlace y cópialo con Ctrl+C'); }
      } else if (accion === 'imprimir') {
        cerrar();
        location.hash = `#/qr-movil?familia=${familia.id}`;
      }
    } catch (err) {
      avisoError(err);
    }
  });

  // Al pinchar en el enlace se selecciona entero (la CSP no permite handlers en línea).
  d.addEventListener('focusin', (e) => { if (e.target.matches('[data-enlace]')) e.target.select(); });

  pintarDialogo();
  d.showModal();
  await cerrado;
}
