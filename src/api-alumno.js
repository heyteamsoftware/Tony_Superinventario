import { Router, json, raw } from 'express';
import { ErrorApi } from './lib/errores.js';
import * as alumnado from './servicios/alumnado.js';
import * as fotos from './servicios/fotos.js';

// Rutas públicas del acceso del alumnado por QR (/api/alumno/:token/...).
// Es la ÚNICA parte de la API que se puede usar con un token: todo lo demás
// queda fuera de su alcance. Está montada antes del resto de la API para tener
// su propio límite de tamaño de petición y, si algún día se protege el acceso
// al resto de la aplicación, quedar exenta de forma limpia.
export function crearApiAlumno(db, { dirFotos = null } = {}) {
  const r = Router();
  r.use(json({ limit: '32kb' }));
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Valida el token antes de cualquier ruta. Un token inexistente, mal
  // formado o revocado dan exactamente la misma respuesta.
  r.use('/:token', (req, res, next) => {
    const familia = alumnado.familiaPorToken(db, req.params.token);
    if (!familia) throw new ErrorApi(404, 'Este acceso no es válido o ya no está activo. Pide un QR nuevo a tu profesorado.');
    req.familia = familia;
    next();
  });

  r.get('/:token', (req, res) => res.json(alumnado.datosFormulario(db, req.familia)));

  r.post('/:token/articulos', (req, res) => {
    if (!alumnado.limites.altas.intentar(req.params.token)) throw alumnado.demasiadasPeticiones();
    res.status(201).json(alumnado.altaAlumno(db, req.familia, req.body));
  });

  // La foto se sube aparte y se asocia en el alta con foto_id. Mismo procesado y
  // límites que en la app; el tope de subidas se cuenta por token.
  r.post('/:token/fotos', raw({ type: 'image/*', limit: fotos.LIMITES.subidaMax }), async (req, res) => {
    if (!alumnado.limites.fotos.intentar(req.params.token)) throw alumnado.demasiadasPeticiones();
    res.status(201).json(await fotos.guardarFoto(db, dirFotos, req.body, { origen: `qr:${req.familia.codigo}` }));
  });

  return r;
}
