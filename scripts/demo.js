// Rellena una base de datos con material de ejemplo para probar la aplicación.
//   npm run demo                       -> data/demo.db
//   DB_PATH=otra.db npm run demo
// No toca bases de datos que ya tengan artículos.
import { fileURLToPath } from 'node:url';
import { abrirDb, transaccion } from '../src/db/index.js';
import { crear, trasladar, darDeBaja } from '../src/servicios/articulos.js';
import { registrarRevision } from '../src/servicios/revisiones.js';

const fichero = process.env.DB_PATH || fileURLToPath(new URL('../data/demo.db', import.meta.url));
const db = abrirDb(fichero);

if (db.prepare('SELECT COUNT(*) AS n FROM articulos').get().n > 0) {
  console.log(`La base de datos ${fichero} ya tiene artículos: no se modifica.`);
  process.exit(0);
}

const fam = Object.fromEntries(db.prepare('SELECT codigo, id FROM familias').all().map((f) => [f.codigo, f.id]));
const esp = Object.fromEntries(db.prepare('SELECT codigo, id FROM espacios').all().map((e) => [e.codigo, e.id]));

// [familia, espacio, categoría, nombre, cantidad, extra]
const MATERIAL = [
  ['SEA', 'P2-01', 'Equipos de seguridad y emergencias', 'Maniquí RCP adulto', 4, { marca: 'Laerdal', modelo: 'Little Anne QCPR', valor: 420 }],
  ['SEA', 'P2-01', 'Equipos de seguridad y emergencias', 'Desfibrilador de entrenamiento (DEA)', 3, { marca: 'Philips', valor: 310 }],
  ['SEA', 'P2-01', 'Audiovisuales', 'Proyector', 1, { marca: 'Epson', modelo: 'EB-W06', valor: 480, ubicacion_detalle: 'Techo' }],
  ['SEA', 'P2-02', 'Equipos de seguridad y emergencias', 'Extintor de prácticas CO2', 6, { valor: 65 }],
  ['SEA', 'P2-02', 'Mobiliario', 'Mesa de alumno', 24, {}],
  ['SEA', 'P2-04', 'Equipos de seguridad y emergencias', 'Equipo de respiración autónoma', 2, { marca: 'Dräger', valor: 1450 }],
  ['SEA', 'P2-04', 'Equipos de seguridad y emergencias', 'Camilla de rescate nido', 2, { valor: 380 }],
  ['SEA', 'P2-05', 'Equipos de seguridad y emergencias', 'Collarín cervical', 15, { valor: 12.5 }],
  ['SEA', 'P2-07', 'Equipos de seguridad y emergencias', 'Tablero espinal', 3, { valor: 210 }],
  ['SAN', 'P2-05', 'Material sanitario', 'Sillón dental de prácticas', 2, { marca: 'Fedesa', valor: 3200 }],
  ['SAN', 'P2-06', 'Material sanitario', 'Cama articulada', 2, { valor: 890 }],
  ['SAN', 'P1-03', 'Material sanitario', 'Grúa de traslado de pacientes', 1, { marca: 'Invacare', valor: 1150 }],
  ['SAN', 'P1-03', 'Material sanitario', 'Tensiómetro digital', 8, { marca: 'Omron', valor: 45 }],
  ['SAN', 'P1-04', 'Material sanitario', 'Simulador de cabeza dental (phantom)', 12, { valor: 260 }],
  ['SAN', 'P1-04', 'Material sanitario', 'Autoclave', 1, { marca: 'Mocom', valor: 2800 }],
  ['SAN', 'P1-14', 'Material sanitario', 'Silla de ruedas', 3, { valor: 190 }],
  ['SSC', 'P1-03', 'Material didáctico', 'Kit de productos de apoyo AVD', 2, {}],
  ['SSC', 'P1-05', 'Mobiliario', 'Silla', 30, {}],
  ['SSC', 'P1-06', 'Material didáctico', 'Juegos de mesa cooperativos', 10, {}],
  ['SSC', 'PB-03', 'Material didáctico', 'Bloques de construcción de madera', 6, {}],
  ['SSC', 'PB-04', 'Equipamiento deportivo', 'Colchoneta de psicomotricidad', 12, { valor: 38 }],
  ['AFD', 'P2-08', 'Equipamiento deportivo', 'Balón medicinal 3 kg', 10, { valor: 22 }],
  ['AFD', 'P1-11', 'Equipamiento deportivo', 'Pulsómetro', 15, { marca: 'Polar', valor: 60 }],
  ['AFD', 'P1-12', 'Equipamiento deportivo', 'Kettlebell 12 kg', 8, { valor: 35 }],
  ['AFD', 'P1-16', 'Equipamiento deportivo', 'Esterilla de yoga', 25, {}],
  ['IMA', 'P1-01', 'Maquinaria', 'Entrenador de autómatas programables', 6, { marca: 'Siemens', modelo: 'S7-1200', valor: 1300 }],
  ['IMA', 'P1-01', 'Equipos informáticos', 'Ordenador de sobremesa', 12, { marca: 'HP', valor: 640 }],
  ['IMA', 'P1-02', 'Herramientas', 'Polímetro digital', 16, { marca: 'Fluke', valor: 120 }],
  ['IMA', 'PB-11', 'Maquinaria', 'Equipo de soldadura MIG', 4, { valor: 980 }],
  ['IMA', 'PB-12', 'Maquinaria', 'Torno paralelo', 2, { valor: 7400 }],
  ['IMA', 'PB-12', 'Herramientas', 'Juego de brocas HSS', 10, {}],
  ['MAM', 'PB-10', 'Maquinaria', 'Sierra de cinta', 1, { valor: 2300 }],
  ['MAM', 'PB-10', 'Maquinaria', 'Tupí', 1, { valor: 3100 }],
  ['MAM', 'PB-10', 'Herramientas', 'Formón (juego)', 8, {}],
  ['MAM', 'P1-15', 'Equipos informáticos', 'Portátil con software CAD', 10, { valor: 890 }],
  ['INA', 'PB-01', 'Maquinaria', 'Horno de convección', 2, { marca: 'Rational', valor: 6200 }],
  ['INA', 'PB-01', 'Electrodomésticos', 'Amasadora espiral', 2, { valor: 1450 }],
  ['INA', 'PB-01', 'Menaje y utensilios de cocina', 'Molde de acero para pan', 40, {}],
  ['INA', 'P2-03', 'Material didáctico', 'Carteles de higiene alimentaria', 5, {}],
  ['HOT', 'PB-02', 'Electrodomésticos', 'Cafetera industrial 2 grupos', 1, { valor: 2100 }],
  ['HOT', 'PB-02', 'Mobiliario', 'Mesa de comedor', 12, {}],
  ['HOT', 'PB-04', 'Menaje y utensilios de cocina', 'Batería de cocina profesional', 4, { valor: 350 }],
  ['HOT', 'PB-08', 'Menaje y utensilios de cocina', 'Coctelera', 10, {}],
  ['TIC', 'P1-07', 'Equipos informáticos', 'Ordenador de sobremesa', 20, { marca: 'Lenovo', valor: 590 }],
  ['TIC', 'P1-08', 'Equipos informáticos', 'Ordenador de sobremesa', 20, { marca: 'Lenovo', valor: 590 }],
  ['TIC', 'P1-09', 'Equipos informáticos', 'Ordenador de sobremesa', 18, { marca: 'Dell', valor: 610 }],
  ['TIC', 'P1-09', 'Audiovisuales', 'Pantalla interactiva 75"', 1, { valor: 2900 }],
  ['TIC', 'PB-07', 'Equipos informáticos', 'Impresora 3D', 2, { marca: 'Prusa', valor: 1100 }],
  ['TIC', 'PB-07', 'Equipos informáticos', 'Kit de robótica educativa', 8, {}],
  ['RAD', 'PB-06', 'Audiovisuales', 'Micrófono de estudio', 4, { marca: 'Rode', valor: 180 }],
  ['RAD', 'PB-06', 'Audiovisuales', 'Mesa de mezclas', 1, { marca: 'Behringer', valor: 420 }],
  ['ORI', 'P1-10', 'Material didáctico', 'Test psicopedagógicos (colección)', 1, {}],
  ['COM', 'PB-06', 'Mobiliario', 'Expositor de producto', 3, {}],
  ['COM', 'P1-10', 'Equipos informáticos', 'TPV táctil', 2, { valor: 750 }],
];

transaccion(db, () => {
  const creados = MATERIAL.map(([f, e, c, nombre, cantidad, extra]) => crear(db, {
    nombre, familia_id: fam[f], espacio_id: esp[e], categoria: c, cantidad, estado: 'bueno', ...extra,
  }, 'Datos de ejemplo'));

  // Un poco de historia: un traslado parcial, una avería y una baja.
  const sillas = creados.find((a) => a.nombre === 'Silla');
  trasladar(db, sillas.id, { espacio_id: esp['P1-06'], cantidad: 8, motivo: 'Faltaban sillas' }, 'Ana García');
  const torno = creados.find((a) => a.nombre === 'Torno paralelo');
  db.prepare("UPDATE articulos SET estado = 'averiado' WHERE id = ?").run(torno.id);
  const moldes = creados.find((a) => a.nombre === 'Molde de acero para pan');
  darDeBaja(db, moldes.id, { motivo: 'Oxidados' }, 'Luis Pérez');

  registrarRevision(db, { familia_id: fam.SAN, notas: 'Revisión de inicio de curso' }, 'Coordinación Sanidad');
  registrarRevision(db, { familia_id: fam.TIC, espacio_id: esp['P1-07'] }, 'Coordinación TIC');

  // Simula familias que llevan tiempo sin revisarse para ver los avisos.
  const antiguo = (dias) => new Date(Date.now() - dias * 86_400_000).toISOString();
  for (const [codigo, dias] of [['IMA', 420], ['MAM', 390], ['HOT', 345]]) {
    db.prepare('UPDATE movimientos SET fecha = ? WHERE familia_id = ?').run(antiguo(dias), fam[codigo]);
    db.prepare('UPDATE articulos SET revisado_en = ? WHERE familia_id = ?').run(antiguo(dias), fam[codigo]);
  }
});

const n = db.prepare('SELECT COUNT(*) AS n FROM articulos').get().n;
console.log(`Base de datos de ejemplo creada en ${fichero} con ${n} artículos.`);
console.log('Arráncala con:  DB_PATH=data/demo.db npm start');
db.close();
