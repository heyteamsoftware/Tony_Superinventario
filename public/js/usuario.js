// No hay contraseñas: solo se pide el nombre para firmar los cambios en el
// historial. Se recuerda en este navegador.
const CLAVE = 'superinventario.usuario';

export function usuarioActual() {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}

export function guardarUsuario(nombre) {
  try { localStorage.setItem(CLAVE, nombre); } catch { /* navegación privada */ }
}

export function iniciales(nombre) {
  return (nombre || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
