// Copia de seguridad consistente de la base de datos (aunque la app esté en
// uso), rotación de copias antiguas y copia de las fotos nuevas. Pensado para
// ejecutarse a diario.
//   DB_PATH=/ruta/inventario.db node scripts/copia.js
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fichero = process.env.DB_PATH || fileURLToPath(new URL('../data/inventario.db', import.meta.url));
const carpeta = process.env.COPIAS_DIR || join(dirname(fichero), 'copias');
const mantener = Number(process.env.COPIAS_MANTENER) || 30;
const fotosOrigen = process.env.FOTOS_DIR || join(dirname(fichero), 'fotos');

if (!existsSync(fichero)) {
  console.error(`No existe la base de datos ${fichero}`);
  process.exit(1);
}
mkdirSync(carpeta, { recursive: true });

// El nombre lleva la hora con milisegundos: el orden alfabético es el cronológico.
// VACUUM INTO no sobrescribe, así que si aun así existe se añade un sufijo.
const marca = new Date().toISOString().slice(0, 23).replace(/[:T.]/g, '-');
let destino = join(carpeta, `inventario-${marca}.db`);
for (let n = 2; existsSync(destino); n++) destino = join(carpeta, `inventario-${marca}-${n}.db`);
const db = new DatabaseSync(fichero);
db.exec('PRAGMA busy_timeout = 10000');
db.prepare('VACUUM INTO ?').run(destino);
db.close();

// De la más antigua a la más reciente.
const copias = readdirSync(carpeta).filter((f) => /^inventario-.*\.db$/.test(f)).sort();
for (const vieja of copias.slice(0, Math.max(0, copias.length - mantener))) rmSync(join(carpeta, vieja));
console.log(`Copia creada: ${destino} (${Math.min(copias.length, mantener)} copias guardadas)`);

// Fotos: nunca se modifican (cada una tiene un nombre único), así que basta con
// copiar las que faltan. Una foto borrada de la aplicación se conserva en la
// copia durante `mantener` días, por si hay que restaurar una base de datos
// antigua que todavía la usaba.
if (existsSync(fotosOrigen)) {
  const fotosCopia = join(carpeta, 'fotos');
  mkdirSync(fotosCopia, { recursive: true });
  const enOrigen = new Set(readdirSync(fotosOrigen).filter((f) => f.endsWith('.webp')));
  let nuevas = 0;
  for (const f of enOrigen) {
    if (existsSync(join(fotosCopia, f))) continue;
    copyFileSync(join(fotosOrigen, f), join(fotosCopia, f));
    nuevas++;
  }
  const limite = Date.now() - mantener * 86_400_000;
  let retiradas = 0;
  for (const f of readdirSync(fotosCopia)) {
    if (!enOrigen.has(f) && statSync(join(fotosCopia, f)).mtimeMs < limite) { rmSync(join(fotosCopia, f)); retiradas++; }
  }
  console.log(`Fotos: ${nuevas} nuevas copiadas, ${retiradas} antiguas retiradas (${enOrigen.size} en uso)`);
}
