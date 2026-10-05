import { api } from '../api.js';
import { meta, familia } from '../estado.js';
import { alCambiarInventario, notificarCambio } from '../cambios.js';
import {
  html, pintar, on, numero, euros, plural, haceTiempo, fecha, revisionBadge, abrirDialogo, confirmar, leerFormulario, aviso, avisoError,
} from '../ui.js';
import { dialogoRevision } from '../componentes/revision.js';
import { dialogoInformeFamilia } from '../componentes/informe.js';
import { dialogoAccesoAlumnado } from '../componentes/acceso.js';

const GRAVEDAD = { vencida: 0, nunca: 1, pronto: 2, al_dia: 3 };

function bloqueRevision(f) {
  const r = f.revision;
  const dias = meta.ajustes.dias_aviso_revision;
  const quien = f.ultima_revision && f.ultima_revision.fecha === f.ultimo_repaso
    ? `revisión de ${f.ultima_revision.usuario}`
    : f.ultimo_cambio ? `cambio de ${f.ultimo_cambio.usuario}` : '';
  const textos = {
    al_dia: ['✓', 'Inventario al día', `Último repaso ${haceTiempo(f.ultimo_repaso)} · ${quien}`],
    pronto: ['⏳', `Revisar pronto: vence en ${r.vence_en} días`, `Último repaso ${haceTiempo(f.ultimo_repaso)} · ${quien}`],
    vencida: ['⚠', `¡Más de ${dias} días sin repasar!`, `Último repaso ${haceTiempo(f.ultimo_repaso)} (${fecha(f.ultimo_repaso)})`],
    nunca: ['○', 'Sin revisiones todavía', 'Registra la primera revisión o da de alta su material'],
  };
  const [ico, titulo, sub] = textos[r.estado];
  return html`<div class="estado-rev fondo-${r.estado}"><span class="ico">${ico}</span><div><b>${titulo}</b><small>${sub}</small></div></div>`;
}

async function dialogoEspaciosFamilia(f) {
  const espacios = await api.get(`/familias/${f.id}/espacios`);
  await abrirDialogo({
    titulo: `${f.nombre} · estado por aula`,
    cuerpo: espacios.length
      ? html`<p class="tenue">Aulas donde la familia tiene material o que usa habitualmente. Una revisión de toda la familia cuenta para todas.</p>
        <div class="lista-revisiones">
          ${espacios.map((e) => html`<div class="fila-revision">
            <span class="nombre"><span class="mono tenue">${e.codigo}</span> ${e.nombre}
              <small>${e.planta_nombre} · ${plural(e.articulos, 'artículo', 'artículos')} · ${e.ultimo_repaso ? `repaso ${haceTiempo(e.ultimo_repaso)}` : 'nunca revisada'}</small></span>
            ${revisionBadge(e.revision, { corto: true })}
            <a class="boton pequeno" href="#/plano?espacio=${e.espacio_id}&familia=${f.id}" data-cerrar>Plano</a>
            <button type="button" class="boton pequeno" data-revisar-espacio="${e.espacio_id}">Revisar</button>
          </div>`)}
        </div>`
      : html`<div class="vacio">Esta familia no tiene material ni aulas asignadas todavía.</div>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cerrar</button>`,
    alAbrir: (d, form, cerrar) => {
      on(d, 'click', '[data-revisar-espacio]', (e, b) => {
        cerrar();
        dialogoRevision({ familia_id: f.id, espacio_id: Number(b.dataset.revisarEspacio) });
      });
    },
  });
}

async function dialogoFamilia(f = null) {
  const r = await abrirDialogo({
    titulo: f ? `Editar ${f.nombre}` : 'Nueva familia',
    clase: 'estrecho',
    cuerpo: html`
      <label class="campo"><span class="obligatorio">Nombre</span><input name="nombre" value="${f?.nombre ?? ''}" maxlength="120" required></label>
      <div class="formulario" style="grid-template-columns:1fr 1fr">
        <label class="campo" style="grid-column:auto"><span class="${f ? '' : 'obligatorio'}">Código (siglas)</span>
          <input name="codigo" value="${f?.codigo ?? ''}" maxlength="5" ${f ? 'disabled' : ''} placeholder="Ej.: INF" style="text-transform:uppercase">
          <span class="ayuda">${f ? 'No se puede cambiar: va en las etiquetas.' : 'De 2 a 5 letras. Prefijo de los códigos.'}</span></label>
        <label class="campo" style="grid-column:auto"><span>Color</span><input name="color" type="color" value="${f?.color ?? '#4f46e5'}" style="padding:4px"></label>
      </div>`,
    pie: html`<button type="button" class="boton" data-cerrar>Cancelar</button><button type="submit" class="boton primario">Guardar</button>`,
    alEnviar: (form) => {
      const datos = leerFormulario(form);
      return f ? api.patch(`/familias/${f.id}`, datos) : api.post('/familias', datos);
    },
  });
  if (r) { aviso('Familia guardada'); await notificarCambio(); }
}

// Genera el acceso de las familias que aún no lo tienen y abre los carteles de todas.
async function qrDeTodas() {
  const sin = meta.familias.filter((f) => !f.acceso_activo);
  if (sin.length) {
    const ok = await confirmar({
      titulo: 'Carteles QR de todas las familias',
      mensaje: `Se generará el QR de ${plural(sin.length, 'familia que aún no lo tiene', 'familias que aún no lo tienen')} y se abrirán los carteles de todas para imprimir.`,
      textoSi: 'Generar e imprimir',
    });
    if (!ok) return;
    for (const f of sin) await api.post(`/familias/${f.id}/acceso`);
    await notificarCambio();
  }
  location.hash = '#/qr-alumnado?todas=1';
}

export function montar(raiz) {
  function render() {
    const familias = [...meta.familias].sort((a, b) =>
      GRAVEDAD[a.revision.estado] - GRAVEDAD[b.revision.estado] || a.nombre.localeCompare(b.nombre, 'es'));
    const vencidas = familias.filter((f) => f.revision.estado === 'vencida').length;
    const pronto = familias.filter((f) => f.revision.estado === 'pronto').length;

    pintar(raiz, html`
      <div class="pagina">
        <div class="pagina-cabecera">
          <div class="titulo"><h1>Familias profesionales</h1>
            <p>Cada familia debe repasar su inventario al menos cada ${meta.ajustes.dias_aviso_revision} días: registrando una revisión o actualizando su material.</p></div>
          <div class="acciones">
            <button type="button" class="boton" data-accion="nueva">＋ Nueva familia</button>
            <button type="button" class="boton" data-accion="qr-todas" title="Genera e imprime los carteles QR de todas las familias">📱 Carteles QR de todas</button>
            <button type="button" class="boton exito" data-accion="revisar">✓ Registrar revisión</button>
          </div>
        </div>
        ${vencidas ? html`<div class="alerta" style="margin-bottom:16px"><span class="ico">⚠</span><div class="texto">
            <b>${plural(vencidas, 'familia tiene', 'familias tienen')} la revisión vencida.</b> Aparecen primero.</div></div>`
          : pronto ? html`<div class="alerta aviso" style="margin-bottom:16px"><span class="ico">⏳</span><div class="texto">
            ${plural(pronto, 'familia debe', 'familias deben')} revisar su inventario pronto.</div></div>` : ''}
        <div class="rejilla-familias">
          ${familias.map((f) => html`
            <article class="tarjeta familia-tarjeta" style="--c:${f.color}">
              <div class="banda"></div>
              <div class="cuerpo">
                <div class="cab">
                  <div class="sigla">${f.codigo}</div>
                  <div style="flex:1;min-width:0"><h3>${f.nombre}</h3>
                    <div class="tenue pequeno">${plural(f.espacios, 'aula con material', 'aulas con material')}</div></div>
                  <button type="button" class="boton fantasma pequeno icono" data-editar="${f.id}" title="Editar nombre y color">✎</button>
                </div>
                ${bloqueRevision(f)}
                <div class="numeros">
                  <div><b>${numero(f.articulos)}</b><span>artículos</span></div>
                  <div><b>${numero(f.unidades)}</b><span>unidades</span></div>
                  <div><b>${numero(f.espacios)}</b><span>aulas</span></div>
                  <div><b style="font-size:13px;line-height:24px">${f.valor ? euros(f.valor) : '—'}</b><span>valor</span></div>
                </div>
              </div>
              <div class="pie">
                <a class="boton pequeno" href="#/plano?familia=${f.id}&modo=revision">🗺 Plano</a>
                <a class="boton pequeno" href="#/inventario?familia=${f.id}">☰ Inventario</a>
                <button type="button" class="boton pequeno" data-aulas="${f.id}">Por aula</button>
                <button type="button" class="boton pequeno" data-qr="${f.id}" title="QR para que el alumnado añada material de esta familia">📱 QR${f.acceso_activo ? ' ✓' : ''}</button>
                <button type="button" class="boton pequeno" data-pdf="${f.id}" title="Inventario de la familia por aulas en PDF">📄 PDF</button>
                <button type="button" class="boton pequeno exito" data-revisar="${f.id}" style="margin-left:auto">✓ Revisar</button>
              </div>
            </article>`)}
        </div>
      </div>`);
  }

  on(raiz, 'click', '[data-accion="nueva"]', () => dialogoFamilia().catch(avisoError));
  on(raiz, 'click', '[data-qr]', (e, b) => dialogoAccesoAlumnado(familia(b.dataset.qr)));
  on(raiz, 'click', '[data-accion="qr-todas"]', () => qrDeTodas().catch(avisoError));
  on(raiz, 'click', '[data-pdf]', (e, b) => dialogoInformeFamilia({ familia_id: Number(b.dataset.pdf) }));
  on(raiz, 'click', '[data-accion="revisar"]', () => dialogoRevision());
  on(raiz, 'click', '[data-editar]', (e, b) => dialogoFamilia(familia(b.dataset.editar)).catch(avisoError));
  on(raiz, 'click', '[data-revisar]', (e, b) => dialogoRevision({ familia_id: Number(b.dataset.revisar) }));
  on(raiz, 'click', '[data-aulas]', (e, b) => dialogoEspaciosFamilia(familia(b.dataset.aulas)).catch(avisoError));

  render();
  return alCambiarInventario(render);
}

