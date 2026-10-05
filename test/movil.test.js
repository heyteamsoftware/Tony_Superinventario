import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrancar } from './ayuda.js';
import { abrirDb } from '../src/db/index.js';
import { crearLimitador } from '../src/lib/limitador.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

describe('categorías sin lista fija', () => {
  test('una base de datos nueva no trae categorías predefinidas', () => {
    assert.deepEqual(app.meta.categorias, []);
  });

  test('se crean al escribirlas y se reutilizan sin distinguir tildes ni mayúsculas', async () => {
    const base = { familia_id: app.familia('SAN'), espacio_id: app.espacio('P1-03') };
    const a = (await app.post('/api/articulos', { ...base, nombre: 'Camilla', categoria: 'Material sanitario' })).body;
    assert.equal(a.categoria_nombre, 'Material sanitario');
    const b = (await app.post('/api/articulos', { ...base, nombre: 'Guantes', categoria: '  material SANITARIO ' })).body;
    assert.equal(b.categoria_id, a.categoria_id, 'debe reutilizar la categoría existente');
    const c = (await app.post('/api/articulos', { ...base, nombre: 'Venda', categoria: 'Fungibles' })).body;
    assert.notEqual(c.categoria_id, a.categoria_id);

    const lista = (await app.get('/api/categorias')).body;
    assert.deepEqual(lista.map((x) => x.nombre).sort(), ['Fungibles', 'Material sanitario']);
    assert.equal(lista.find((x) => x.nombre === 'Material sanitario').articulos, 2);
  });

  test('quedan guardadas aunque se borre el artículo que las creó', async () => {
    const base = { familia_id: app.familia('SAN'), espacio_id: app.espacio('P1-03') };
    const art = (await app.post('/api/articulos', { ...base, nombre: 'Temporal', categoria: 'Permanente' })).body;
    await app.del(`/api/articulos/${art.id}`);
    assert.ok((await app.get('/api/categorias')).body.some((c) => c.nombre === 'Permanente'));
  });

  test('al editar, una categoría vacía la quita y otro nombre la cambia', async () => {
    const base = { familia_id: app.familia('IMA'), espacio_id: app.espacio('P1-01') };
    const art = (await app.post('/api/articulos', { ...base, nombre: 'Polímetro', categoria: 'Medida' })).body;
    const cambiada = (await app.patch(`/api/articulos/${art.id}`, { categoria: 'Herramientas de medida' })).body;
    assert.equal(cambiada.categoria_nombre, 'Herramientas de medida');
    const quitada = (await app.patch(`/api/articulos/${art.id}`, { categoria: '' })).body;
    assert.equal(quitada.categoria_id, null);
    const historial = (await app.get(`/api/articulos/${art.id}`)).body.movimientos.filter((m) => m.tipo === 'edicion');
    assert.equal(historial.length, 2);
    // Sin tocar la categoría en la edición, se conserva.
    const otra = (await app.patch(`/api/articulos/${art.id}`, { categoria: 'Medida' })).body;
    assert.equal((await app.patch(`/api/articulos/${art.id}`, { nombre: 'Polímetro 2' })).body.categoria_id, otra.categoria_id);
  });

  test('un alta con categoria_id (importación) no se pisa con la categoría vacía', async () => {
    const id = (await app.post('/api/categorias', { nombre: 'Por id' })).body.id;
    const art = (await app.post('/api/articulos', { nombre: 'X', familia_id: app.familia('SAN'), espacio_id: app.espacio('P1-03'), categoria_id: id })).body;
    assert.equal(art.categoria_id, id);
  });
});

describe('migración: categorías predefinidas', () => {
  test('retira las que nadie usa y conserva las que están en uso', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migracion-'));
    const fichero = join(dir, 'vieja.db');
    try {
      const v1 = abrirDb(fichero, { version: 1 });
      assert.equal(v1.prepare('SELECT COUNT(*) AS n FROM categorias').get().n, 13, 'la versión 1 trae las 13 de la semilla');
      const mobiliario = v1.prepare("SELECT id FROM categorias WHERE nombre = 'Mobiliario'").get().id;
      const ahora = new Date().toISOString();
      v1.prepare(`INSERT INTO articulos (codigo, nombre, familia_id, espacio_id, categoria_id, creado_en, actualizado_en, revisado_en)
                  VALUES ('SAN-00001', 'Silla', 1, 1, ?, ?, ?, ?)`).run(mobiliario, ahora, ahora, ahora);
      v1.close();

      const actual = abrirDb(fichero);
      const quedan = actual.prepare('SELECT nombre FROM categorias').all().map((c) => c.nombre);
      assert.deepEqual(quedan, ['Mobiliario']);
      assert.equal(actual.prepare('SELECT categoria_id FROM articulos').get().categoria_id, mobiliario);
      assert.equal(actual.prepare('PRAGMA user_version').get().user_version, 3);
      actual.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QR de inventario móvil: gestión del token', () => {
  test('sin acceso hasta que se genera, y no aparece en /meta', async () => {
    const f = app.familia('SSC');
    assert.deepEqual((await app.get(`/api/familias/${f}/acceso`)).body, { familia_id: f, activo: false, token: null });
    const creado = await app.post(`/api/familias/${f}/acceso`);
    assert.equal(creado.status, 201);
    assert.equal(creado.body.activo, true);
    assert.match(creado.body.token, /^[A-Za-z0-9_-]{24}$/);

    const meta = (await app.get('/api/meta')).body;
    assert.equal(meta.familias.find((x) => x.id === f).acceso_activo, 1);
    assert.ok(!JSON.stringify(meta).includes(creado.body.token), 'el token no debe filtrarse por /meta');
    assert.equal(meta.familias.find((x) => x.id === app.familia('SAN')).acceso_activo, 0);
  });

  test('generar uno nuevo invalida el anterior y revocar lo desactiva', async () => {
    const f = app.familia('MAM');
    const t1 = (await app.post(`/api/familias/${f}/acceso`)).body.token;
    const t2 = (await app.post(`/api/familias/${f}/acceso`)).body.token;
    assert.notEqual(t1, t2);
    assert.equal((await app.get(`/api/movil/${t1}`)).status, 404);
    assert.equal((await app.get(`/api/movil/${t2}`)).status, 200);

    assert.equal((await app.del(`/api/familias/${f}/acceso`)).status, 204);
    assert.equal((await app.get(`/api/movil/${t2}`)).status, 404);
    assert.equal((await app.get(`/api/familias/${f}/acceso`)).body.activo, false);
  });

  test('cada familia tiene su propio token', async () => {
    const a = (await app.post(`/api/familias/${app.familia('HOT')}/acceso`)).body.token;
    const b = (await app.post(`/api/familias/${app.familia('INA')}/acceso`)).body.token;
    assert.notEqual(a, b);
    assert.equal((await app.get(`/api/movil/${a}`)).body.familia.codigo, 'HOT');
    assert.equal((await app.get(`/api/movil/${b}`)).body.familia.codigo, 'INA');
  });

  test('familia inexistente', async () => {
    assert.equal((await app.get('/api/familias/9999/acceso')).status, 404);
    assert.equal((await app.post('/api/familias/9999/acceso')).status, 404);
    assert.equal((await app.del('/api/familias/9999/acceso')).status, 404);
  });
});

describe('QR de inventario móvil: lo que puede hacer con el token', () => {
  let token;
  let familiaId;
  before(async () => {
    familiaId = app.familia('SAN');
    token = (await app.post(`/api/familias/${familiaId}/acceso`)).body.token;
  });

  test('el formulario trae solo lo necesario: aulas (las de su familia marcadas), categorías y estados', async () => {
    const r = (await app.get(`/api/movil/${token}`)).body;
    assert.deepEqual(r.familia, { codigo: 'SAN', nombre: 'Sanidad', color: r.familia.color });
    assert.equal(r.espacios.length, 36);
    assert.deepEqual(Object.keys(r.espacios[0]).sort(), ['codigo', 'habitual', 'id', 'nombre', 'planta']);
    const habituales = r.espacios.filter((e) => e.habitual).map((e) => e.codigo);
    assert.ok(habituales.includes('P1-04') && !habituales.includes('P1-01'));
    assert.ok(Array.isArray(r.categorias) && r.categorias.every((c) => typeof c === 'string'));
    assert.deepEqual(r.estados, ['nuevo', 'bueno', 'regular', 'averiado']);
    // Nada de otras familias ni de artículos.
    assert.ok(!('familias' in r) && !('articulos' in r));
  });

  test('puede dar de alta material: la familia sale del token y queda registrado como QR', async () => {
    const r = await app.post(`/api/movil/${token}/articulos`, {
      persona: 'Lucía Pérez', nombre: 'Tensiómetro', espacio_id: app.espacio('P1-03'), cantidad: 3, estado: 'nuevo',
      categoria: 'Diagnóstico', ubicacion_detalle: 'Armario 2', marca: 'Omron', numero_serie: 'ABC123',
    });
    assert.equal(r.status, 201);
    assert.match(r.body.codigo, /^SAN-\d{5}$/);
    assert.deepEqual(Object.keys(r.body).sort(), ['cantidad', 'categoria', 'codigo', 'espacio_codigo', 'espacio_nombre', 'id', 'nombre']);

    const ficha = (await app.get(`/api/articulos/${r.body.id}`)).body;
    assert.equal(ficha.familia_id, familiaId);
    assert.equal(ficha.cantidad, 3);
    assert.equal(ficha.categoria_nombre, 'Diagnóstico');
    assert.equal(ficha.creado_por, 'Lucía Pérez (QR)');
    assert.equal(ficha.movimientos[0].usuario, 'Lucía Pérez (QR)');
    assert.equal(ficha.movimientos[0].detalle.via, 'qr');
  });

  test('no puede colarse en otra familia ni rellenar campos que no le corresponden', async () => {
    const r = await app.post(`/api/movil/${token}/articulos`, {
      persona: 'Pablo', nombre: 'Intento', espacio_id: app.espacio('PB-12'), familia_id: app.familia('IMA'),
      valor: 99999, proveedor: 'Hacker', descripcion: 'x', estado: 'baja',
    });
    // 'estado: baja' no es un estado válido en el QR.
    assert.equal(r.status, 400);
    assert.ok(r.body.detalles.estado);

    const ok = await app.post(`/api/movil/${token}/articulos`, {
      persona: 'Pablo', nombre: 'Intento', espacio_id: app.espacio('PB-12'), familia_id: app.familia('IMA'),
      valor: 99999, proveedor: 'Hacker', descripcion: 'x',
    });
    assert.equal(ok.status, 201);
    const ficha = (await app.get(`/api/articulos/${ok.body.id}`)).body;
    assert.equal(ficha.familia_id, familiaId, 'la familia la fija el token');
    assert.equal(ficha.valor, null);
    assert.equal(ficha.proveedor, '');
    assert.equal(ficha.descripcion, '');
  });

  test('valida los datos con mensajes por campo', async () => {
    const r = await app.post(`/api/movil/${token}/articulos`, { persona: ' ', nombre: '', cantidad: 0 });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.body.detalles).sort(), ['cantidad', 'espacio_id', 'nombre', 'persona']);
    // Un aula que no existe se detecta aparte, ya con el formato correcto.
    const aula = await app.post(`/api/movil/${token}/articulos`, { persona: 'A', nombre: 'B', espacio_id: 9999 });
    assert.equal(aula.status, 400);
    assert.equal(aula.body.detalles.espacio_id, 'El espacio no existe');
    assert.equal((await app.post(`/api/movil/${token}/articulos`, { persona: 'A', nombre: 'B', espacio_id: app.espacio('P1-03'), cantidad: 10000 })).status, 400);
    assert.equal((await app.post(`/api/movil/${token}/articulos`, { persona: 'A'.repeat(61), nombre: 'B', espacio_id: app.espacio('P1-03') })).status, 400);
  });

  test('la cantidad por defecto es 1 y el estado por defecto, "bueno"', async () => {
    const r = await app.post(`/api/movil/${token}/articulos`, { persona: 'Ana', nombre: 'Fonendo', espacio_id: app.espacio('P1-03') });
    const ficha = (await app.get(`/api/articulos/${r.body.id}`)).body;
    assert.equal(ficha.cantidad, 1);
    assert.equal(ficha.estado, 'bueno');
  });

  test('con el token no se puede leer, editar, borrar ni listar nada más', async () => {
    const art = (await app.post(`/api/movil/${token}/articulos`, { persona: 'Ana', nombre: 'Prueba', espacio_id: app.espacio('P1-03') })).body;
    for (const [metodo, ruta] of [
      ['GET', `/api/movil/${token}/articulos`],
      ['GET', `/api/movil/${token}/articulos/${art.id}`],
      ['PATCH', `/api/movil/${token}/articulos/${art.id}`],
      ['DELETE', `/api/movil/${token}/articulos/${art.id}`],
      ['POST', `/api/movil/${token}/articulos/${art.id}/baja`],
      ['GET', `/api/movil/${token}/movimientos`],
      ['GET', `/api/movil/${token}/familias`],
    ]) {
      const res = await fetch(app.base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: metodo === 'GET' || metodo === 'DELETE' ? undefined : '{}' });
      assert.ok([404, 405].includes(res.status), `${metodo} ${ruta} → ${res.status}`);
    }
    assert.equal((await app.get(`/api/articulos/${art.id}`)).body.nombre, 'Prueba');
  });

  test('tokens erróneos dan siempre la misma respuesta 404', async () => {
    for (const t of ['corto', 'a'.repeat(24), '../etc/passwd', `${token}x`, 'x'.repeat(100)]) {
      const r = await app.get(`/api/movil/${encodeURIComponent(t)}`);
      assert.equal(r.status, 404, t);
      assert.match(r.body.error, /no es válido/);
    }
    assert.equal((await app.post(`/api/movil/${'z'.repeat(24)}/articulos`, { persona: 'A', nombre: 'B', espacio_id: 1 })).status, 404);
  });

  test('las respuestas no se guardan en caché y las peticiones enormes se rechazan', async () => {
    const res = await app.get(`/api/movil/${token}`, { crudo: true });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const enorme = await fetch(`${app.base}/api/movil/${token}/articulos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: 'A', nombre: 'B', espacio_id: 1, observaciones: 'x'.repeat(100_000) }),
    });
    assert.equal(enorme.status, 413);
  });

  test('las altas por QR cuentan como repaso de la familia y salen en el historial', async () => {
    const hist = (await app.get('/api/movimientos?q=Lucia')).body;
    assert.ok(hist.items.some((m) => m.usuario === 'Lucía Pérez (QR)'));
    const fam = (await app.get('/api/familias')).body.find((f) => f.id === familiaId);
    assert.equal(fam.revision.estado, 'al_dia');
  });
});

describe('página de inventario móvil', () => {
  test('la página móvil se sirve con la política de seguridad y sin indexar', async () => {
    const res = await app.get('/movil/', { crudo: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    assert.match(await res.text(), /viewport/);
  });
});

describe('limitador de altas', () => {
  test('bloquea al superar el máximo en la ventana y se libera después', () => {
    let t = 0;
    const l = crearLimitador({ ventanaMs: 1000, max: 3, ahora: () => t });
    assert.ok(l.intentar('a') && l.intentar('a') && l.intentar('a'));
    assert.equal(l.intentar('a'), false);
    assert.ok(l.intentar('b'), 'otra clave no se ve afectada');
    t = 999;
    assert.equal(l.intentar('a'), false);
    t = 1001;
    assert.ok(l.intentar('a'), 'tras la ventana vuelve a permitir');
    l.limpiar();
    assert.ok(l.tamano <= 2);
  });

  test('el tope de altas por token devuelve 429', async () => {
    const { limites } = await import('../src/servicios/movil.js');
    const token = (await app.post(`/api/familias/${app.familia('COM')}/acceso`)).body.token;
    const original = limites.altas.intentar;
    let n = 0;
    limites.altas.intentar = (clave) => (clave === token ? ++n <= 2 : original(clave));
    try {
      const alta = () => app.post(`/api/movil/${token}/articulos`, { persona: 'Z', nombre: 'Item', espacio_id: app.espacio('PB-06') });
      assert.equal((await alta()).status, 201);
      assert.equal((await alta()).status, 201);
      const r = await alta();
      assert.equal(r.status, 429);
      assert.match(r.body.error, /Espera un momento/);
    } finally {
      limites.altas.intentar = original;
    }
  });
});

describe('compatibilidad con los QR ya repartidos (/alumno/...)', () => {
  let token;
  before(async () => {
    token = (await app.post(`/api/familias/${app.familia('SEA')}/acceso`)).body.token;
  });

  test('la dirección antigua de la API sigue funcionando con el mismo token', async () => {
    const antigua = await app.get(`/api/alumno/${token}`);
    const nueva = await app.get(`/api/movil/${token}`);
    assert.equal(antigua.status, 200);
    assert.deepEqual(antigua.body, nueva.body);
    const alta = await app.post(`/api/alumno/${token}/articulos`, { persona: 'Eva', nombre: 'Extintor', espacio_id: app.espacio('P2-01') });
    assert.equal(alta.status, 201);
    assert.match(alta.body.codigo, /^SEA-/);
    assert.equal((await app.get(`/api/alumno/${'z'.repeat(24)}`)).status, 404);
  });

  test('las páginas ya abiertas que mandan "alumno" en vez de "persona" siguen pudiendo guardar', async () => {
    const r = await app.post(`/api/movil/${token}/articulos`, { alumno: 'Pablo Antiguo', nombre: 'Casco', espacio_id: app.espacio('P2-01') });
    assert.equal(r.status, 201);
    assert.equal((await app.get(`/api/articulos/${r.body.id}`)).body.creado_por, 'Pablo Antiguo (QR)');
    // Y sin ninguno de los dos, se pide la persona.
    const sin = await app.post(`/api/movil/${token}/articulos`, { nombre: 'Casco', espacio_id: app.espacio('P2-01') });
    assert.equal(sin.status, 400);
    assert.ok(sin.body.detalles.persona);
  });

  test('el enlace antiguo de la página redirige a la nueva conservando el código', async () => {
    const conBarra = await fetch(`${app.base}/alumno/?t=${token}`, { redirect: 'manual' });
    assert.equal(conBarra.status, 301);
    assert.equal(conBarra.headers.get('location'), `../movil/?t=${token}`);
    const sinBarra = await fetch(`${app.base}/alumno?t=${token}`, { redirect: 'manual' });
    assert.equal(sinBarra.status, 301);
    assert.equal(sinBarra.headers.get('location'), `./movil/?t=${token}`);
    // Resuelta contra la URL pública (en una subcarpeta) lleva a la página nueva.
    assert.equal(new URL(conBarra.headers.get('location'), 'https://x.es/Tony_Superinventario/alumno/?t=abc').pathname, '/Tony_Superinventario/movil/');
    assert.equal(new URL(sinBarra.headers.get('location'), 'https://x.es/Tony_Superinventario/alumno?t=abc').pathname, '/Tony_Superinventario/movil/');
    // La página nueva existe.
    assert.equal((await fetch(`${app.base}/movil/?t=${token}`)).status, 200);
  });
});
