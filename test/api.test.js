import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar } from './ayuda.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

const nuevo = (extra = {}) => ({
  nombre: 'Camilla articulada',
  familia_id: app.familia('SAN'),
  espacio_id: app.espacio('P1-03'),
  cantidad: 2,
  ...extra,
});

describe('catálogo inicial', () => {
  test('3 plantas, 12 familias y todos los espacios del plano', () => {
    assert.equal(app.meta.plantas.length, 3);
    assert.equal(app.meta.familias.length, 12);
    assert.equal(app.meta.espacios.length, 39);
    assert.deepEqual(app.meta.plantas.map((p) => p.codigo), ['P2', 'P1', 'PB']);
    const cafeteria = app.meta.espacios.find((e) => e.codigo === 'PB-02');
    assert.deepEqual(cafeteria.familia_ids.sort(), [app.familia('HOT'), app.familia('INA')].sort());
  });

  test('las familias arrancan sin revisar', () => {
    assert.ok(app.meta.familias.every((f) => f.revision.estado === 'nunca'));
    assert.equal(app.meta.ajustes.dias_aviso_revision, 365);
  });
});

describe('artículos', () => {
  test('alta con código por familia e historial con el usuario', async () => {
    const r = await app.post('/api/articulos', nuevo({ valor: '350,5', fecha_adquisicion: '15/09/2025' }), { usuario: 'María Núñez' });
    assert.equal(r.status, 201);
    assert.match(r.body.codigo, /^SAN-\d{5}$/);
    assert.equal(r.body.valor, 350.5);
    assert.equal(r.body.fecha_adquisicion, '2025-09-15');
    assert.equal(r.body.estado, 'bueno');
    assert.equal(r.body.espacio_codigo, 'P1-03');
    assert.equal(r.body.planta_codigo, 'P1');

    const ficha = await app.get(`/api/articulos/${r.body.id}`);
    assert.equal(ficha.body.movimientos.length, 1);
    assert.equal(ficha.body.movimientos[0].tipo, 'alta');
    assert.equal(ficha.body.movimientos[0].usuario, 'María Núñez');
  });

  test('los códigos son correlativos por familia', async () => {
    const a = (await app.post('/api/articulos', nuevo({ familia_id: app.familia('COM') }))).body;
    const b = (await app.post('/api/articulos', nuevo({ familia_id: app.familia('COM') }))).body;
    assert.equal(a.codigo, 'COM-00001');
    assert.equal(b.codigo, 'COM-00002');
  });

  test('valida los datos con mensajes por campo', async () => {
    const r = await app.post('/api/articulos', {
      nombre: '  ', familia_id: 9999, espacio_id: app.espacio('P1-01'), cantidad: -1, fecha_adquisicion: '31/02/2025', estado: 'baja',
    });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.body.detalles).sort(), ['cantidad', 'estado', 'fecha_adquisicion', 'nombre']);

    const ref = await app.post('/api/articulos', nuevo({ familia_id: 9999 }));
    assert.equal(ref.status, 400);
    assert.equal(ref.body.detalles.familia_id, 'La familia no existe');
  });

  test('JSON mal formado y rutas inexistentes', async () => {
    const res = await fetch(`${app.base}/api/articulos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
    assert.equal(res.status, 400);
    assert.equal((await app.get('/api/articulos/999999')).status, 404);
    assert.equal((await app.get('/api/articulos/abc')).status, 404);
    assert.equal((await app.get('/api/no-existe')).status, 404);
  });

  test('edición: registra solo lo que cambia y separa traslados y estados', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Monitor', familia_id: app.familia('IMA'), espacio_id: app.espacio('P1-01') }))).body;
    const r = await app.patch(`/api/articulos/${art.id}`, {
      nombre: 'Monitor 24"', cantidad: 2, espacio_id: app.espacio('P1-02'), estado: 'averiado', categoria: 'Equipos informáticos',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.espacio_codigo, 'P1-02');

    const movs = (await app.get(`/api/articulos/${art.id}`)).body.movimientos;
    const tipos = movs.map((m) => m.tipo).sort();
    assert.deepEqual(tipos, ['alta', 'edicion', 'estado', 'traslado']);
    const edicion = movs.find((m) => m.tipo === 'edicion');
    assert.deepEqual(Object.keys(edicion.detalle.cambios).sort(), ['categoria', 'nombre']);
    assert.equal(edicion.detalle.cambios.categoria.despues, 'Equipos informáticos');

    const sinCambios = await app.patch(`/api/articulos/${art.id}`, { nombre: 'Monitor 24"' });
    assert.equal(sinCambios.status, 200);
    assert.equal((await app.get(`/api/articulos/${art.id}`)).body.movimientos.length, 4);
  });

  test('traslado completo', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Balón medicinal', familia_id: app.familia('AFD'), espacio_id: app.espacio('P2-08'), cantidad: 6 }))).body;
    const r = await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('P1-16'), ubicacion_detalle: 'Armario 1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.nuevo, null);
    assert.equal(r.body.articulo.espacio_codigo, 'P1-16');
    assert.equal(r.body.articulo.ubicacion_detalle, 'Armario 1');

    const mismo = await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('P1-16') });
    assert.equal(mismo.status, 400);
  });

  test('traslado parcial: divide el artículo y deja rastro en ambos', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Silla', familia_id: app.familia('SSC'), espacio_id: app.espacio('P1-05'), cantidad: 20 }))).body;
    const r = await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('P1-06'), cantidad: 5 });
    assert.equal(r.status, 200);
    assert.equal(r.body.articulo.cantidad, 15);
    assert.equal(r.body.articulo.espacio_codigo, 'P1-05');
    assert.equal(r.body.nuevo.cantidad, 5);
    assert.equal(r.body.nuevo.espacio_codigo, 'P1-06');
    assert.equal(r.body.nuevo.nombre, 'Silla');
    assert.notEqual(r.body.nuevo.codigo, art.codigo);

    const altaNuevo = (await app.get(`/api/articulos/${r.body.nuevo.id}`)).body.movimientos[0];
    assert.equal(altaNuevo.detalle.origen_codigo, art.codigo);

    const demasiadas = await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('P1-06'), cantidad: 99 });
    assert.equal(demasiadas.status, 400);
  });

  test('baja, exclusión de listados y reactivación', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Horno viejo', familia_id: app.familia('HOT'), espacio_id: app.espacio('PB-04') }))).body;
    assert.equal((await app.post(`/api/articulos/${art.id}/baja`, {})).status, 400);

    const baja = await app.post(`/api/articulos/${art.id}/baja`, { motivo: 'Irreparable' });
    assert.equal(baja.body.estado, 'baja');
    assert.equal(baja.body.motivo_baja, 'Irreparable');
    assert.equal((await app.post(`/api/articulos/${art.id}/baja`, { motivo: 'x' })).status, 409);
    assert.equal((await app.post(`/api/articulos/${art.id}/traslado`, { espacio_id: app.espacio('PB-02') })).status, 409);

    const activos = (await app.get('/api/articulos?q=horno')).body;
    assert.equal(activos.total, 0);
    const conBajas = (await app.get('/api/articulos?q=horno&bajas=incluir')).body;
    assert.equal(conBajas.total, 1);

    const re = await app.post(`/api/articulos/${art.id}/reactivar`, { estado: 'regular' });
    assert.equal(re.body.estado, 'regular');
    assert.equal(re.body.motivo_baja, null);
  });

  test('borrado definitivo conserva el historial', async () => {
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Error de alta' }))).body;
    assert.equal((await app.del(`/api/articulos/${art.id}`)).status, 204);
    assert.equal((await app.get(`/api/articulos/${art.id}`)).status, 404);
    const hist = (await app.get('/api/movimientos?tipo=eliminacion')).body;
    assert.ok(hist.items.some((m) => m.articulo_codigo === art.codigo && m.articulo_id === null));

    // El código eliminado vuelve a estar libre y el siguiente alta lo reutiliza.
    const otro = (await app.post('/api/articulos', nuevo())).body;
    assert.equal(otro.codigo, art.codigo);
  });
});

describe('búsqueda y filtros', () => {
  before(async () => {
    const e = app.espacio('PB-05');
    for (const [nombre, marca] of [['Cámara de fotos', 'Canon'], ['Microscopio óptico', 'Zeiss'], ['Probeta 100% vidrio', '']]) {
      await app.post('/api/articulos', { nombre, marca, familia_id: app.familia('INA'), espacio_id: e, categoria: 'Material didáctico' });
    }
  });

  test('sin tildes ni mayúsculas, por varias palabras', async () => {
    assert.equal((await app.get('/api/articulos?q=CAMARA')).body.items[0].nombre, 'Cámara de fotos');
    assert.equal((await app.get('/api/articulos?q=optico zeiss')).body.total, 1);
    assert.equal((await app.get('/api/articulos?q=optico canon')).body.total, 0);
  });

  test('los comodines de LIKE se buscan literalmente', async () => {
    assert.equal((await app.get(`/api/articulos?q=${encodeURIComponent('100%')}`)).body.total, 1);
    assert.equal((await app.get(`/api/articulos?q=${encodeURIComponent('_')}`)).body.total, 0);
  });

  test('por familia, planta, espacio y categoría', async () => {
    const ina = (await app.get(`/api/articulos?familia=${app.familia('INA')}`)).body;
    assert.ok(ina.items.every((a) => a.familia_codigo === 'INA'));
    const pb = (await app.get(`/api/articulos?planta=${app.meta.plantas.find((p) => p.codigo === 'PB').id}`)).body;
    assert.ok(pb.total >= 3 && pb.items.every((a) => a.planta_codigo === 'PB'));
    const lab = (await app.get(`/api/articulos?espacio=${app.espacio('PB-05')}&categoria=${app.categoria('Material didáctico')}`)).body;
    assert.equal(lab.total, 3);
    const varias = (await app.get(`/api/articulos?familia=${app.familia('INA')},${app.familia('SAN')}`)).body;
    assert.ok(varias.items.some((a) => a.familia_codigo === 'SAN'));
  });

  test('por lista de identificadores (etiquetas)', async () => {
    const todos = (await app.get('/api/articulos?por_pagina=3')).body.items;
    const ids = todos.map((a) => a.id).join(',');
    const r = (await app.get(`/api/articulos?ids=${ids},abc`)).body;
    assert.deepEqual(r.items.map((a) => a.id).sort(), todos.map((a) => a.id).sort());
  });

  test('paginación y orden', async () => {
    const p1 = (await app.get('/api/articulos?por_pagina=2&pagina=1&orden=nombre')).body;
    const p2 = (await app.get('/api/articulos?por_pagina=2&pagina=2&orden=nombre')).body;
    assert.equal(p1.items.length, 2);
    assert.equal(p1.total, p2.total);
    assert.ok(p1.items[1].nombre.localeCompare(p2.items[0].nombre, 'es', { sensitivity: 'base' }) <= 0);
    const desc = (await app.get('/api/articulos?orden=codigo&dir=desc&por_pagina=500')).body.items;
    assert.ok(desc[0].codigo >= desc.at(-1).codigo);
  });

  test('ocupación del plano por espacio y familia', async () => {
    const occ = (await app.get(`/api/plano/ocupacion?familia=${app.familia('INA')}`)).body;
    const lab = occ.find((o) => o.espacio_id === app.espacio('PB-05'));
    assert.equal(lab.articulos, 3);
    assert.deepEqual(lab.familias.map((f) => f.familia_id), [app.familia('INA')]);
  });
});

describe('operaciones en lote', () => {
  test('trasladar y cambiar estado a varios', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await app.post('/api/articulos', nuevo({ nombre: `Lote ${i}`, familia_id: app.familia('MAM'), espacio_id: app.espacio('PB-10') }))).body.id);
    }
    const t = await app.post('/api/articulos/lote/traslado', { ids, espacio_id: app.espacio('P1-15') });
    assert.deepEqual(t.body, { procesados: 3, omitidos: 0 });
    const e = await app.post('/api/articulos/lote/estado', { ids, estado: 'regular' });
    assert.equal(e.body.procesados, 3);
    const lista = (await app.get(`/api/articulos?espacio=${app.espacio('P1-15')}`)).body.items;
    assert.ok(lista.filter((a) => ids.includes(a.id)).every((a) => a.estado === 'regular'));

    assert.equal((await app.post('/api/articulos/lote/estado', { ids: [], estado: 'bueno' })).status, 400);
    // Si un artículo no existe, no se aplica ningún cambio.
    const fallo = await app.post('/api/articulos/lote/estado', { ids: [ids[0], 999999], estado: 'nuevo' });
    assert.equal(fallo.status, 404);
    assert.equal((await app.get(`/api/articulos/${ids[0]}`)).body.estado, 'regular');
  });
});

describe('revisiones del inventario', () => {
  test('una familia con cambios recientes está al día', async () => {
    const fam = (await app.get('/api/familias')).body.find((f) => f.codigo === 'SAN');
    assert.equal(fam.revision.estado, 'al_dia');
    assert.equal(fam.ultimo_cambio.usuario.length > 0, true);
    assert.equal(fam.ultima_revision, null);
  });

  test('una familia sin actividad sale en los avisos', async () => {
    const est = (await app.get('/api/estadisticas')).body;
    const codigos = est.avisos_revision.map((f) => f.codigo);
    assert.ok(!codigos.includes('SAN'));
    // Seguridad no tiene material todavía: nunca se ha repasado.
    assert.ok(codigos.includes('SEA'));
  });

  test('registrar una revisión "sin cambios" en un aula', async () => {
    const sea = app.familia('SEA');
    const aula = app.espacio('P2-01');
    const art = (await app.post('/api/articulos', nuevo({ nombre: 'Maniquí RCP', familia_id: sea, espacio_id: aula }))).body;
    // Simulamos que el artículo y la familia llevan más de un año sin tocarse.
    app.db.prepare("UPDATE articulos SET revisado_en = '2024-01-01T00:00:00.000Z' WHERE id = ?").run(art.id);
    app.db.prepare("UPDATE movimientos SET fecha = '2024-01-01T00:00:00.000Z' WHERE familia_id = ?").run(sea);

    let familia = (await app.get('/api/familias')).body.find((f) => f.id === sea);
    assert.equal(familia.revision.estado, 'vencida');
    let espacios = (await app.get(`/api/familias/${sea}/espacios`)).body;
    assert.equal(espacios.find((e) => e.espacio_id === aula).revision.estado, 'vencida');

    const r = await app.post('/api/revisiones', { familia_id: sea, espacio_id: aula, notas: 'Todo en su sitio' }, { usuario: 'Jefa de Seguridad' });
    assert.equal(r.status, 201);
    assert.equal(r.body.articulos, 1);
    assert.equal(r.body.espacio_codigo, 'P2-01');

    espacios = (await app.get(`/api/familias/${sea}/espacios`)).body;
    assert.equal(espacios.find((e) => e.espacio_id === aula).revision.estado, 'al_dia');
    const revisado = (await app.get(`/api/articulos/${art.id}`)).body;
    assert.ok(revisado.revisado_en > '2025');

    familia = (await app.get('/api/familias')).body.find((f) => f.id === sea);
    assert.equal(familia.revision.estado, 'al_dia');
    assert.equal(familia.ultima_revision.usuario, 'Jefa de Seguridad');

    const lista = (await app.get(`/api/revisiones?familia=${sea}`)).body;
    assert.equal(lista.total, 1);
    assert.equal(lista.items[0].notas, 'Todo en su sitio');
  });

  test('una revisión de toda la familia cubre todos sus espacios', async () => {
    const afd = app.familia('AFD');
    await app.post('/api/revisiones', { familia_id: afd });
    const espacios = (await app.get(`/api/familias/${afd}/espacios`)).body;
    assert.ok(espacios.length >= 3);
    assert.ok(espacios.every((e) => e.revision.estado === 'al_dia'));
  });

  test('estado de revisión por aula para el plano', async () => {
    const mapa = (await app.get('/api/plano/revisiones')).body;
    const aula = mapa[app.espacio('P2-01')];
    const sea = aula.find((r) => r.familia_id === app.familia('SEA'));
    assert.equal(sea.revision.estado, 'al_dia');
    assert.equal(sea.articulos, 1);
  });

  test('validación de revisiones y ajustes', async () => {
    assert.equal((await app.post('/api/revisiones', { familia_id: 999 })).status, 400);
    assert.equal((await app.post('/api/revisiones', {})).status, 400);
    assert.equal((await app.patch('/api/ajustes', { dias_aviso_revision: 3 })).status, 400);
    assert.equal((await app.patch('/api/ajustes', { dias_preaviso_revision: 400 })).status, 400);
    const ok = await app.patch('/api/ajustes', { dias_aviso_revision: 180, dias_preaviso_revision: 15 });
    assert.deepEqual(ok.body, { dias_aviso_revision: 180, dias_preaviso_revision: 15 });
    await app.patch('/api/ajustes', { dias_aviso_revision: 365, dias_preaviso_revision: 30 });
  });
});

describe('familias, espacios y categorías', () => {
  test('editar un espacio y sus familias habituales', async () => {
    const id = app.espacio('P1-10');
    const r = await app.patch(`/api/espacios/${id}`, { nombre: 'FOL y orientación', familia_ids: [app.familia('COM')] });
    assert.equal(r.body.nombre, 'FOL y orientación');
    assert.deepEqual(r.body.familia_ids, [app.familia('COM')]);
    assert.equal((await app.patch(`/api/espacios/${id}`, { familia_ids: [999] })).status, 400);
    assert.equal((await app.patch(`/api/espacios/${id}`, { tipo: 'piscina' })).status, 400);
  });

  test('crear y editar familias sin duplicados', async () => {
    const r = await app.post('/api/familias', { codigo: 'inf', nombre: 'Informática y Comunicaciones', color: '#123ABC' });
    assert.equal(r.status, 201);
    assert.equal(r.body.codigo, 'INF');
    assert.equal(r.body.color, '#123abc');
    assert.equal((await app.post('/api/familias', { codigo: 'INF', nombre: 'Otra', color: '#000000' })).status, 409);
    assert.equal((await app.post('/api/familias', { codigo: 'XYZ', nombre: 'sanidad', color: '#000000' })).status, 409);
    assert.equal((await app.patch(`/api/familias/${r.body.id}`, { color: 'rojo' })).status, 400);
    assert.equal((await app.patch(`/api/familias/${r.body.id}`, { nombre: 'Informática' })).body.nombre, 'Informática');
  });

  test('borrar una categoría deja sus artículos sin categoría', async () => {
    const cat = (await app.post('/api/categorias', { nombre: 'Temporal' })).body;
    assert.equal((await app.post('/api/categorias', { nombre: 'temporal' })).status, 409);
    const art = (await app.post('/api/articulos', nuevo({ categoria_id: cat.id }))).body;
    assert.equal((await app.del(`/api/categorias/${cat.id}`)).status, 204);
    assert.equal((await app.get(`/api/articulos/${art.id}`)).body.categoria_id, null);
    assert.ok((await app.get('/api/articulos?categoria=sin')).body.items.some((a) => a.id === art.id));
  });
});

describe('importación y exportación', () => {
  test('exportación CSV para Excel', async () => {
    const res = await app.get(`/api/articulos/exportar.csv?familia=${app.familia('INA')}`, { crudo: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /inventario-\d{4}-\d{2}-\d{2}\.csv/);
    // res.text() descarta el BOM, así que se comprueban los bytes.
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'falta el BOM UTF-8 que necesita Excel');
    const texto = bytes.toString('utf8');
    assert.ok(texto.startsWith('﻿Código;Nombre;Familia'));
    assert.match(texto, /Cámara de fotos/);
  });

  test('la simulación informa de los errores sin guardar nada', async () => {
    const antes = (await app.get('/api/articulos?bajas=incluir')).body.total;
    const csv = 'Nombre;Familia;Espacio (código);Cantidad;Estado\nMesa;MAM;PB-10;2;bueno\n;XXX;ZZ-99;-1;roto\n';
    const r = await app.post('/api/importar', { csv, simular: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.importados, 0);
    assert.equal(r.body.errores.length, 1);
    assert.equal(r.body.errores[0].fila, 3);
    assert.equal(r.body.errores[0].mensajes.length, 5);
    assert.equal((await app.get('/api/articulos?bajas=incluir')).body.total, antes);
  });

  test('importa filas válidas, por nombre o código, y crea categorías', async () => {
    const csv = [
      'Nombre,Familia profesional,Aula,Categoría,Unidades,Valor unitario,Fecha adquisición',
      'Batidora amasadora,Industrias Alimentarias,Pastelería,Pequeño electrodoméstico,2,"1.250,00",01/03/2024',
      'Colchoneta,AFD,P2-08,,10,,',
    ].join('\n');
    const sim = await app.post('/api/importar', { csv, simular: true });
    assert.equal(sim.body.validas, 2);
    assert.deepEqual(sim.body.categorias_nuevas, ['Pequeño electrodoméstico']);
    assert.equal(sim.body.importados, 0);

    const r = await app.post('/api/importar', { csv }, { usuario: 'Importador' });
    assert.equal(r.body.importados, 2);
    const batidora = (await app.get('/api/articulos?q=batidora')).body.items[0];
    assert.equal(batidora.valor, 1250);
    assert.equal(batidora.cantidad, 2);
    assert.equal(batidora.espacio_codigo, 'PB-01');
    assert.equal(batidora.categoria_nombre, 'Pequeño electrodoméstico');
    assert.equal(batidora.fecha_adquisicion, '2024-03-01');
  });

  test('un CSV exportado se puede volver a importar', async () => {
    const filtro = `familia=${app.familia('INA')}`;
    const csv = await (await app.get(`/api/articulos/exportar.csv?${filtro}`, { crudo: true })).text();
    const antes = (await app.get(`/api/articulos?${filtro}`)).body.total;
    const r = await app.post('/api/importar', { csv });
    assert.equal(r.body.errores.length, 0);
    assert.equal(r.body.importados, antes);
    assert.equal((await app.get(`/api/articulos?${filtro}`)).body.total, antes * 2);
  });

  test('rechaza ficheros sin columnas obligatorias', async () => {
    const r = await app.post('/api/importar', { csv: 'Marca;Modelo\nA;B' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /nombre, familia, espacio/);
  });

  test('plantilla, copia de seguridad y QR', async () => {
    const plantilla = await (await app.get('/api/importar/plantilla.csv', { crudo: true })).text();
    const sim = await app.post('/api/importar', { csv: plantilla, simular: true });
    assert.equal(sim.body.errores.length, 0);

    const copia = await app.get('/api/copia-seguridad', { crudo: true });
    assert.equal(copia.status, 200);
    const bytes = Buffer.from(await copia.arrayBuffer());
    assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');

    const qr = await app.get(`/api/qr.svg?texto=${encodeURIComponent('http://x/#/articulo/1')}`, { crudo: true });
    assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await qr.text(), /^<svg/);
    assert.equal((await app.get('/api/qr.svg')).status, 400);
  });
});

describe('informe PDF de una familia', () => {
  test('agrupa por planta y aula en el orden del plano y ordena por nombre', async () => {
    const f = app.familia('ORI');
    for (const [nombre, espacio] of [['Zeta', 'PB-06'], ['Alfa', 'PB-06'], ['Beta', 'P2-01'], ['Gamma', 'P1-10']]) {
      await app.post('/api/articulos', { nombre, familia_id: f, espacio_id: app.espacio(espacio), valor: 10, cantidad: 2 });
    }
    const baja = (await app.post('/api/articulos', { nombre: 'Rota', familia_id: f, espacio_id: app.espacio('PB-06') })).body;
    await app.post(`/api/articulos/${baja.id}/baja`, { motivo: 'Rota' });

    const { datosInforme } = await import('../src/servicios/informes.js');
    const d = datosInforme(app.db, f);
    assert.deepEqual(d.plantas.map((p) => p.nombre), ['Planta 2ª', 'Planta 1ª', 'Planta baja']);
    assert.deepEqual(d.plantas.at(-1).espacios[0].articulos.map((a) => a.nombre), ['Alfa', 'Zeta']);
    assert.deepEqual(d.totales, { articulos: 4, unidades: 8, valor: 80, espacios: 3, bajas: 0 });

    const conBajas = datosInforme(app.db, f, { bajas: true });
    assert.equal(conBajas.totales.bajas, 1);
    assert.deepEqual(conBajas.plantas.at(-1).espacios[0].articulos.map((a) => a.nombre), ['Alfa', 'Rota', 'Zeta']);
  });

  test('devuelve un PDF descargable', async () => {
    const res = await app.get(`/api/familias/${app.familia('ORI')}/inventario.pdf?valores=1&bajas=1&por=${encodeURIComponent('Ana 🙂')}`, { crudo: true });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /inline; filename="inventario-ORI-\d{4}-\d{2}-\d{2}\.pdf"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 5000);
  });

  test('familia sin material y familia inexistente', async () => {
    const vacia = await app.get(`/api/familias/${app.familia('RAD')}/inventario.pdf`, { crudo: true });
    assert.equal(vacia.status, 200);
    assert.equal((await app.get('/api/familias/9999/inventario.pdf')).status, 404);
  });
});

describe('panel y historial', () => {
  test('estadísticas coherentes con el listado', async () => {
    const est = (await app.get('/api/estadisticas')).body;
    const activos = (await app.get('/api/articulos')).body.total;
    assert.equal(est.totales.articulos, activos);
    assert.equal(est.por_familia.reduce((s, f) => s + f.articulos, 0), activos);
    assert.equal(est.por_planta.reduce((s, p) => s + p.articulos, 0), activos);
    assert.ok(est.recientes.length > 0);
  });

  test('historial filtrable por usuario y paginado', async () => {
    const h = (await app.get(`/api/movimientos?usuario=${encodeURIComponent('maria nunez')}`)).body;
    assert.ok(h.total >= 1);
    assert.ok(h.items.every((m) => m.usuario === 'María Núñez'));
    assert.ok(h.usuarios.includes('Importador'));
    const p = (await app.get('/api/movimientos?por_pagina=3')).body;
    assert.equal(p.items.length, 3);
  });

  test('usuario anónimo si no se indica nombre', async () => {
    const art = (await app.post('/api/articulos', nuevo(), { usuario: '' })).body;
    const m = (await app.get(`/api/articulos/${art.id}`)).body.movimientos[0];
    assert.equal(m.usuario, 'Anónimo');
  });
});

describe('interfaz', () => {
  test('sirve la aplicación con cabeceras de seguridad', async () => {
    const res = await app.get('/', { crudo: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await res.text(), /<title>/);
  });
});
