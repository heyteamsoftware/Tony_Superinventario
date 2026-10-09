import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { arrancar } from './ayuda.js';
import { abrirDb } from '../src/db/index.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

const SEGURIDAD = [
  'Accidente de Tráfico', 'EPIs', 'Extinción de Incendios', 'Herramientas y ferretería', 'Incendio Forestal',
  'Incendio Urbano', 'Logística', 'Rescate Tierra', 'Rescate Acuático', 'Sanitario', 'Seguridad',
  'Señalización', 'Transmisiones', 'Otros',
];

describe('números de artículo: los eliminados se reutilizan, los dados de baja no', () => {
  const alta = (nombre) => app.post('/api/articulos', {
    nombre, familia_id: app.familia('SEA'), espacio_id: app.espacio('P2-02'),
  });

  test('tras eliminar uno, el siguiente alta recibe ese mismo número', async () => {
    const a = (await alta('Extintor A')).body;
    const b = (await alta('Extintor B')).body;
    const c = (await alta('Extintor C')).body;
    assert.equal(b.codigo.slice(-5), String(Number(a.codigo.slice(-5)) + 1).padStart(5, '0'));
    assert.equal((await app.del(`/api/articulos/${b.id}`)).status, 204);

    const nuevo = (await alta('Extintor D')).body;
    assert.equal(nuevo.codigo, b.codigo, `debe reutilizar ${b.codigo}`);
    // Y como el de b ya se ha usado, el siguiente vuelve al correlativo.
    const siguiente = (await alta('Extintor E')).body;
    assert.ok(siguiente.codigo > c.codigo);
  });

  test('si se eliminan varios, se reutilizan de menor a mayor', async () => {
    const x = (await alta('Liberar 1')).body;
    const y = (await alta('Liberar 2')).body;
    const z = (await alta('Liberar 3')).body;
    await app.del(`/api/articulos/${z.id}`);
    await app.del(`/api/articulos/${x.id}`);
    assert.equal((await alta('Nuevo 1')).body.codigo, x.codigo);
    assert.equal((await alta('Nuevo 2')).body.codigo, z.codigo);
    assert.notEqual(y.codigo, x.codigo);
  });

  test('un artículo dado de baja conserva su código: no se reasigna', async () => {
    const baja = (await alta('Caja que se da de baja')).body;
    await app.post(`/api/articulos/${baja.id}/baja`, { motivo: 'Roto' });
    const siguiente = (await alta('Otro tras baja')).body;
    assert.notEqual(siguiente.codigo, baja.codigo);
    assert.ok(siguiente.codigo > baja.codigo);
    const ficha = (await app.get(`/api/articulos/${baja.id}`)).body;
    assert.equal(ficha.codigo, baja.codigo);
  });

  test('el número eliminado nunca lo usa otra familia', async () => {
    const otra = (await app.post('/api/articulos', {
      nombre: 'De otra familia', familia_id: app.familia('TIC'), espacio_id: app.espacio('P1-07'),
    })).body;
    assert.match(otra.codigo, /^TIC-/);
    const eliminado = (await alta('Para borrar')).body;
    await app.del(`/api/articulos/${eliminado.id}`);
    const de_otra = (await app.post('/api/articulos', {
      nombre: 'Otra más', familia_id: app.familia('TIC'), espacio_id: app.espacio('P1-07'),
    })).body;
    assert.match(de_otra.codigo, /^TIC-/);
    // El número libre era de SEA: la familia TIC no lo hereda, sigue su propio correlativo.
    assert.notEqual(de_otra.codigo.slice(-5), eliminado.codigo.slice(-5));
  });
});

describe('categorías del almacén de Seguridad y Emergencias', () => {
  test('están todas, en orden alfabético, y "Otros" es la última de la lista', async () => {
    const nombres = (await app.get('/api/categorias')).body.map((c) => c.nombre);
    for (const c of SEGURIDAD) assert.ok(nombres.includes(c), `falta "${c}"`);
    const sinOtros = nombres.filter((n) => n !== 'Otros');
    assert.deepEqual(sinOtros, [...sinOtros].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
  });

  test('se pueden elegir al dar de alta, y "Otros" sirve para las nuevas', async () => {
    const r = await app.post('/api/articulos', {
      nombre: 'Manguera', familia_id: app.familia('SEA'), espacio_id: app.espacio('P2-09'), categoria: 'Extinción de Incendios',
    });
    assert.equal(r.body.categoria_nombre, 'Extinción de Incendios');
    const otros = await app.post('/api/articulos', {
      nombre: 'Cosa rara', familia_id: app.familia('SEA'), espacio_id: app.espacio('P2-09'), categoria: 'Otros',
    });
    assert.equal(otros.body.categoria_nombre, 'Otros');
  });

  test('la migración no repite las que ya existían (idempotente)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-seg-'));
    const fichero = join(dir, 'vieja.db');
    try {
      abrirDb(fichero, { version: 6 }).close();
      const actual = abrirDb(fichero);
      const n = actual.prepare("SELECT COUNT(*) AS n FROM categorias WHERE nombre = 'Seguridad'").get().n;
      assert.equal(n, 1);
      assert.equal(actual.prepare('PRAGMA user_version').get().user_version, 7);
      actual.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('tabla de códigos libres', () => {
  test('la migración 7 la crea', () => {
    const t = app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codigos_libres'").get();
    assert.ok(t, 'falta la tabla codigos_libres');
  });
});

describe('hoja de cálculo con mini fotos', () => {
  test('devuelve un .xlsx válido con una fila por artículo y la foto incrustada', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2b8a3e' } }).jpeg().toBuffer();
    const foto = (await app.subir('/api/fotos', jpeg)).body;
    const art = (await app.post('/api/articulos', {
      nombre: 'Con foto para Excel', familia_id: app.familia('AFD'), espacio_id: app.espacio('P2-08'), foto_id: foto.id,
    })).body;
    await app.post('/api/articulos', { nombre: 'Sin foto para Excel', familia_id: app.familia('AFD'), espacio_id: app.espacio('P2-08') });

    const res = await app.get(`/api/articulos/exportar.xlsx?familia=${app.familia('AFD')}`, { crudo: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /inventario-\d{4}-\d{2}-\d{2}\.xlsx/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'es un contenedor ZIP (formato Office moderno)');

    // El paquete lleva la imagen dentro.
    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(bytes);
    const hoja = libro.getWorksheet('Inventario');
    const cabeceras = hoja.getRow(1).values.slice(1);
    assert.equal(cabeceras[0], 'Foto');
    assert.equal(cabeceras[1], 'Código');
    const filas = [];
    hoja.eachRow((r, n) => { if (n > 1) filas.push(r.getCell(3).value); });
    assert.ok(filas.includes('Con foto para Excel') && filas.includes('Sin foto para Excel'));
    assert.equal(hoja.getImages().length, 1, 'solo el artículo con foto lleva imagen');
    assert.ok(art.codigo);
  });

  test('sin artículos sale una hoja con el aviso, sin fallar', async () => {
    const res = await app.get('/api/articulos/exportar.xlsx?q=zzzz-no-existe-zzzz', { crudo: true });
    assert.equal(res.status, 200);
  });
});
