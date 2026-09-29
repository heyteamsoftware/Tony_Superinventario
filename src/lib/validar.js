import { datosNoValidos } from './errores.js';

// Mini validador declarativo. Cada regla recibe el valor crudo y devuelve
// { valor } si es correcto o { error } con un mensaje para el usuario.

const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const reglas = {
  texto({ requerido = false, max = 200 } = {}) {
    return (v) => {
      if (vacio(v)) return requerido ? { error: 'Obligatorio' } : { valor: '' };
      if (typeof v !== 'string' && typeof v !== 'number') return { error: 'Debe ser texto' };
      const s = String(v).trim();
      if (s.length > max) return { error: `Máximo ${max} caracteres` };
      return { valor: s };
    };
  },
  entero({ requerido = false, min = -Infinity, max = Infinity } = {}) {
    return (v) => {
      if (vacio(v)) return requerido ? { error: 'Obligatorio' } : { valor: null };
      const n = typeof v === 'string' ? Number(v.trim()) : v;
      if (typeof n !== 'number' || !Number.isInteger(n)) return { error: 'Debe ser un número entero' };
      if (n < min) return { error: `Mínimo ${min}` };
      if (n > max) return { error: `Máximo ${max}` };
      return { valor: n };
    };
  },
  decimal({ min = -Infinity, max = Infinity } = {}) {
    return (v) => {
      if (vacio(v)) return { valor: null };
      const n = typeof v === 'string' ? parsearDecimal(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'Debe ser un número' };
      if (n < min) return { error: `Mínimo ${min}` };
      if (n > max) return { error: `Máximo ${max}` };
      return { valor: Math.round(n * 100) / 100 };
    };
  },
  fecha() {
    return (v) => {
      if (vacio(v)) return { valor: null };
      const iso = parsearFecha(String(v).trim());
      return iso ? { valor: iso } : { error: 'Fecha no válida (AAAA-MM-DD o DD/MM/AAAA)' };
    };
  },
  enumerado(opciones, { requerido = false } = {}) {
    return (v) => {
      if (vacio(v)) return requerido ? { error: 'Obligatorio' } : { valor: null };
      return opciones.includes(v) ? { valor: v } : { error: `Valor no permitido (${opciones.join(', ')})` };
    };
  },
  color() {
    return (v) => {
      if (vacio(v)) return { error: 'Obligatorio' };
      return /^#[0-9a-f]{6}$/i.test(v) ? { valor: v.toLowerCase() } : { error: 'Color no válido (#rrggbb)' };
    };
  },
  listaIds() {
    return (v) => {
      if (vacio(v)) return { valor: [] };
      if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x) && x > 0)) return { error: 'Lista de identificadores no válida' };
      return { valor: [...new Set(v)] };
    };
  },
};

// Valida `datos` contra `esquema`. Con parcial=true solo se validan las claves
// presentes (para PATCH). Lanza 400 con el detalle por campo.
export function validar(esquema, datos, { parcial = false } = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw datosNoValidos({ _: 'Cuerpo no válido' });
  const salida = {};
  const errores = {};
  for (const [campo, regla] of Object.entries(esquema)) {
    if (parcial && !(campo in datos)) continue;
    const r = regla(datos[campo]);
    if (r.error) errores[campo] = r.error;
    else salida[campo] = r.valor;
  }
  if (Object.keys(errores).length) throw datosNoValidos(errores);
  return salida;
}

// Acepta "12.5", "12,5", "1.234,50" y "1,234.50".
export function parsearDecimal(s) {
  let t = String(s).trim().replace(/\s|€/g, '');
  if (t === '') return NaN;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma > -1) {
    t = t.replace(',', '.');
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// Devuelve AAAA-MM-DD o null. Acepta ISO y el formato español DD/MM/AAAA.
export function parsearFecha(s) {
  let a, m, d;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) [, a, m, d] = r;
  else if ((r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) [, d, m, a] = r;
  else return null;
  const fecha = new Date(Date.UTC(+a, +m - 1, +d));
  if (fecha.getUTCFullYear() !== +a || fecha.getUTCMonth() !== +m - 1 || fecha.getUTCDate() !== +d) return null;
  return fecha.toISOString().slice(0, 10);
}
