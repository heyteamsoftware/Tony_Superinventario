import { consulta } from '../api.js';
import { familia } from '../estado.js';
import { usuarioActual } from '../usuario.js';
import { html, abrirDialogo, leerFormulario, plural } from '../ui.js';
import { opcionesFamilias } from './articulo.js';

export function urlInformeFamilia(familiaId, { bajas = false, valores = false } = {}) {
  return `api/familias/${familiaId}/inventario.pdf${consulta({ bajas: bajas ? 1 : '', valores: valores ? 1 : '', por: usuarioActual() ?? '' })}`;
}

// Informe PDF del inventario de una familia, ordenado por planta y aula.
export function dialogoInformeFamilia({ familia_id = null } = {}) {
  return abrirDialogo({
    titulo: 'Exportar inventario de una familia en PDF',
    clase: 'estrecho',
    cuerpo: html`
      <p class="tenue">Lista del material ordenada por planta y aula, con una casilla por artículo para usarla en la revisión física y un espacio para la firma.</p>
      <label class="campo"><span class="obligatorio">Familia profesional</span>
        <select name="familia_id" data-tipo="entero" required>${opcionesFamilias(familia_id, { vacia: 'Elige una familia…' })}</select>
        <span class="ayuda" data-resumen></span></label>
      <label class="casilla"><input type="checkbox" name="valores"> Incluir el valor económico</label>
      <label class="casilla"><input type="checkbox" name="bajas"> Incluir los artículos dados de baja</label>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button>
              <button type="submit" class="boton primario">📄 Generar PDF</button>`,
    alAbrir: (d, form) => {
      const resumen = d.querySelector('[data-resumen]');
      const actualizar = () => {
        const f = familia(form.elements.familia_id.value);
        resumen.textContent = f ? `${plural(f.articulos, 'artículo', 'artículos')} en ${plural(f.espacios, 'aula', 'aulas')}` : '';
      };
      form.elements.familia_id.addEventListener('change', actualizar);
      actualizar();
    },
    alEnviar: (form) => {
      const datos = leerFormulario(form);
      if (!datos.familia_id) {
        throw Object.assign(new Error('Elige una familia'), { detalles: { familia_id: 'Elige una familia' } });
      }
      // Se abre en otra pestaña para verlo, imprimirlo o guardarlo.
      window.open(urlInformeFamilia(datos.familia_id, datos), '_blank', 'noopener');
      return true;
    },
  });
}
