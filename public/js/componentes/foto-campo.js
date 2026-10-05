import { api } from '../api.js';
import { comprimirFoto, kb } from '../foto.js';
import { html, pintar, $, on } from '../ui.js';

// Campo "Foto" de los formularios de la app. La foto se reduce en el móvil, se
// sube nada más elegirla y el formulario guarda solo su identificador
// (input oculto "foto_id"). El servidor la vuelve a procesar.

export const urlFoto = (id, miniatura = false) => `api/fotos/${id}${miniatura ? '/miniatura' : ''}`;

const previa = (id) => (id
  ? html`<img src="${urlFoto(id, true)}" alt="Foto del artículo">`
  : html`<span aria-hidden="true">📷</span>`);

export function campoFoto(fotoId = null) {
  return html`
    <div class="campo c6 campo-foto" data-foto>
      <span>Foto (opcional)</span>
      <div class="foto-caja">
        <div class="foto-previa" data-foto-previa>${previa(fotoId)}</div>
        <div class="foto-acciones">
          <div class="acciones">
            <button type="button" class="boton" data-foto-elegir>${fotoId ? 'Cambiar foto' : '📷 Añadir foto'}</button>
            <button type="button" class="boton fantasma" data-foto-quitar ${fotoId ? '' : 'hidden'}>Quitar</button>
          </div>
          <span class="ayuda" data-foto-estado>Se reduce sola: pesa unos 100 KB.</span>
        </div>
        <input type="file" accept="image/*" hidden data-foto-fichero>
        <input type="hidden" name="foto_id" value="${fotoId ?? ''}">
      </div>
    </div>`;
}

// Activa el campo dentro de un formulario ya pintado.
export function activarCampoFoto(form) {
  const caja = $('[data-foto]', form);
  const fichero = $('[data-foto-fichero]', caja);
  const oculto = form.elements.foto_id;
  const estado = $('[data-foto-estado]', caja);
  const elegir = $('[data-foto-elegir]', caja);
  const quitar = $('[data-foto-quitar]', caja);
  const marco = $('[data-foto-previa]', caja);

  const mensaje = (texto, error = false) => {
    estado.textContent = texto;
    estado.classList.toggle('error', error);
  };
  const pintarEstado = () => {
    pintar(marco, previa(oculto.value || null));
    elegir.textContent = oculto.value ? 'Cambiar foto' : '📷 Añadir foto';
    quitar.hidden = !oculto.value;
  };

  on(caja, 'click', '[data-foto-elegir]', () => fichero.click());
  on(caja, 'click', '[data-foto-quitar]', () => {
    oculto.value = '';
    mensaje('Se reduce sola: pesa unos 100 KB.');
    pintarEstado();
  });

  fichero.addEventListener('change', async () => {
    const archivo = fichero.files[0];
    fichero.value = ''; // permite volver a elegir el mismo fichero
    if (!archivo) return;
    form.dataset.subiendoFoto = '1';
    elegir.disabled = quitar.disabled = true;
    try {
      mensaje('Preparando la foto…');
      const blob = await comprimirFoto(archivo);
      mensaje(`Subiendo ${kb(blob.size)}…`);
      const subida = await api.subir('/fotos', blob);
      oculto.value = subida.id;
      mensaje(`Foto añadida · ${kb(subida.bytes)}`);
      pintarEstado();
    } catch (err) {
      mensaje(err.message || 'No se ha podido subir la foto.', true);
    } finally {
      delete form.dataset.subiendoFoto;
      elegir.disabled = quitar.disabled = false;
    }
  });
}

export const fotoSubiendo = (form) => form.dataset.subiendoFoto === '1';

// Tras "Guardar y añadir otro": el siguiente artículo empieza sin foto.
export function reiniciarCampoFoto(form) {
  form.elements.foto_id.value = '';
  pintar($('[data-foto-previa]', form), previa(null));
  $('[data-foto-elegir]', form).textContent = '📷 Añadir foto';
  $('[data-foto-quitar]', form).hidden = true;
  const estado = $('[data-foto-estado]', form);
  estado.textContent = 'Se reduce sola: pesa unos 100 KB.';
  estado.classList.remove('error');
}
