import { Router, json, raw } from 'express';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { ESTADOS } from './db/index.js';
import { ErrorApi } from './lib/errores.js';
import * as articulos from './servicios/articulos.js';
import * as catalogo from './servicios/catalogo.js';
import * as estadisticas from './servicios/estadisticas.js';
import * as datos from './servicios/datos.js';
import * as revisiones from './servicios/revisiones.js';
import * as informes from './servicios/informes.js';
import * as movil from './servicios/movil.js';
import * as fotos from './servicios/fotos.js';
import * as visitas from './servicios/visitas.js';
import * as excel from './servicios/excel.js';
import { crearApiMovil } from './api-movil.js';

// Sin contraseñas: cada petición lleva el nombre de quien la hace en la
// cabecera X-Usuario (codificada con encodeURIComponent) para el historial.
function usuarioDe(req) {
  let nombre = req.get('X-Usuario') ?? '';
  try { nombre = decodeURIComponent(nombre); } catch { /* se usa tal cual */ }
  nombre = nombre.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return nombre || 'Anónimo';
}

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ErrorApi(404, 'No encontrado');
  return n;
};

const entero = (v, def, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : def;
};

const opcionesListado = (q) => ({
  pagina: entero(q.pagina, 1, 1e6),
  porPagina: entero(q.por_pagina, 50, 500),
  orden: q.orden,
  dir: q.dir,
});

export function crearApi(db, { dirFotos = null } = {}) {
  const api = Router();
  // Quita del disco las fotos que ya no usa ningún artículo. Nunca debe romper la petición.
  const barrerFotos = () => {
    try { fotos.purgarHuerfanas(db, dirFotos); } catch (err) { console.error('No se pudieron limpiar fotos:', err.message); }
  };
  // QR de inventario móvil: va antes que nada, con su propio límite de tamaño.
  // /alumno es el nombre antiguo: los QR ya impresos siguen funcionando.
  const apiMovil = crearApiMovil(db, { dirFotos });
  api.use('/movil', apiMovil);
  api.use('/alumno', apiMovil);
  api.use(json({ limit: '10mb' }));

  // ── Catálogo ───────────────────────────────────────────────────────────
  api.get('/meta', (req, res) => {
    res.json({
      plantas: catalogo.listarPlantas(db),
      familias: revisiones.familiasConRevision(db),
      espacios: catalogo.listarEspacios(db),
      categorias: catalogo.listarCategorias(db),
      estados: ESTADOS,
      tipos_espacio: catalogo.TIPOS_ESPACIO,
      ajustes: revisiones.obtenerAjustes(db),
    });
  });

  api.get('/familias', (req, res) => res.json(revisiones.familiasConRevision(db)));
  api.get('/familias/:id/espacios', (req, res) => res.json(revisiones.espaciosDeFamilia(db, id(req))));

  // QR de inventario móvil: el token solo se entrega por aquí (no va en /meta).
  // Generar uno nuevo invalida el anterior; borrarlo desactiva el acceso.
  api.get('/familias/:id/acceso', (req, res) => res.json(movil.estadoAcceso(db, id(req))));
  api.post('/familias/:id/acceso', (req, res) => res.status(201).json(movil.generarAcceso(db, id(req))));
  api.delete('/familias/:id/acceso', (req, res) => {
    movil.revocarAcceso(db, id(req));
    res.status(204).end();
  });
  // Informe PDF del inventario de una familia, ordenado por aula. Se abre con
  // un enlace normal, así que el nombre de quien lo genera va en ?por=
  api.get('/familias/:id/inventario.pdf', async (req, res) => {
    const { pdf, familia } = await informes.pdfInventarioFamilia(db, id(req), {
      bajas: req.query.bajas === '1',
      valores: req.query.valores === '1',
      fotos: req.query.fotos === '1',
      dirFotos,
      usuario: String(req.query.por ?? '').slice(0, 80),
    });
    const nombre = `inventario-${familia.codigo}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.type('application/pdf').set('Content-Disposition', `inline; filename="${nombre}"`).send(pdf);
  });
  api.post('/familias', (req, res) => res.status(201).json(catalogo.crearFamilia(db, req.body)));
  api.patch('/familias/:id', (req, res) => res.json(catalogo.actualizarFamilia(db, id(req), req.body)));

  api.get('/espacios', (req, res) => res.json(catalogo.listarEspacios(db)));
  api.get('/espacios/:id', (req, res) => res.json(catalogo.obtenerEspacio(db, id(req))));
  api.patch('/espacios/:id', (req, res) => res.json(catalogo.actualizarEspacio(db, id(req), req.body)));

  api.get('/categorias', (req, res) => res.json(catalogo.listarCategorias(db)));
  api.post('/categorias', (req, res) => res.status(201).json(catalogo.crearCategoria(db, req.body)));
  api.patch('/categorias/:id', (req, res) => res.json(catalogo.renombrarCategoria(db, id(req), req.body)));
  api.delete('/categorias/:id', (req, res) => {
    catalogo.eliminarCategoria(db, id(req));
    res.status(204).end();
  });

  // ── Visitantes únicos ───────────────────────────────────────────────────
  // El navegador manda su identificador aleatorio anónimo; se cuentan los distintos.
  api.get('/visitas', (req, res) => res.json(visitas.estadisticasVisitas(db)));
  api.post('/visitas', (req, res) => res.json(visitas.registrarVisita(db, req.body?.id, 'app', req.ip)));

  // ── Fotos ──────────────────────────────────────────────────────────────
  // La foto se sube aparte (cuerpo = la imagen) y luego se asocia al artículo
  // con foto_id. El servidor la reduce, la recodifica y le quita los metadatos.
  api.get('/fotos/uso', (req, res) => res.json(fotos.usoFotos(db)));
  api.post('/fotos', raw({ type: 'image/*', limit: fotos.LIMITES.subidaMax }), async (req, res) => {
    res.status(201).json(await fotos.guardarFoto(db, dirFotos, req.body, { origen: 'app', usuario: usuarioDe(req) }));
  });
  const servirFoto = (miniatura) => (req, res) => {
    if (!dirFotos || !fotos.esIdFoto(req.params.id)) throw new ErrorApi(404, 'Foto no encontrada');
    // El nombre es un identificador aleatorio que nunca cambia: caché larga.
    // Con "root" solo cuenta el nombre del fichero (el id ya está validado): así no
    // influye cómo se llamen las carpetas de la ruta (p. ej. una que empiece por punto).
    res.sendFile(`${req.params.id}${miniatura ? '-m' : ''}.webp`, {
      root: dirFotos, maxAge: '365d', immutable: true, headers: { 'Content-Type': 'image/webp' },
    }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Foto no encontrada' });
    });
  };
  api.get('/fotos/:id', servirFoto(false));
  api.get('/fotos/:id/miniatura', servirFoto(true));

  // ── Artículos ──────────────────────────────────────────────────────────
  api.get('/articulos', (req, res) => {
    res.json(articulos.listar(db, req.query, opcionesListado(req.query)));
  });

  api.get('/articulos/exportar.csv', (req, res) => {
    const fecha = new Date().toISOString().slice(0, 10);
    res.attachment(`inventario-${fecha}.csv`).type('text/csv; charset=utf-8')
      .send(datos.exportarCsv(db, req.query, { orden: req.query.orden, dir: req.query.dir }));
  });

  // Hoja de cálculo con una columna de mini fotos (.xlsx)
  api.get('/articulos/exportar.xlsx', async (req, res, next) => {
    try {
      const fecha = new Date().toISOString().slice(0, 10);
      const buffer = await excel.generarExcel(db, dirFotos, req.query, { orden: req.query.orden, dir: req.query.dir });
      res.attachment(`inventario-${fecha}.xlsx`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  });

  api.post('/articulos', (req, res) => res.status(201).json(articulos.crear(db, req.body, usuarioDe(req))));

  api.post('/articulos/lote/traslado', (req, res) => res.json(articulos.trasladarLote(db, req.body, usuarioDe(req))));
  api.post('/articulos/lote/estado', (req, res) => res.json(articulos.cambiarEstadoLote(db, req.body, usuarioDe(req))));

  api.get('/articulos/:id', (req, res) => {
    const art = articulos.obtener(db, id(req));
    res.json({ ...art, movimientos: articulos.movimientosDe(db, art.id) });
  });
  api.patch('/articulos/:id', (req, res) => {
    const art = articulos.actualizar(db, id(req), req.body, usuarioDe(req));
    barrerFotos(); // por si se ha cambiado o quitado la foto
    res.json(art);
  });
  api.post('/articulos/:id/traslado', (req, res) => res.json(articulos.trasladar(db, id(req), req.body, usuarioDe(req))));
  api.post('/articulos/:id/baja', (req, res) => res.json(articulos.darDeBaja(db, id(req), req.body, usuarioDe(req))));
  api.post('/articulos/:id/reactivar', (req, res) => res.json(articulos.reactivar(db, id(req), req.body, usuarioDe(req))));
  api.delete('/articulos/:id', (req, res) => {
    articulos.eliminar(db, id(req), usuarioDe(req));
    barrerFotos();
    res.status(204).end();
  });

  // ── Paneles e historial ───────────────────────────────────────────────
  api.get('/estadisticas', (req, res) => {
    const familias = revisiones.familiasConRevision(db);
    res.json({
      ...estadisticas.resumen(db),
      avisos_revision: familias.filter((f) => f.revision.estado !== 'al_dia'),
      ajustes: revisiones.obtenerAjustes(db),
    });
  });
  api.get('/plano/ocupacion', (req, res) => res.json(estadisticas.ocupacion(db, req.query)));
  api.get('/plano/revisiones', (req, res) => res.json(revisiones.revisionesPorEspacio(db)));
  api.get('/movimientos', (req, res) => {
    res.json(estadisticas.listarMovimientos(db, { ...req.query, ...opcionesListado(req.query) }));
  });

  // ── Revisiones del inventario ─────────────────────────────────────────
  api.get('/revisiones', (req, res) => {
    res.json(revisiones.listarRevisiones(db, { ...req.query, ...opcionesListado(req.query) }));
  });
  api.post('/revisiones', (req, res) => res.status(201).json(revisiones.registrarRevision(db, req.body, usuarioDe(req))));
  api.get('/ajustes', (req, res) => res.json(revisiones.obtenerAjustes(db)));
  api.patch('/ajustes', (req, res) => res.json(revisiones.actualizarAjustes(db, req.body)));

  // ── Importación, copias y etiquetas ───────────────────────────────────
  api.get('/importar/plantilla.csv', (req, res) => {
    res.attachment('plantilla-inventario.csv').type('text/csv; charset=utf-8').send(datos.plantillaCsv());
  });
  api.post('/importar', (req, res) => {
    res.json(datos.importarCsv(db, req.body?.csv, usuarioDe(req), { simular: req.body?.simular === true }));
  });

  // Copia consistente de la base de datos (aunque haya escrituras en curso).
  api.get('/copia-seguridad', (req, res, next) => {
    const dir = mkdtempSync(join(tmpdir(), 'superinventario-'));
    const fichero = join(dir, 'copia.db');
    db.prepare('VACUUM INTO ?').run(fichero);
    const nombre = `superinventario-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`;
    res.download(fichero, nombre, (err) => {
      rmSync(dir, { recursive: true, force: true });
      if (err && !res.headersSent) next(err);
    });
  });

  api.get('/qr.svg', async (req, res) => {
    const texto = String(req.query.texto ?? '');
    if (!texto || texto.length > 500) throw new ErrorApi(400, 'Texto de QR no válido');
    const svg = await QRCode.toString(texto, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
  });

  api.use((req, res) => res.status(404).json({ error: 'Ruta de la API no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err instanceof ErrorApi) {
      return res.status(err.status).json({ error: err.message, detalles: err.detalles });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El fichero es demasiado grande' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return api;
}
