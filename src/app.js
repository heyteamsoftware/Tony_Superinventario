import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { crearApi } from './api.js';

const PUBLICO = fileURLToPath(new URL('../public', import.meta.url));

export function crearApp(db, { dirFotos = null } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      // App interna: que no la indexen los buscadores aunque se publique en Internet.
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'",
    });
    next();
  });

  // Ruta absoluta siempre: res.sendFile no admite relativas y el cwd puede cambiar.
  app.use('/api', crearApi(db, { dirFotos: dirFotos ? resolve(dirFotos) : null }));
  app.use(express.static(PUBLICO, { index: 'index.html' }));
  return app;
}
