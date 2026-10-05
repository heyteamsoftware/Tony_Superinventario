import { usuarioActual } from './usuario.js';

export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.error ?? `Error ${status}`);
    this.status = status;
    this.detalles = cuerpo?.detalles ?? null;
  }
}

async function pedir(metodo, ruta, cuerpo) {
  const res = await fetch(`api${ruta}`, {
    method: metodo,
    headers: {
      'X-Usuario': encodeURIComponent(usuarioActual() ?? ''),
      ...(cuerpo !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (res.status === 204) return null;
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) throw new ErrorApi(res.status, datos);
  return datos;
}

// Sube un fichero binario (una foto) como cuerpo de la petición.
async function subir(ruta, blob) {
  const res = await fetch(`api${ruta}`, {
    method: 'POST',
    headers: { 'X-Usuario': encodeURIComponent(usuarioActual() ?? ''), 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  let datos = null;
  try { datos = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) throw new ErrorApi(res.status, datos);
  return datos;
}

export const api = {
  subir,
  get: (ruta) => pedir('GET', ruta),
  post: (ruta, cuerpo = {}) => pedir('POST', ruta, cuerpo),
  patch: (ruta, cuerpo) => pedir('PATCH', ruta, cuerpo),
  del: (ruta) => pedir('DELETE', ruta),
};

// Construye "?a=1&b=2" omitiendo los valores vacíos.
export function consulta(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
