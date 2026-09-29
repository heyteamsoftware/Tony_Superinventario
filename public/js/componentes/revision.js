import { api, consulta } from '../api.js';
import { meta, familia, espacio } from '../estado.js';
import { notificarCambio } from '../cambios.js';
import { html, pintar, abrirDialogo, leerFormulario, aviso, $, $$, estadoBadge, chipFamilia, numero } from '../ui.js';
import { opcionesEspacios, opcionesFamilias } from './articulo.js';

// Revisión del inventario: se va marcando cada artículo al comprobarlo y, si
// todo coincide, se registra la revisión con fecha y nombre.
export async function dialogoRevision({ familia_id = null, espacio_id = null } = {}) {
  let articulos = [];

  const r = await abrirDialogo({
    titulo: 'Registrar revisión del inventario',
    clase: 'ancho',
    cuerpo: html`
      <div class="formulario">
        <label class="campo c3"><span class="obligatorio">Familia profesional</span>
          <select name="familia_id" data-tipo="entero" required>${opcionesFamilias(familia_id, { vacia: 'Elige una familia…' })}</select></label>
        <label class="campo c3"><span>Alcance</span>
          <select name="espacio_id" data-tipo="entero">
            <option value="">Todo el material de la familia (todas las aulas)</option>
            ${opcionesEspacios(espacio_id)}
          </select></label>
      </div>
      <div data-lista></div>
      <label class="campo"><span>Notas de la revisión</span>
        <textarea name="notas" maxlength="2000" placeholder="Opcional: incidencias, material pendiente de reparar…"></textarea></label>`,
    pie: html`
      <span class="izquierda tenue pequeno" data-progreso></span>
      <button type="button" class="boton" data-cerrar>Cancelar</button>
      <button type="submit" class="boton exito" data-confirmar>✓ Todo coincide · registrar revisión</button>`,
    alAbrir: (d, form) => {
      const lista = $('[data-lista]', form);
      const progreso = $('[data-progreso]', form);
      const confirmarBtn = $('[data-confirmar]', form);

      const actualizarProgreso = () => {
        const marcas = $$('input[data-comprobado]', lista);
        const hechas = marcas.filter((m) => m.checked).length;
        progreso.textContent = marcas.length ? `${hechas} de ${marcas.length} comprobados` : '';
        confirmarBtn.disabled = !form.elements.familia_id.value || hechas < marcas.length;
      };
      // El botón se habilita/deshabilita durante el envío; se recalcula después.
      form.addEventListener('focusin', actualizarProgreso);

      async function cargar() {
        const fam = form.elements.familia_id.value;
        const esp = form.elements.espacio_id.value;
        if (!fam) {
          pintar(lista, html`<div class="alerta info"><span class="ico">ℹ</span><div class="texto">Elige la familia cuyo material vas a revisar.</div></div>`);
          return actualizarProgreso();
        }
        pintar(lista, html`<div class="cargando"></div>`);
        const res = await api.get(`/articulos${consulta({ familia: fam, espacio: esp, por_pagina: 500, orden: 'espacio' })}`);
        articulos = res.items;
        const f = familia(fam);
        const e = esp ? espacio(esp) : null;
        pintar(lista, articulos.length
          ? html`
            <div class="alerta info"><span class="ico">✔</span><div class="texto">
              Comprueba físicamente cada artículo de <b>${f.nombre}</b>${e ? html` en <b>${e.codigo} · ${e.nombre}</b>` : ''} y márcalo.
              Si falta o sobra algo, cierra y corrígelo (dar de baja, trasladar o añadir): esos cambios también cuentan como repaso.
            </div></div>
            <div class="titulo-bloque" style="margin-top:14px"><h3>${articulos.length} artículos · ${numero(articulos.reduce((s, a) => s + a.cantidad, 0))} unidades</h3>
              <button type="button" class="boton pequeno" data-marcar-todos>Marcar todos</button></div>
            <div class="lista-articulos">
              ${articulos.map((a) => html`
                <label class="item-articulo" style="--c:${f.color}">
                  <span class="barra"></span>
                  <span style="min-width:0"><span class="nom" style="display:block">${a.nombre}</span>
                    <span class="det"><span class="mono">${a.codigo}</span> ${estadoBadge(a.estado)}
                      ${e ? a.ubicacion_detalle : html`${a.espacio_codigo} · ${a.espacio_nombre}`}</span></span>
                  <span class="acciones"><span class="cant">${numero(a.cantidad)}<small>uds.</small></span>
                    <input type="checkbox" data-comprobado style="width:20px;height:20px;accent-color:var(--ok)"></span>
                </label>`)}
            </div>`
          : html`<div class="alerta aviso"><span class="ico">∅</span><div class="texto">
              No hay material de <b>${f.nombre}</b> registrado${e ? html` en <b>${e.codigo}</b>` : ''}.
              Si confirmas, quedará constancia de que se ha revisado y efectivamente no hay nada.</div></div>`);
        actualizarProgreso();
      }

      form.elements.familia_id.addEventListener('change', cargar);
      form.elements.espacio_id.addEventListener('change', cargar);
      lista.addEventListener('change', actualizarProgreso);
      lista.addEventListener('click', (e) => {
        if (!e.target.closest('[data-marcar-todos]')) return;
        $$('input[data-comprobado]', lista).forEach((c) => { c.checked = true; });
        actualizarProgreso();
      });
      cargar();
    },
    alEnviar: async (form) => {
      const datos = leerFormulario(form);
      const rev = await api.post('/revisiones', { familia_id: datos.familia_id, espacio_id: datos.espacio_id, notas: datos.notas ?? '' });
      aviso(`Revisión registrada: ${rev.familia_nombre}${rev.espacio_codigo ? ` · ${rev.espacio_codigo}` : ''}`);
      return rev;
    },
  });
  if (r) await notificarCambio();
  return r;
}

// Datos descriptivos de un aula (la forma en el plano no se toca).
export async function dialogoEspacio(esp) {
  const r = await abrirDialogo({
    titulo: `Editar ${esp.codigo}`,
    cuerpo: html`
      <div class="formulario">
        <label class="campo c4"><span class="obligatorio">Nombre</span><input name="nombre" value="${esp.nombre}" maxlength="120" required></label>
        <label class="campo c2"><span>Tipo</span>
          <select name="tipo">${Object.entries(meta.tipos_espacio).map(([k, v]) => html`<option value="${k}" ${k === esp.tipo ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="campo c6"><span>Grupos y usos</span>
          <textarea name="grupos" maxlength="1000" placeholder="Un grupo por línea">${esp.grupos}</textarea>
          <span class="ayuda">Es lo que se ve escrito en el plano. Actualízalo cada curso.</span></label>
        <fieldset class="campo c6" style="border:0;padding:0;margin:0">
          <span>Familias que usan habitualmente este espacio</span>
          <div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:4px">
            ${meta.familias.map((f) => html`<label class="casilla"><input type="checkbox" name="fam_${f.id}" ${esp.familia_ids.includes(f.id) ? 'checked' : ''}>
              ${chipFamilia(f)}</label>`)}
          </div>
          <span class="ayuda">Orientativo: cualquier familia puede guardar material en cualquier aula.</span>
        </fieldset>
        <label class="campo c6"><span>Notas</span><textarea name="notas" maxlength="2000">${esp.notas}</textarea></label>
      </div>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button><button type="submit" class="boton primario">Guardar</button>`,
    alEnviar: async (form) => {
      const datos = leerFormulario(form);
      const familia_ids = meta.familias.filter((f) => datos[`fam_${f.id}`]).map((f) => f.id);
      const res = await api.patch(`/espacios/${esp.id}`, {
        nombre: datos.nombre, tipo: datos.tipo, grupos: datos.grupos ?? '', notas: datos.notas ?? '', familia_ids,
      });
      aviso('Espacio actualizado');
      return res;
    },
  });
  if (r) await notificarCambio();
  return r;
}
