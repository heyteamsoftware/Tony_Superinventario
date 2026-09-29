// CSV compatible con Excel en español: separador ";" y BOM UTF-8.

const BOM = '﻿';

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  let s = String(valor);
  // Evita que Excel interprete el texto como fórmula (inyección CSV).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function generarCsv(cabeceras, filas) {
  const lineas = [cabeceras.map(celda).join(';')];
  for (const fila of filas) lineas.push(fila.map(celda).join(';'));
  return BOM + lineas.join('\r\n') + '\r\n';
}

// Detecta el separador (; , o tabulador) mirando la primera línea.
function detectarSeparador(texto) {
  const primera = texto.split(/\r?\n/, 1)[0];
  const cuenta = (c) => primera.split(c).length - 1;
  const candidatos = [';', ',', '\t'].map((c) => [c, cuenta(c)]).sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ';';
}

// Parser RFC 4180 con comillas, comillas escapadas y saltos de línea en celdas.
export function parsearCsv(texto) {
  if (texto.startsWith(BOM)) texto = texto.slice(1);
  const sep = detectarSeparador(texto);
  const filas = [];
  let fila = [];
  let actual = '';
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { actual += '"'; i++; }
        else enComillas = false;
      } else actual += c;
    } else if (c === '"' && actual === '') {
      enComillas = true;
    } else if (c === sep) {
      fila.push(actual); actual = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(actual); actual = '';
      filas.push(fila); fila = [];
    } else actual += c;
  }
  if (actual !== '' || fila.length) { fila.push(actual); filas.push(fila); }
  // Descarta líneas totalmente vacías.
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}
