import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrancar } from './ayuda.js';
import { abrirDb } from '../src/db/index.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

const dentro = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('subsala Ateca-Radio', () => {
  test('existe en la planta baja, es de Radio Atlante y sale en el catálogo', () => {
    const sala = app.meta.espacios.find((e) => e.codigo === 'PB-13');
    assert.ok(sala, 'falta PB-13');
    assert.equal(sala.nombre, 'Ateca-Radio');
    assert.equal(sala.planta_codigo, 'PB');
    assert.equal(sala.tipo, 'taller');
    assert.deepEqual(sala.familia_ids, [app.familia('RAD')]);
  });

  test('está dibujada dentro de ATECA y por encima (se pinta después)', () => {
    const ateca = app.meta.espacios.find((e) => e.nombre === 'ATECA');
    const sala = app.meta.espacios.find((e) => e.codigo === 'PB-13');
    assert.ok(dentro(sala, ateca), 'debe quedar dentro del rectángulo de ATECA');
    // No se pisa con +21, la otra sala interior.
    const mas21 = app.meta.espacios.find((e) => e.nombre === '+21');
    const seSolapan = sala.x < mas21.x + mas21.w && sala.x + sala.w > mas21.x && sala.y < mas21.y + mas21.h && sala.y + sala.h > mas21.y;
    assert.equal(seSolapan, false, 'no debe taparse con +21');
    // El plano pinta los espacios en este orden: la subsala va después, así queda encima.
    const orden = app.meta.espacios.map((e) => e.codigo);
    assert.ok(orden.indexOf('PB-13') > orden.indexOf(ateca.codigo));
  });

  test('se puede inventariar en ella y aparece en el plano, por familia y por QR', async () => {
    const sala = app.espacio('PB-13');
    const r = await app.post('/api/articulos', { nombre: 'Mesa de mezclas', familia_id: app.familia('RAD'), espacio_id: sala, cantidad: 2 });
    assert.equal(r.status, 201);
    assert.equal(r.body.espacio_codigo, 'PB-13');
    assert.equal(r.body.espacio_nombre, 'Ateca-Radio');

    const ocupacion = (await app.get(`/api/plano/ocupacion?familia=${app.familia('RAD')}`)).body;
    assert.equal(ocupacion.find((o) => o.espacio_id === sala).articulos, 1);
    // ATECA no cuenta lo de su subsala: son espacios distintos.
    assert.equal(ocupacion.find((o) => o.espacio_id === app.espacio('PB-07')), undefined);

    const token = (await app.post(`/api/familias/${app.familia('RAD')}/acceso`)).body.token;
    const formulario = (await app.get(`/api/movil/${token}`)).body;
    const enQr = formulario.espacios.find((e) => e.codigo === 'PB-13');
    assert.equal(enQr.habitual, true, 'para Radio Atlante sale entre sus aulas');
    assert.equal(enQr.nombre, 'Ateca-Radio');
    const alta = await app.post(`/api/movil/${token}/articulos`, { persona: 'Eva', nombre: 'Micrófono', espacio_id: sala });
    assert.equal(alta.status, 201);
  });
});

describe('migración: subsala Ateca-Radio', () => {
  test('una base de datos anterior con datos la recibe una sola vez y no pierde nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-sala-'));
    const fichero = join(dir, 'vieja.db');
    try {
      const v3 = abrirDb(fichero, { version: 3 });
      assert.equal(v3.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo = 'PB-13'").get().n, 0);
      assert.equal(v3.prepare('SELECT COUNT(*) AS n FROM espacios').get().n, 36);
      const ahora = new Date().toISOString();
      v3.prepare(`INSERT INTO articulos (codigo, nombre, familia_id, espacio_id, creado_en, actualizado_en, revisado_en)
                  VALUES ('SAN-00001', 'Silla', 1, 1, ?, ?, ?)`).run(ahora, ahora, ahora);
      v3.close();

      const actual = abrirDb(fichero);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM espacios').get().n, 39);
      const sala = actual.prepare("SELECT e.nombre, p.codigo AS planta FROM espacios e JOIN plantas p ON p.id = e.planta_id WHERE e.codigo = 'PB-13'").get();
      assert.deepEqual({ ...sala }, { nombre: 'Ateca-Radio', planta: 'PB' });
      const habitual = actual.prepare(`SELECT f.codigo FROM espacio_familias ef JOIN familias f ON f.id = ef.familia_id
                                       JOIN espacios e ON e.id = ef.espacio_id WHERE e.codigo = 'PB-13'`).all();
      assert.deepEqual(habitual.map((h) => h.codigo), ['RAD']);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM articulos').get().n, 1, 'los datos existentes se conservan');
      assert.equal(actual.prepare('PRAGMA user_version').get().user_version, 5);
      actual.close();

      // Volver a abrir no la duplica.
      const otra = abrirDb(fichero);
      assert.equal(otra.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo = 'PB-13'").get().n, 1);
      otra.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('la migración es idempotente aunque la sala ya existiera', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-sala-'));
    const fichero = join(dir, 'previa.db');
    try {
      const v3 = abrirDb(fichero, { version: 3 });
      const planta = v3.prepare("SELECT id FROM plantas WHERE codigo = 'PB'").get().id;
      // Alguien la hubiera creado a mano con otros datos: no se pisa.
      v3.prepare("INSERT INTO espacios (codigo, nombre, planta_id, tipo, grupos, x, y, w, h) VALUES ('PB-13', 'Sala propia', ?, 'aula', '', 1, 1, 10, 10)").run(planta);
      v3.close();
      const actual = abrirDb(fichero);
      assert.equal(actual.prepare("SELECT nombre FROM espacios WHERE codigo = 'PB-13'").get().nombre, 'Sala propia');
      assert.equal(actual.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo = 'PB-13'").get().n, 1);
      actual.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
