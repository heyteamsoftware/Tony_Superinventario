import { createHash } from 'node:crypto';
import { crearLimitador } from '../lib/limitador.js';
import { ErrorApi } from '../lib/errores.js';
import { ahora } from '../lib/texto.js';

// Contador de visitantes únicos. No hay cuentas ni cookies de seguimiento: cada
// navegador genera un identificador aleatorio que guarda él mismo, y aquí se
// cuentan huellas distintas. Cuenta navegadores/dispositivos, no personas
// exactas (quien entre desde dos aparatos cuenta dos veces).

const ID_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;
const ORIGENES = new Set(['app', 'qr']);

// Tope de visitantes NUEVOS por IP: frena a quien intente inflar el contador con
// identificadores inventados, y deja margen de sobra a una clase entera que
// entre a la vez (todo el centro comparte IP). Los visitantes que ya existen no
// gastan cupo.
export const limites = {
  nuevos: crearLimitador({ ventanaMs: 10 * 60_000, max: 300 }),
};
setInterval(() => limites.nuevos.limpiar(), 10 * 60_000).unref();

const huella = (id) => createHash('sha256').update(id).digest('hex');

export function estadisticasVisitas(db) {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const r = db.prepare(`
    SELECT COUNT(*) AS unicos,
           COALESCE(SUM(ultima >= ?), 0) AS hoy,
           COALESCE(SUM(app), 0) AS por_app,
           COALESCE(SUM(qr), 0) AS por_qr
    FROM visitantes`).get(inicioHoy.toISOString());
  return { unicos: r.unicos, hoy: r.hoy, por_app: r.por_app, por_qr: r.por_qr };
}

// Registra una visita. Devuelve las estadísticas actualizadas.
export function registrarVisita(db, id, origen, ip = 'desconocida') {
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new ErrorApi(400, 'Identificador de visitante no válido');
  if (!ORIGENES.has(origen)) throw new ErrorApi(400, 'Origen de la visita no válido');

  const clave = huella(id);
  const conocido = db.prepare('SELECT 1 FROM visitantes WHERE id = ?').get(clave);
  if (!conocido && !limites.nuevos.intentar(ip)) {
    throw new ErrorApi(429, 'Demasiadas visitas nuevas seguidas. Inténtalo de nuevo en unos minutos.');
  }

  const t = ahora();
  db.prepare(`
    INSERT INTO visitantes (id, primera, ultima, visitas, app, qr) VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ultima = excluded.ultima,
      visitas = visitas + 1,
      app = MAX(app, excluded.app),
      qr = MAX(qr, excluded.qr)`).run(clave, t, t, origen === 'app' ? 1 : 0, origen === 'qr' ? 1 : 0);
  return estadisticasVisitas(db);
}
