import { abrirDb } from '../src/db/index.js';
import { crearApp } from '../src/app.js';

// Levanta la aplicación con una base de datos en memoria en un puerto libre.
export async function arrancar() {
  const db = abrirDb(':memory:');
  const servidor = crearApp(db).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function pedir(metodo, ruta, cuerpo, { usuario = 'Tester', crudo = false } = {}) {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: {
        'X-Usuario': encodeURIComponent(usuario),
        ...(cuerpo !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (crudo) return res;
    const texto = await res.text();
    return { status: res.status, body: texto ? JSON.parse(texto) : null };
  }

  const meta = (await pedir('GET', '/api/meta')).body;
  const familia = (codigo) => meta.familias.find((f) => f.codigo === codigo).id;
  const espacio = (codigo) => meta.espacios.find((e) => e.codigo === codigo).id;
  const categoria = (nombre) => meta.categorias.find((c) => c.nombre === nombre).id;

  return {
    db, base, meta, familia, espacio, categoria,
    get: (r, o) => pedir('GET', r, undefined, o),
    post: (r, b, o) => pedir('POST', r, b, o),
    patch: (r, b, o) => pedir('PATCH', r, b, o),
    del: (r, o) => pedir('DELETE', r, undefined, o),
    cerrar: () => new Promise((r) => servidor.close(() => { db.close(); r(); })),
  };
}
