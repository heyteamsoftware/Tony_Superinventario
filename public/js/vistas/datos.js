import { api } from '../api.js';
import { meta, espacio } from '../estado.js';
import { alCambiarInventario, notificarCambio } from '../cambios.js';
import {
  html, pintar, on, $, plural, numero, abrirDialogo, confirmar, leerFormulario, aviso, avisoError, descargar,
} from '../ui.js';
import { dialogoEspacio } from '../componentes/revision.js';

// Excel en español suele guardar los CSV en Windows-1252, no en UTF-8: si al
// leer como UTF-8 aparecen caracteres inválidos, se relee en esa codificación.
async function leerTexto(fichero) {
  const bytes = await fichero.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

export function montar(raiz) {
  let csvPendiente = null;

  pintar(raiz, html`
    <div class="pagina">
      <div class="pagina-cabecera">
        <div class="titulo"><h1>Datos y ajustes</h1><p>Importar desde Excel, exportar, copias de seguridad y configuración.</p></div>
      </div>
      <div class="rejilla-datos">
        <section class="tarjeta tarjeta-cuerpo" style="grid-column:1/-1">
          <div class="titulo-bloque"><h2>Importar material desde Excel (CSV)</h2>
            <a class="boton pequeno" href="api/importar/plantilla.csv" download>⭳ Descargar plantilla</a></div>
          <p class="tenue" style="margin-bottom:14px">Columnas obligatorias: <b>Nombre</b>, <b>Familia</b> (nombre o siglas) y <b>Espacio</b> (código como P1-03 o nombre).
            Opcionales: categoría, cantidad, estado, marca, modelo, nº de serie, valor, fecha de adquisición, proveedor, descripción, observaciones.
            En Excel: <i>Archivo → Guardar como → CSV</i>. Primero se comprueba todo el fichero; solo se importa si no hay errores.</p>
          <label class="zona-soltar" data-soltar>
            <span class="icono-grande">📄</span>
            <b>Arrastra aquí el fichero CSV o pulsa para elegirlo</b>
            <span class="pequeno">Separador “;” o “,” · UTF-8 o formato de Excel</span>
            <input type="file" accept=".csv,text/csv,.txt" hidden data-fichero>
          </label>
          <div data-informe style="margin-top:14px"></div>
        </section>

        <section class="tarjeta tarjeta-cuerpo">
          <h2 style="margin-bottom:6px">Exportar y copias</h2>
          <p class="tenue" style="margin-bottom:14px">El inventario se exporta en un CSV que abre Excel directamente. La copia de seguridad es la base de datos completa.</p>
          <div class="acciones" style="flex-direction:column;align-items:stretch">
            <a class="boton" href="api/articulos/exportar.csv" download>⭳ Exportar inventario activo</a>
            <a class="boton" href="api/articulos/exportar.csv?bajas=incluir" download>⭳ Exportar incluyendo bajas</a>
            <button type="button" class="boton primario" data-accion="copia">🛟 Descargar copia de seguridad</button>
          </div>
          <p class="tenue pequeno" style="margin-top:12px">Para restaurar una copia, detén el servidor y sustituye <span class="mono">data/inventario.db</span> por el fichero descargado.</p>
        </section>

        <section class="tarjeta tarjeta-cuerpo">
          <h2 style="margin-bottom:6px">Avisos de revisión</h2>
          <p class="tenue" style="margin-bottom:14px">Cuántos días puede pasar una familia sin repasar su inventario antes de mostrar el aviso.</p>
          <form data-ajustes class="formulario" style="grid-template-columns:1fr 1fr">
            <label class="campo" style="grid-column:auto"><span>Plazo máximo (días)</span>
              <input name="dias_aviso_revision" type="number" min="7" max="3650" data-tipo="entero" value="${meta.ajustes.dias_aviso_revision}"></label>
            <label class="campo" style="grid-column:auto"><span>Preaviso (días antes)</span>
              <input name="dias_preaviso_revision" type="number" min="0" max="365" data-tipo="entero" value="${meta.ajustes.dias_preaviso_revision}"></label>
            <div style="grid-column:1/-1"><button type="submit" class="boton primario">Guardar ajustes</button></div>
          </form>
        </section>

        <section class="tarjeta tarjeta-cuerpo">
          <div class="titulo-bloque"><h2>Categorías</h2><button type="button" class="boton pequeno" data-accion="nueva-categoria">＋ Nueva</button></div>
          <div class="lista-simple" data-categorias></div>
        </section>

        <section class="tarjeta tarjeta-cuerpo" style="grid-column:1/-1">
          <div class="titulo-bloque"><h2>Espacios del plano</h2><span class="tenue pequeno">Actualiza los grupos de cada aula al empezar el curso</span></div>
          <div class="tabla-envoltorio"><table class="tabla" data-espacios></table></div>
        </section>
      </div>
    </div>`);

  const informe = $('[data-informe]', raiz);
  const soltar = $('[data-soltar]', raiz);

  function pintarCatalogos() {
    pintar($('[data-categorias]', raiz), html`${meta.categorias.map((c) => html`<div>
      <span class="nombre">${c.nombre} <span class="tenue pequeno">· ${plural(c.articulos, 'artículo', 'artículos')}</span></span>
      <button type="button" class="boton fantasma pequeno icono" data-renombrar="${c.id}" title="Renombrar">✎</button>
      <button type="button" class="boton fantasma pequeno icono peligro" data-borrar-categoria="${c.id}" title="Eliminar">🗑</button>
    </div>`)}`);
    pintar($('[data-espacios]', raiz), html`
      <thead><tr><th>Código</th><th>Nombre</th><th>Planta</th><th>Tipo</th><th>Grupos</th><th class="num">Artículos</th><th></th></tr></thead>
      <tbody>${meta.espacios.map((e) => html`<tr>
        <td><span class="mono">${e.codigo}</span></td>
        <td><span class="punto" style="--c:${e.color ?? '#fff'};display:inline-block;margin-right:6px;border:1px solid #0002"></span><b style="font-weight:600">${e.nombre}</b></td>
        <td>${e.planta_nombre}</td><td>${meta.tipos_espacio[e.tipo]}</td>
        <td class="secundario" style="max-width:360px;white-space:pre-line">${e.grupos}</td>
        <td class="num">${numero(e.articulos)}</td>
        <td><button type="button" class="boton pequeno" data-editar-espacio="${e.id}">✎ Editar</button></td>
      </tr>`)}</tbody>`);
  }

  async function analizar(fichero) {
    if (!fichero) return;
    if (fichero.size > 8 * 1024 * 1024) { aviso('El fichero es demasiado grande (máx. 8 MB)', { error: true }); return; }
    pintar(informe, html`<div class="cargando"></div>`);
    try {
      csvPendiente = await leerTexto(fichero);
      const r = await api.post('/importar', { csv: csvPendiente, simular: true });
      pintar(informe, html`
        <div class="alerta ${r.errores.length ? '' : 'info'}"><span class="ico">${r.errores.length ? '⚠' : '✔'}</span>
          <div class="texto"><b>${fichero.name}</b>: ${plural(r.filas, 'fila', 'filas')} · ${plural(r.validas, 'correcta', 'correctas')}
            ${r.errores.length ? html` · <b>${plural(r.errores.length, 'fila con errores', 'filas con errores')}</b>. Corrígelas en Excel y vuelve a subir el fichero.` : ''}
            ${r.categorias_nuevas.length ? html`<br>Se crearán las categorías: ${r.categorias_nuevas.join(', ')}.` : ''}</div>
          ${r.errores.length ? '' : html`<button type="button" class="boton primario" data-accion="importar">Importar ${plural(r.validas, 'artículo', 'artículos')}</button>`}
        </div>
        ${r.errores.length ? html`<div class="informe-errores" style="margin-top:10px">
          ${r.errores.map((e) => html`<div><b>Fila ${e.fila}</b>${e.nombre ? html` (${e.nombre})` : ''}: ${e.mensajes.join(' · ')}</div>`)}
        </div>` : ''}`);
    } catch (err) {
      csvPendiente = null;
      pintar(informe, html`<div class="alerta"><span class="ico">⚠</span><div class="texto">${err.message}</div></div>`);
    }
  }

  // ── Eventos ─────────────────────────────────────────────────────────────
  $('[data-fichero]', raiz).addEventListener('change', (e) => { analizar(e.target.files[0]); e.target.value = ''; });
  soltar.addEventListener('dragover', (e) => { e.preventDefault(); soltar.classList.add('encima'); });
  soltar.addEventListener('dragleave', () => soltar.classList.remove('encima'));
  soltar.addEventListener('drop', (e) => { e.preventDefault(); soltar.classList.remove('encima'); analizar(e.dataTransfer.files[0]); });

  on(raiz, 'click', '[data-accion="importar"]', async (e, b) => {
    b.disabled = true;
    try {
      const r = await api.post('/importar', { csv: csvPendiente });
      csvPendiente = null;
      pintar(informe, html`<div class="alerta info"><span class="ico">🎉</span><div class="texto">
        <b>${plural(r.importados, 'artículo importado', 'artículos importados')}.</b> Ya aparecen en el plano y en el inventario.</div>
        <a class="boton pequeno" href="#/inventario?orden=actualizado&dir=desc">Ver</a></div>`);
      await notificarCambio();
    } catch (err) {
      b.disabled = false;
      avisoError(err);
    }
  });

  on(raiz, 'click', '[data-accion="copia"]', () => { descargar('api/copia-seguridad'); aviso('Preparando la copia de seguridad…'); });

  $('[data-ajustes]', raiz).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.patch('/ajustes', leerFormulario(e.target));
      aviso('Ajustes guardados');
      await notificarCambio();
    } catch (err) { avisoError(err); }
  });

  async function dialogoCategoria(c = null) {
    const r = await abrirDialogo({
      titulo: c ? 'Renombrar categoría' : 'Nueva categoría',
      clase: 'estrecho',
      cuerpo: html`<label class="campo"><span class="obligatorio">Nombre</span><input name="nombre" value="${c?.nombre ?? ''}" maxlength="80" required></label>`,
      pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button><button type="submit" class="boton primario">Guardar</button>`,
      alEnviar: (form) => (c ? api.patch(`/categorias/${c.id}`, leerFormulario(form)) : api.post('/categorias', leerFormulario(form))),
    });
    if (r) await notificarCambio();
  }
  on(raiz, 'click', '[data-accion="nueva-categoria"]', () => dialogoCategoria().catch(avisoError));
  on(raiz, 'click', '[data-renombrar]', (e, b) => dialogoCategoria(meta.categorias.find((c) => c.id === Number(b.dataset.renombrar))).catch(avisoError));
  on(raiz, 'click', '[data-borrar-categoria]', async (e, b) => {
    const c = meta.categorias.find((x) => x.id === Number(b.dataset.borrarCategoria));
    const ok = await confirmar({
      titulo: 'Eliminar categoría',
      mensaje: `¿Eliminar "${c.nombre}"?${c.articulos ? ` Sus ${c.articulos} artículos quedarán sin categoría.` : ''}`,
      textoSi: 'Eliminar', peligro: true,
    });
    if (!ok) return;
    try { await api.del(`/categorias/${c.id}`); aviso('Categoría eliminada'); await notificarCambio(); } catch (err) { avisoError(err); }
  });
  on(raiz, 'click', '[data-editar-espacio]', (e, b) => dialogoEspacio(espacio(b.dataset.editarEspacio)).catch(avisoError));

  pintarCatalogos();
  return alCambiarInventario(pintarCatalogos);
}
