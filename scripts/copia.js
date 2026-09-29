// Copia de seguridad consistente de la base de datos (aunque la app esté en
// uso) y rotación de copias antiguas. Pensado para ejecutarse a diario.
//   DB_PATH=/ruta/inventario.db node scripts/copia.js
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fichero = process.env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url));
const carpeta = process.env.COPIAS_DIR || join(dirname(fichero), 'copias');
const mantener = Number(process.env.COPIAS_MANTENER) || 30;

if (!existsSync(fichero)) {
  console.error(`No existe la base de datos ${fichero}`);
  process.exit(1);
}
mkdirSync(carpeta, { recursive: true });

// VACUUM INTO no sobrescribe: el nombre lleva segundos y, si aun así existe, un sufijo.
const marca = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
let destino = join(carpeta, `inventario-${marca}.db`);
for (let n = 2; existsSync(destino); n++) destino = join(carpeta, `inventario-${marca}-${n}.db`);
const db = new DatabaseSync(fichero);
db.exec('PRAGMA busy_timeout = 10000');
db.prepare('VACUUM INTO ?').run(destino);
db.close();

const copias = readdirSync(carpeta).filter((f) => /^inventario-.*\.db$/.test(f)).sort();
for (const vieja of copias.slice(0, Math.max(0, copias.length - mantener))) rmSync(join(carpeta, vieja));
console.log(`Copia creada: ${destino} (${Math.min(copias.length, mantener)} copias guardadas)`);
