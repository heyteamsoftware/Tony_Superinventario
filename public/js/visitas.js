import { api } from './api.js';

// Contador de visitantes únicos. Cada navegador genera UNA vez un identificador
// aleatorio y anónimo (no es una cookie de seguimiento: no se envía a nadie
// más ni identifica a la persona) y lo guarda aquí mismo. El servidor cuenta
// identificadores distintos. La aplicación y la página del QR de inventario
// móvil están en el mismo sitio, así que comparten identificador y quien entra
// por los dos lados cuenta una sola vez.

const CLAVE = 'superinventario.visitante';
const VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

function generarId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// null si el navegador no deja guardar datos (no se puede contar sin inflar la cifra).
export function idVisitante() {
  try {
    let id = localStorage.getItem(CLAVE);
    if (!VALIDO.test(id ?? '')) {
      id = generarId();
      localStorage.setItem(CLAVE, id);
    }
    return id;
  } catch {
    return null;
  }
}

export const consultarVisitas = () => api.get('/visitas');

// Anota esta visita y devuelve el contador actualizado. Si no se puede anotar
// (almacenamiento bloqueado o tope alcanzado), devuelve al menos el contador.
export async function registrarVisita() {
  const id = idVisitante();
  if (!id) return consultarVisitas();
  try {
    return await api.post('/visitas', { id });
  } catch {
    return consultarVisitas();
  }
}
