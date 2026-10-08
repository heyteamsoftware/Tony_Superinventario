import { Router, json, raw } from 'express';
import { ErrorApi } from './lib/errores.js';
import * as movil from './servicios/movil.js';
import * as fotos from './servicios/fotos.js';
import * as visitas from './servicios/visitas.js';

// Rutas públicas del QR de inventario móvil (/api/movil/:token/...; la dirección
// antigua /api/alumno/... sigue funcionando para los QR ya repartidos).
// Es la ÚNICA parte de la API que se puede usar con un token: todo lo demás
// queda fuera de su alcance. Está montada antes del resto de la API para tener
// su propio límite de tamaño de petición y, si algún día se protege el acceso
// al resto de la aplicación, quedar exenta de forma limpia.
export function crearApiMovil(db, { dirFotos = null } = {}) {
  const r = Router();
  r.use(json({ limit: '32kb' }));
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Valida el token antes de cualquier ruta. Un token inexistente, mal
  // formado o revocado dan exactamente la misma respuesta.
  r.use('/:token', (req, res, next) => {
    const familia = movil.familiaPorToken(db, req.params.token);
    if (!familia) throw new ErrorApi(404, 'Este acceso no es válido o ya no está activo. Pide un QR nuevo a la persona que coordina el inventario.');
    req.familia = familia;
    next();
  });

  r.get('/:token', (req, res) => res.json(movil.datosFormulario(db, req.familia)));

  r.post('/:token/articulos', (req, res) => {
    if (!movil.limites.altas.intentar(req.params.token)) throw movil.demasiadasPeticiones();
    res.status(201).json(movil.altaMovil(db, req.familia, req.body));
  });

  // Cuenta la visita de quien entra por el QR (mismo identificador anónimo que en la app,
  // así quien entra por los dos sitios cuenta una sola vez). Va por aquí, con el token,
  // para que el QR no necesite ninguna otra ruta de la API.
  r.post('/:token/visita', (req, res) => {
    visitas.registrarVisita(db, req.body?.id, 'qr', req.ip);
    res.status(204).end();
  });

  // La foto se sube aparte y se asocia en el alta con foto_id. Mismo procesado y
  // límites que en la app; el tope de subidas se cuenta por token.
  r.post('/:token/fotos', raw({ type: 'image/*', limit: fotos.LIMITES.subidaMax }), async (req, res) => {
    if (!movil.limites.fotos.intentar(req.params.token)) throw movil.demasiadasPeticiones();
    res.status(201).json(await fotos.guardarFoto(db, dirFotos, req.body, { origen: `qr:${req.familia.codigo}` }));
  });

  return r;
}
