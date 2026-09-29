import { api } from './api.js';

// Catálogo compartido por todas las vistas (plantas, familias, espacios,
// categorías...). Se recarga tras cualquier cambio que afecte a contadores.
export const meta = {
  plantas: [], familias: [], espacios: [], categorias: [], estados: [], tipos_espacio: {}, ajustes: {},
};

const oyentes = new Set();

export async function recargarMeta() {
  Object.assign(meta, await api.get('/meta'));
  for (const fn of oyentes) fn(meta);
  return meta;
}

export const alCambiarMeta = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };

export const familia = (id) => meta.familias.find((f) => f.id === Number(id));
export const espacio = (id) => meta.espacios.find((e) => e.id === Number(id));
export const planta = (id) => meta.plantas.find((p) => p.id === Number(id));
export const plantaPorCodigo = (c) => meta.plantas.find((p) => p.codigo === c);
export const espaciosDePlanta = (id) => meta.espacios.filter((e) => e.planta_id === Number(id));

// Nombre corto y legible de una planta para los botones del ascensor.
export const numeroPlanta = (p) => ({ P2: '2', P1: '1', PB: 'B' })[p.codigo] ?? p.codigo;
