import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrancar } from './ayuda.js';
import { abrirDb } from '../src/db/index.js';
import { limites, registrarVisita } from '../src/servicios/visitas.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

const nuevoId = () => randomBytes(16).toString('base64url'); // 22 caracteres, como el que genera el navegador
const visitar = (id) => app.post('/api/visitas', { id });
const contador = async () => (await app.get('/api/visitas')).body;

describe('contador de visitantes únicos', () => {
  test('empieza en cero', async () => {
    assert.deepEqual(await contador(), { unicos: 0, hoy: 0, por_app: 0, por_qr: 0 });
  });

  test('cada navegador cuenta una sola vez, entre cuantas veces entre', async () => {
    const ana = nuevoId();
    const primera = await visitar(ana);
    assert.equal(primera.status, 200);
    assert.deepEqual(primera.body, { unicos: 1, hoy: 1, por_app: 1, por_qr: 0 });
    for (let i = 0; i < 4; i++) assert.equal((await visitar(ana)).body.unicos, 1);

    assert.equal((await visitar(nuevoId())).body.unicos, 2);
    assert.deepEqual(await contador(), { unicos: 2, hoy: 2, por_app: 2, por_qr: 0 });
  });

  test('se anota cuántas veces entra cada uno', () => {
    const filas = app.db.prepare('SELECT visitas FROM visitantes ORDER BY visitas DESC').all();
    assert.deepEqual(filas.map((f) => f.visitas), [5, 1]);
  });
});

describe('privacidad: no se guarda nada personal', () => {
  test('solo se guarda la huella irreversible del identificador, no el identificador ni la IP', async () => {
    const id = nuevoId();
    await visitar(id);
    const columnas = app.db.prepare('PRAGMA table_info(visitantes)').all().map((c) => c.name);
    assert.deepEqual(columnas, ['id', 'primera', 'ultima', 'visitas', 'app', 'qr'], 'ni IP ni navegador ni nombre');

    const esperada = createHash('sha256').update(id).digest('hex');
    assert.ok(app.db.prepare('SELECT 1 FROM visitantes WHERE id = ?').get(esperada), 'se guarda su huella SHA-256');
    assert.equal(app.db.prepare('SELECT 1 FROM visitantes WHERE id = ?').get(id), undefined, 'el identificador en claro no aparece');
    const volcado = JSON.stringify(app.db.prepare('SELECT * FROM visitantes').all());
    assert.ok(!volcado.includes(id));
    assert.ok(!volcado.includes('127.0.0.1'));
  });
});

describe('identificadores no válidos', () => {
  test('se rechazan y no cuentan', async () => {
    const antes = await contador();
    for (const id of [undefined, null, '', 'corto', 'x'.repeat(65), 'con espacios y símbolos!!', '../../etc/passwd', 12345678901234567890, ['a'.repeat(20)], { id: 'a'.repeat(20) }]) {
      const r = await visitar(id);
      assert.equal(r.status, 400, JSON.stringify(id));
    }
    assert.equal((await app.post('/api/visitas', {})).status, 400);
    assert.deepEqual(await contador(), antes);
  });

  test('el origen solo puede ser app o qr', () => {
    assert.throws(() => registrarVisita(app.db, nuevoId(), 'otro'), (e) => e.status === 400);
    assert.throws(() => registrarVisita(app.db, nuevoId(), undefined), (e) => e.status === 400);
  });
});

describe('visitas desde el QR de inventario móvil', () => {
  let token;
  before(async () => {
    token = (await app.post(`/api/familias/${app.familia('SAN')}/acceso`)).body.token;
  });
  const visitarQr = (id, t = token) => app.post(`/api/movil/${t}/visita`, { id });

  test('cuentan en el mismo contador y se distinguen como entradas por QR', async () => {
    const antes = await contador();
    const r = await app.post(`/api/movil/${token}/visita`, { id: nuevoId() });
    assert.equal(r.status, 204);
    const despues = await contador();
    assert.equal(despues.unicos, antes.unicos + 1);
    assert.equal(despues.por_qr, antes.por_qr + 1);
    assert.equal(despues.por_app, antes.por_app);
  });

  test('quien entra por la app y por el QR cuenta una sola vez', async () => {
    const id = nuevoId();
    const antes = await contador();
    await visitar(id);
    assert.equal((await visitarQr(id)).status, 204);
    const despues = await contador();
    assert.equal(despues.unicos, antes.unicos + 1, 'una persona, un recuento');
    assert.equal(despues.por_app, antes.por_app + 1);
    assert.equal(despues.por_qr, antes.por_qr + 1);
    const fila = app.db.prepare('SELECT app, qr, visitas FROM visitantes WHERE id = ?').get(createHash('sha256').update(id).digest('hex'));
    assert.deepEqual({ ...fila }, { app: 1, qr: 1, visitas: 2 });
  });

  test('con un token no válido o un identificador no válido no cuenta nada', async () => {
    const antes = await contador();
    assert.equal((await visitarQr(nuevoId(), 'z'.repeat(24))).status, 404);
    assert.equal((await visitarQr('mal', token)).status, 400);
    assert.deepEqual(await contador(), antes);
  });
});

describe('«hoy»', () => {
  test('cuenta a los que han entrado hoy, pero los antiguos siguen en el total', async () => {
    const antes = await contador();
    app.db.prepare("UPDATE visitantes SET ultima = '2020-01-01T10:00:00.000Z' WHERE id = (SELECT id FROM visitantes ORDER BY primera LIMIT 1)").run();
    const despues = await contador();
    assert.equal(despues.unicos, antes.unicos);
    assert.equal(despues.hoy, antes.hoy - 1);
  });
});

describe('tope contra identificadores inventados', () => {
  test('un visitante nuevo por encima del tope recibe 429; los que ya existen no se ven afectados', async () => {
    const conocido = nuevoId();
    await visitar(conocido);
    const original = limites.nuevos.intentar;
    let consultas = 0;
    limites.nuevos.intentar = () => { consultas++; return false; };
    try {
      const antes = await contador();
      const rechazado = await visitar(nuevoId());
      assert.equal(rechazado.status, 429);
      assert.match(rechazado.body.error, /Demasiadas visitas nuevas/);
      assert.deepEqual(await contador(), antes, 'el rechazado no cuenta');
      assert.equal((await visitar(conocido)).status, 200, 'un visitante conocido sigue entrando');
      assert.equal(consultas, 1, 'el conocido no gasta cupo');
    } finally {
      limites.nuevos.intentar = original;
    }
  });

  test('el cupo se cuenta por IP', () => {
    const claves = [];
    const original = limites.nuevos.intentar;
    limites.nuevos.intentar = (c) => { claves.push(c); return true; };
    try {
      registrarVisita(app.db, nuevoId(), 'app', '10.0.0.1');
      registrarVisita(app.db, nuevoId(), 'app', '10.0.0.2');
      assert.deepEqual(claves, ['10.0.0.1', '10.0.0.2']);
    } finally {
      limites.nuevos.intentar = original;
    }
  });
});

describe('migración: visitantes', () => {
  test('una base anterior con datos recibe la tabla vacía y no pierde nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-visitas-'));
    const fichero = join(dir, 'vieja.db');
    try {
      const v5 = abrirDb(fichero, { version: 5 });
      assert.equal(v5.prepare("SELECT 1 FROM sqlite_master WHERE name = 'visitantes'").get(), undefined);
      const ahora = new Date().toISOString();
      v5.prepare(`INSERT INTO articulos (codigo, nombre, familia_id, espacio_id, creado_en, actualizado_en, revisado_en)
                  VALUES ('SAN-00001', 'Silla', 1, 1, ?, ?, ?)`).run(ahora, ahora, ahora);
      v5.close();

      const actual = abrirDb(fichero);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM visitantes').get().n, 0);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM articulos').get().n, 1);
      assert.equal(actual.prepare('PRAGMA user_version').get().user_version, 6);
      actual.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
