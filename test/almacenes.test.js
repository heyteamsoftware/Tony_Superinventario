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

const sala = (codigo) => app.meta.espacios.find((e) => e.codigo === codigo);
const solapan = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('almacenes de la familia de Seguridad', () => {
  test('almacén de Seguridad de Emergencia, en la 2ª planta', () => {
    const e = sala('P2-09');
    assert.ok(e, 'falta P2-09');
    assert.equal(e.nombre, 'Almacén de Seguridad de Emergencia');
    assert.equal(e.planta_codigo, 'P2');
    assert.equal(e.tipo, 'almacen');
    assert.deepEqual(e.familia_ids, [app.familia('SEA')]);
  });

  test('queda al lado del aula de Emergencias 1º-2º / C. Emergencias 1º (pegado, a su misma altura)', () => {
    const almacen = sala('P2-09');
    const aula = sala('P2-07');
    assert.equal(aula.nombre, 'Emergencias 1º-2º / C. Emergencias 1º');
    assert.equal(almacen.x + almacen.w, aula.x, 'su lado derecho toca el lado izquierdo del aula');
    assert.equal(almacen.y, aula.y, 'misma altura de arranque');
    assert.equal(almacen.h, aula.h, 'misma altura');
  });

  test('almacén del campo de maniobras, en el exterior de la planta baja', () => {
    const e = sala('PB-14');
    assert.ok(e, 'falta PB-14');
    assert.equal(e.nombre, 'Almacén Campo de Maniobras');
    assert.equal(e.planta_codigo, 'PB');
    assert.equal(e.tipo, 'almacen');
    assert.match(e.grupos, /Exterior/);
    assert.deepEqual(e.familia_ids, [app.familia('SEA')]);
  });

  test('el almacén exterior está fuera de los edificios: debajo de ATECA y de la Plaza, sin tocar el taller', () => {
    const e = sala('PB-14');
    for (const otra of ['PB-07', 'PB-09', 'PB-12', 'PB-13']) {
      assert.ok(e.y >= sala(otra).y + sala(otra).h || e.x + e.w <= sala(otra).x, `no debe invadir ${otra}`);
    }
  });

  test('ningún espacio se solapa con otro salvo las subsalas dentro de ATECA', () => {
    const permitidos = new Set(['PB-07|PB-08', 'PB-07|PB-13']); // +21 y Ateca-Radio, dibujadas dentro de ATECA
    const porPlanta = Map.groupBy(app.meta.espacios, (e) => e.planta_id);
    const choques = [];
    for (const salas of porPlanta.values()) {
      for (let i = 0; i < salas.length; i++) {
        for (let j = i + 1; j < salas.length; j++) {
          const par = [salas[i].codigo, salas[j].codigo].sort().join('|');
          if (solapan(salas[i], salas[j]) && !permitidos.has(par)) choques.push(par);
        }
      }
    }
    assert.deepEqual(choques, []);
  });

  test('se puede inventariar en ellos, salen en el plano y en el QR de inventario móvil como aulas de la familia', async () => {
    const familia = app.familia('SEA');
    for (const [codigo, nombre] of [['P2-09', 'Botiquín de campaña'], ['PB-14', 'Cono de señalización']]) {
      const r = await app.post('/api/articulos', { nombre, familia_id: familia, espacio_id: app.espacio(codigo), cantidad: 4 });
      assert.equal(r.status, 201);
      assert.equal(r.body.espacio_codigo, codigo);
    }
    const ocupacion = (await app.get(`/api/plano/ocupacion?familia=${familia}`)).body;
    assert.equal(ocupacion.find((o) => o.espacio_id === app.espacio('P2-09')).articulos, 1);
    assert.equal(ocupacion.find((o) => o.espacio_id === app.espacio('PB-14')).articulos, 1);

    const token = (await app.post(`/api/familias/${familia}/acceso`)).body.token;
    const formulario = (await app.get(`/api/movil/${token}`)).body;
    assert.equal(formulario.espacios.find((e) => e.codigo === 'P2-09').habitual, true);
    assert.equal(formulario.espacios.find((e) => e.codigo === 'PB-14').habitual, true);
    const alta = await app.post(`/api/movil/${token}/articulos`, { persona: 'Eva', nombre: 'Chaleco', espacio_id: app.espacio('PB-14') });
    assert.equal(alta.status, 201);
  });
});

describe('migración: almacenes de Seguridad', () => {
  test('una base de datos anterior con datos los recibe una sola vez y no pierde nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-almacenes-'));
    const fichero = join(dir, 'vieja.db');
    try {
      const v4 = abrirDb(fichero, { version: 4 });
      assert.equal(v4.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo IN ('P2-09','PB-14')").get().n, 0);
      assert.equal(v4.prepare('SELECT COUNT(*) AS n FROM espacios').get().n, 37);
      const ahora = new Date().toISOString();
      v4.prepare(`INSERT INTO articulos (codigo, nombre, familia_id, espacio_id, creado_en, actualizado_en, revisado_en)
                  VALUES ('SEA-00001', 'Casco', 2, 1, ?, ?, ?)`).run(ahora, ahora, ahora);
      v4.close();

      const actual = abrirDb(fichero);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM espacios').get().n, 39);
      const filas = actual.prepare(`
        SELECT e.codigo, e.nombre, p.codigo AS planta, e.tipo, GROUP_CONCAT(f.codigo) AS familias
        FROM espacios e JOIN plantas p ON p.id = e.planta_id
        LEFT JOIN espacio_familias ef ON ef.espacio_id = e.id LEFT JOIN familias f ON f.id = ef.familia_id
        WHERE e.codigo IN ('P2-09', 'PB-14') GROUP BY e.id ORDER BY e.codigo`).all().map((f) => ({ ...f }));
      assert.deepEqual(filas, [
        { codigo: 'P2-09', nombre: 'Almacén de Seguridad de Emergencia', planta: 'P2', tipo: 'almacen', familias: 'SEA' },
        { codigo: 'PB-14', nombre: 'Almacén Campo de Maniobras', planta: 'PB', tipo: 'almacen', familias: 'SEA' },
      ]);
      assert.equal(actual.prepare('SELECT COUNT(*) AS n FROM articulos').get().n, 1, 'los datos existentes se conservan');
      assert.equal(actual.prepare('PRAGMA user_version').get().user_version, 6);
      actual.close();

      const otra = abrirDb(fichero);
      assert.equal(otra.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo IN ('P2-09','PB-14')").get().n, 2);
      assert.equal(otra.prepare('SELECT COUNT(*) AS n FROM espacio_familias ef JOIN espacios e ON e.id = ef.espacio_id WHERE e.codigo = ?').get('P2-09').n, 1);
      otra.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('si alguien ya había creado un espacio con ese código, no se pisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-almacenes-'));
    const fichero = join(dir, 'previa.db');
    try {
      const v4 = abrirDb(fichero, { version: 4 });
      const planta = v4.prepare("SELECT id FROM plantas WHERE codigo = 'PB'").get().id;
      v4.prepare("INSERT INTO espacios (codigo, nombre, planta_id, tipo, grupos, x, y, w, h) VALUES ('PB-14', 'Sala propia', ?, 'aula', '', 1, 1, 10, 10)").run(planta);
      v4.close();
      const actual = abrirDb(fichero);
      assert.equal(actual.prepare("SELECT nombre FROM espacios WHERE codigo = 'PB-14'").get().nombre, 'Sala propia');
      assert.equal(actual.prepare("SELECT COUNT(*) AS n FROM espacios WHERE codigo = 'PB-14'").get().n, 1);
      actual.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
