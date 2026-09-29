import { recargarMeta } from './estado.js';

// Tras cualquier modificación se recarga el catálogo y se avisa a la vista
// activa para que refresque lo que muestra.
export async function notificarCambio() {
  await recargarMeta();
  document.dispatchEvent(new CustomEvent('inventario-cambiado'));
}

export function alCambiarInventario(fn) {
  document.addEventListener('inventario-cambiado', fn);
  return () => document.removeEventListener('inventario-cambiado', fn);
}
