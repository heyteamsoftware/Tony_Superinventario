import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { abrirDb } from './db/index.js';
import { crearApp } from './app.js';
import { purgarHuerfanas } from './servicios/fotos.js';
import { dirname, join, resolve } from 'node:path';

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FICHERO_DB = process.env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url));
// Las fotos son ficheros junto a la base de datos (no dentro de ella).
const DIR_FOTOS = resolve(process.env.FOTOS_DIR || join(dirname(FICHERO_DB), 'fotos'));

const db = abrirDb(FICHERO_DB);
// Barrido de fotos que ya no usa ningún artículo: al arrancar y cada hora.
const barrer = () => {
  try { purgarHuerfanas(db, DIR_FOTOS); } catch (err) { console.error('No se pudieron limpiar fotos:', err.message); }
};
barrer();
setInterval(barrer, 60 * 60_000).unref();

const servidor = crearApp(db, { dirFotos: DIR_FOTOS }).listen(PUERTO, HOST, () => {
  console.log(`\n  Superinventario CIFP Tony Gallardo en marcha`);
  console.log(`  · En este equipo:   http://localhost:${PUERTO}`);
  // Solo se anuncian las IP de la red si se escucha en todas las interfaces.
  const todasLasInterfaces = HOST === '0.0.0.0' || HOST === '::';
  for (const ifaces of todasLasInterfaces ? Object.values(networkInterfaces()) : []) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  · En la red local:  http://${i.address}:${PUERTO}`);
    }
  }
  console.log(`  · Base de datos:    ${FICHERO_DB}`);
  console.log(`  · Fotos:            ${DIR_FOTOS}\n`);
});

function cerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
