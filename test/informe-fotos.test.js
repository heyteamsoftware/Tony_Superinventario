import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import sharp from 'sharp';
import { arrancar } from './ayuda.js';
import { miniaturaParaPdf, rutaFoto, LADO_MINIATURA_PDF } from '../src/servicios/fotos.js';
import { datosInforme } from '../src/servicios/informes.js';

let app;
before(async () => { app = await arrancar(); });
after(() => app.cerrar());

// Imágenes distintas y con textura (no un color plano), como una foto.
const foto = (color) => sharp({ create: { width: 640, height: 480, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
  .tint(color).jpeg({ quality: 85 }).toBuffer();

const subirFoto = async (color) => (await app.subir('/api/fotos', await foto(color))).body;
const pdf = async (familiaId, query = '') => {
  const res = await app.get(`/api/familias/${familiaId}/inventario.pdf${query}`, { crudo: true });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
};
// Cada imagen incrustada es un objeto "/Subtype /Image" (el logo del centro cuenta).
const imagenes = (bytes) => (bytes.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;

describe('informe PDF con mini fotos', () => {
  let HOT;
  let fotoA;
  let fotoB;
  before(async () => {
    HOT = app.familia('HOT');
    fotoA = await subirFoto('#d9480f');
    fotoB = await subirFoto('#1971c2');
    const base = { familia_id: HOT, espacio_id: app.espacio('PB-02') };
    const a = (await app.post('/api/articulos', { ...base, nombre: 'Cafetera', foto_id: fotoA.id, cantidad: 4 })).body;
    await app.post('/api/articulos', { ...base, nombre: 'Batidora', foto_id: fotoB.id });
    await app.post('/api/articulos', { ...base, nombre: 'Mesa sin foto' });
    // Un traslado parcial deja dos artículos con la MISMA foto.
    await app.post(`/api/articulos/${a.id}/traslado`, { espacio_id: app.espacio('PB-04'), cantidad: 1 });
  });

  test('con la opción activada incluye las fotos; cada foto distinta se incrusta una sola vez', async () => {
    const sin = await pdf(HOT);
    const con = await pdf(HOT, '?fotos=1');
    assert.equal(sin.status, 200);
    assert.equal(con.status, 200);
    assert.equal(con.bytes.subarray(0, 5).toString(), '%PDF-');
    // 3 artículos tienen foto, pero solo hay 2 fotos distintas.
    assert.equal(imagenes(con.bytes) - imagenes(sin.bytes), 2);
  });

  test('las mini fotos casi no aumentan el peso del PDF', async () => {
    const sin = await pdf(HOT);
    const con = await pdf(HOT, '?fotos=1');
    const extra = con.bytes.length - sin.bytes.length;
    assert.ok(extra > 0, 'el PDF con fotos debe pesar algo más');
    assert.ok(extra < 2 * 25 * 1024, `cada foto debe añadir pocos KB (añadió ${Math.round(extra / 1024)} KB en total)`);
  });

  test('sin la opción, el PDF no lleva fotos aunque los artículos las tengan', async () => {
    const sin = await pdf(HOT, '?fotos=0');
    const porDefecto = await pdf(HOT);
    assert.equal(imagenes(sin.bytes), imagenes(porDefecto.bytes));
    const con = await pdf(HOT, '?fotos=1');
    assert.ok(imagenes(con.bytes) > imagenes(sin.bytes));
  });

  test('una familia sin ninguna foto sale igual con la opción activada (sin columna vacía)', async () => {
    const COM = app.familia('COM');
    await app.post('/api/articulos', { nombre: 'TPV', familia_id: COM, espacio_id: app.espacio('P1-10') });
    const sin = await pdf(COM);
    const con = await pdf(COM, '?fotos=1');
    assert.equal(imagenes(con.bytes), imagenes(sin.bytes));
    assert.equal(con.bytes.length, sin.bytes.length, 'ni una columna ni un byte más');
  });

  test('si falta el fichero de una foto, el informe sale igual con las demás', async () => {
    // Foto nueva (nunca usada en un PDF, así que no está en la caché) cuyo fichero desaparece.
    const perdida = await subirFoto('#862e9c');
    await app.post('/api/articulos', { nombre: 'Horno', familia_id: HOT, espacio_id: app.espacio('PB-02'), foto_id: perdida.id });
    rmSync(rutaFoto(app.dirFotos, perdida.id, true), { force: true });

    const sinFotos = await pdf(HOT);
    const con = await pdf(HOT, '?fotos=1');
    assert.equal(con.status, 200, 'una foto que falta no debe romper el informe');
    // Salen las fotos A y B (las que existen); la perdida simplemente no aparece.
    assert.equal(imagenes(con.bytes) - imagenes(sinFotos.bytes), 2);
  });

  test('la miniatura guardada en memoria sigue valiendo aunque el fichero ya no exista', async () => {
    const sinFotos = await pdf(HOT);
    rmSync(rutaFoto(app.dirFotos, fotoA.id, true), { force: true });
    const con = await pdf(HOT, '?fotos=1');
    assert.equal(con.status, 200);
    assert.equal(imagenes(con.bytes) - imagenes(sinFotos.bytes), 2, 'A y B siguen en la memoria');
  });

  test('combina bien con valores y bajas', async () => {
    const r = await pdf(HOT, '?fotos=1&valores=1&bajas=1&por=Ana');
    assert.equal(r.status, 200);
    assert.equal(r.bytes.subarray(0, 5).toString(), '%PDF-');
  });

  test('los datos del informe traen el identificador de la foto de cada artículo', () => {
    const d = datosInforme(app.db, HOT);
    const articulos = d.plantas.flatMap((p) => p.espacios.flatMap((e) => e.articulos));
    // Cafetera (x2 por el traslado parcial), Batidora y Horno; la mesa no tiene foto.
    assert.equal(articulos.filter((a) => a.foto_id).length, 4);
  });
});

describe('miniatura para el PDF', () => {
  test('es un JPEG cuadrado pequeño y se guarda en memoria', async () => {
    const f = await subirFoto('#2f9e44');
    const a = await miniaturaParaPdf(app.dirFotos, f.id);
    const meta = await sharp(a).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.deepEqual([meta.width, meta.height], [LADO_MINIATURA_PDF, LADO_MINIATURA_PDF]);
    assert.ok(a.length < 12 * 1024, `debe pesar pocos KB (${a.length} bytes)`);
    assert.equal(await miniaturaParaPdf(app.dirFotos, f.id), a, 'la segunda vez sale de la memoria');
  });

  test('una foto con otra proporción se recorta al cuadrado sin deformarse', async () => {
    const alta = await sharp({ create: { width: 200, height: 600, channels: 3, background: '#e03131' } }).jpeg().toBuffer();
    const f = (await app.subir('/api/fotos', alta)).body;
    const meta = await sharp(await miniaturaParaPdf(app.dirFotos, f.id)).metadata();
    assert.deepEqual([meta.width, meta.height], [LADO_MINIATURA_PDF, LADO_MINIATURA_PDF]);
  });

  test('devuelve null (sin romper) con ids no válidos, fotos inexistentes o sin carpeta', async () => {
    assert.equal(await miniaturaParaPdf(app.dirFotos, 'no-es-un-id'), null);
    assert.equal(await miniaturaParaPdf(app.dirFotos, '../../etc/passwd'), null);
    assert.equal(await miniaturaParaPdf(app.dirFotos, 'a'.repeat(32)), null);
    assert.equal(await miniaturaParaPdf(null, 'a'.repeat(32)), null);
  });
});
