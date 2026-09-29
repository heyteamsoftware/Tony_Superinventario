import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { abrirDb } from './db/index.js';
import { crearApp } from './app.js';

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FICHERO_DB = process.env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url));

const db = abrirDb(FICHERO_DB);
const servidor = crearApp(db).listen(PUERTO, HOST, () => {
  console.log(`\n  Superinventario en marcha`);
  console.log(`  · En este equipo:   http://localhost:${PUERTO}`);
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  · En la red local:  http://${i.address}:${PUERTO}`);
    }
  }
  console.log(`  · Base de datos:    ${FICHERO_DB}\n`);
});

function cerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
