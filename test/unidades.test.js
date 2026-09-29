import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearCsv, generarCsv } from '../src/lib/csv.js';
import { parsearDecimal, parsearFecha } from '../src/lib/validar.js';
import { normalizar } from '../src/lib/texto.js';
import { calcularEstado } from '../src/servicios/revisiones.js';
import { ESPACIOS, FAMILIAS, PLANTAS } from '../src/db/semilla.js';

test('CSV: comillas, separadores y saltos de línea dentro de celdas', () => {
  const filas = parsearCsv('a;b;c\r\n"x;1";"dice ""hola""";"línea1\nlínea2"\r\n\r\n');
  assert.deepEqual(filas, [['a', 'b', 'c'], ['x;1', 'dice "hola"', 'línea1\nlínea2']]);
});

test('CSV: detecta coma como separador y quita el BOM', () => {
  assert.deepEqual(parsearCsv('﻿nombre,cantidad\nSilla,3'), [['nombre', 'cantidad'], ['Silla', '3']]);
});

test('CSV: generar y volver a leer da los mismos datos', () => {
  const datos = [['Mesa; grande', 'con "comillas"', 'dos\nlíneas', '12,5']];
  const [, fila] = parsearCsv(generarCsv(['a', 'b', 'c', 'd'], datos));
  assert.deepEqual(fila, datos[0]);
});

test('CSV: neutraliza fórmulas pero no números negativos', () => {
  const csv = generarCsv(['x', 'y'], [['=HYPERLINK("malo")', '-5']]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /;-5\r\n/);
});

test('decimales en formato español e inglés', () => {
  assert.equal(parsearDecimal('12,5'), 12.5);
  assert.equal(parsearDecimal('1.234,50 €'), 1234.5);
  assert.equal(parsearDecimal('1,234.50'), 1234.5);
  assert.equal(parsearDecimal('12.5'), 12.5);
  assert.ok(Number.isNaN(parsearDecimal('doce')));
});

test('fechas ISO y DD/MM/AAAA, rechazando fechas imposibles', () => {
  assert.equal(parsearFecha('2025-09-15'), '2025-09-15');
  assert.equal(parsearFecha('15/09/2025'), '2025-09-15');
  assert.equal(parsearFecha('5-1-2024'), '2024-01-05');
  assert.equal(parsearFecha('31/02/2025'), null);
  assert.equal(parsearFecha('2025/13/01'), null);
});

test('normalizar quita tildes y mayúsculas', () => {
  assert.equal(normalizar('  Cámara ÑANDÚ '), 'camara nandu');
});

test('estado de revisión según los días transcurridos', () => {
  const ajustes = { dias_aviso_revision: 365, dias_preaviso_revision: 30 };
  const hoy = Date.parse('2026-09-29T12:00:00Z');
  const hace = (d) => new Date(hoy - d * 86_400_000).toISOString();
  assert.equal(calcularEstado(null, ajustes, hoy).estado, 'nunca');
  assert.equal(calcularEstado(hace(10), ajustes, hoy).estado, 'al_dia');
  assert.equal(calcularEstado(hace(340), ajustes, hoy).estado, 'pronto');
  assert.equal(calcularEstado(hace(365), ajustes, hoy).estado, 'vencida');
  assert.equal(calcularEstado(hace(400), ajustes, hoy).dias, 400);
});

test('el plano semilla es coherente', () => {
  const plantas = new Set(PLANTAS.map((p) => p.codigo));
  const familias = new Set(FAMILIAS.map((f) => f.codigo));
  const codigos = new Set();
  assert.equal(FAMILIAS.length, 12);
  for (const e of ESPACIOS) {
    assert.ok(plantas.has(e.planta), `${e.codigo}: planta desconocida`);
    assert.ok(e.codigo.startsWith(e.planta), `${e.codigo}: código no coincide con la planta`);
    assert.ok(!codigos.has(e.codigo), `${e.codigo} repetido`);
    codigos.add(e.codigo);
    assert.ok(e.w > 0 && e.h > 0 && e.x >= 0 && e.y >= 0, `${e.codigo}: geometría no válida`);
    for (const f of e.familias) assert.ok(familias.has(f), `${e.codigo}: familia ${f} desconocida`);
  }
});
