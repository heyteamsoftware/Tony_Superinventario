import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PLANTAS, FAMILIAS, CATEGORIAS, ESPACIOS } from './semilla.js';
import { normalizar } from '../lib/texto.js';

export const ESTADOS = ['nuevo', 'bueno', 'regular', 'averiado', 'baja'];

// Cada migración se aplica una sola vez; PRAGMA user_version guarda la última.
// Añade un espacio al plano y lo asocia a sus familias habituales. Idempotente
// (INSERT OR IGNORE): si el código ya existe, no se toca. Lo usan las migraciones
// que añaden espacios.
function insertarEspacio(db, e) {
  const planta = db.prepare('SELECT id FROM plantas WHERE codigo = ?').get(e.planta);
  db.prepare(`
    INSERT OR IGNORE INTO espacios (codigo, nombre, planta_id, tipo, grupos, color, x, y, w, h)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.codigo, e.nombre, planta.id, e.tipo, e.grupos, e.color, e.x, e.y, e.w, e.h);
  const { id } = db.prepare('SELECT id FROM espacios WHERE codigo = ?').get(e.codigo);
  for (const codigo of e.familias) {
    const familia = db.prepare('SELECT id FROM familias WHERE codigo = ?').get(codigo);
    if (familia) db.prepare('INSERT OR IGNORE INTO espacio_familias (espacio_id, familia_id) VALUES (?, ?)').run(id, familia.id);
  }
}

const MIGRACIONES = [
  function esquemaInicial(db) {
    db.exec(`
      CREATE TABLE plantas (
        id      INTEGER PRIMARY KEY,
        codigo  TEXT NOT NULL UNIQUE,
        nombre  TEXT NOT NULL,
        orden   INTEGER NOT NULL
      );

      CREATE TABLE familias (
        id              INTEGER PRIMARY KEY,
        codigo          TEXT NOT NULL UNIQUE,
        nombre          TEXT NOT NULL UNIQUE,
        color           TEXT NOT NULL,
        siguiente_num   INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE espacios (
        id         INTEGER PRIMARY KEY,
        codigo     TEXT NOT NULL UNIQUE,
        nombre     TEXT NOT NULL,
        planta_id  INTEGER NOT NULL REFERENCES plantas(id),
        tipo       TEXT NOT NULL DEFAULT 'aula',
        grupos     TEXT NOT NULL DEFAULT '',
        notas      TEXT NOT NULL DEFAULT '',
        color      TEXT,
        x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL
      );

      CREATE TABLE espacio_familias (
        espacio_id  INTEGER NOT NULL REFERENCES espacios(id) ON DELETE CASCADE,
        familia_id  INTEGER NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
        PRIMARY KEY (espacio_id, familia_id)
      );

      CREATE TABLE categorias (
        id      INTEGER PRIMARY KEY,
        nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE articulos (
        id                 INTEGER PRIMARY KEY,
        codigo             TEXT NOT NULL UNIQUE,
        nombre             TEXT NOT NULL,
        descripcion        TEXT NOT NULL DEFAULT '',
        familia_id         INTEGER NOT NULL REFERENCES familias(id),
        espacio_id         INTEGER NOT NULL REFERENCES espacios(id),
        categoria_id       INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
        cantidad           INTEGER NOT NULL DEFAULT 1 CHECK (cantidad >= 0),
        estado             TEXT NOT NULL DEFAULT 'bueno'
                             CHECK (estado IN ('nuevo','bueno','regular','averiado','baja')),
        ubicacion_detalle  TEXT NOT NULL DEFAULT '',
        marca              TEXT NOT NULL DEFAULT '',
        modelo             TEXT NOT NULL DEFAULT '',
        numero_serie       TEXT NOT NULL DEFAULT '',
        valor              REAL CHECK (valor IS NULL OR valor >= 0),
        fecha_adquisicion  TEXT,
        proveedor          TEXT NOT NULL DEFAULT '',
        observaciones      TEXT NOT NULL DEFAULT '',
        fecha_baja         TEXT,
        motivo_baja        TEXT,
        revisado_en        TEXT NOT NULL,
        creado_por         TEXT NOT NULL DEFAULT '',
        creado_en          TEXT NOT NULL,
        actualizado_en     TEXT NOT NULL
      );
      CREATE INDEX idx_articulos_familia   ON articulos(familia_id);
      CREATE INDEX idx_articulos_espacio   ON articulos(espacio_id);
      CREATE INDEX idx_articulos_categoria ON articulos(categoria_id);
      CREATE INDEX idx_articulos_estado    ON articulos(estado);

      -- Historial inmutable. Guarda código y nombre para sobrevivir al borrado,
      -- y la familia y el espacio del artículo tras el movimiento para calcular
      -- cuándo se tocó por última vez el inventario de cada familia/aula.
      CREATE TABLE movimientos (
        id               INTEGER PRIMARY KEY,
        articulo_id      INTEGER REFERENCES articulos(id) ON DELETE SET NULL,
        articulo_codigo  TEXT NOT NULL,
        articulo_nombre  TEXT NOT NULL,
        familia_id       INTEGER REFERENCES familias(id) ON DELETE SET NULL,
        espacio_id       INTEGER REFERENCES espacios(id) ON DELETE SET NULL,
        tipo             TEXT NOT NULL
                           CHECK (tipo IN ('alta','edicion','traslado','estado','baja','reactivacion','eliminacion')),
        detalle          TEXT NOT NULL DEFAULT '{}',
        usuario          TEXT NOT NULL,
        fecha            TEXT NOT NULL
      );
      CREATE INDEX idx_movimientos_articulo ON movimientos(articulo_id);
      CREATE INDEX idx_movimientos_fecha    ON movimientos(fecha);
      CREATE INDEX idx_movimientos_familia  ON movimientos(familia_id, espacio_id, fecha);

      -- Repasos del inventario: alguien confirma que el material de una familia
      -- (entera o en un espacio concreto) coincide con lo registrado.
      CREATE TABLE revisiones (
        id          INTEGER PRIMARY KEY,
        familia_id  INTEGER NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
        espacio_id  INTEGER REFERENCES espacios(id) ON DELETE CASCADE,
        articulos   INTEGER NOT NULL DEFAULT 0,
        unidades    INTEGER NOT NULL DEFAULT 0,
        notas       TEXT NOT NULL DEFAULT '',
        usuario     TEXT NOT NULL,
        fecha       TEXT NOT NULL
      );
      CREATE INDEX idx_revisiones_familia ON revisiones(familia_id, espacio_id, fecha);

      CREATE TABLE ajustes (
        clave  TEXT PRIMARY KEY,
        valor  TEXT NOT NULL
      );
      INSERT INTO ajustes (clave, valor) VALUES ('dias_aviso_revision', '365'), ('dias_preaviso_revision', '30');
    `);

    const insPlanta = db.prepare('INSERT INTO plantas (codigo, nombre, orden) VALUES (?, ?, ?)');
    for (const p of PLANTAS) insPlanta.run(p.codigo, p.nombre, p.orden);

    const insFamilia = db.prepare('INSERT INTO familias (codigo, nombre, color) VALUES (?, ?, ?)');
    for (const f of FAMILIAS) insFamilia.run(f.codigo, f.nombre, f.color);

    const insCategoria = db.prepare('INSERT INTO categorias (nombre) VALUES (?)');
    for (const c of CATEGORIAS) insCategoria.run(c);

    const plantaId = Object.fromEntries(db.prepare('SELECT codigo, id FROM plantas').all().map((r) => [r.codigo, r.id]));
    const familiaId = Object.fromEntries(db.prepare('SELECT codigo, id FROM familias').all().map((r) => [r.codigo, r.id]));
    const insEspacio = db.prepare(`
      INSERT INTO espacios (codigo, nombre, planta_id, tipo, grupos, color, x, y, w, h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insEF = db.prepare('INSERT INTO espacio_familias (espacio_id, familia_id) VALUES (?, ?)');
    for (const e of ESPACIOS) {
      const { lastInsertRowid } = insEspacio.run(
        e.codigo, e.nombre, plantaId[e.planta], e.tipo, e.grupos, e.color, e.x, e.y, e.w, e.h,
      );
      for (const f of e.familias) insEF.run(lastInsertRowid, familiaId[f]);
    }
  },

  // Acceso por QR de inventario móvil (un token secreto por familia) y fin de las
  // categorías predefinidas: ahora se crean al escribirlas y quedan guardadas.
  function accesoQrYCategoriasLibres(db) {
    db.exec(`
      ALTER TABLE familias ADD COLUMN acceso_token TEXT;
      CREATE UNIQUE INDEX idx_familias_acceso_token ON familias(acceso_token) WHERE acceso_token IS NOT NULL;

      -- Se retiran las categorías de la semilla que ningún artículo usa;
      -- las que ya se estén usando se conservan.
      DELETE FROM categorias WHERE id NOT IN (SELECT categoria_id FROM articulos WHERE categoria_id IS NOT NULL);
    `);
  },

  // Fotos de los artículos. Los ficheros viven en disco (no en SQLite, para
  // que las copias de la base de datos no engorden); aquí solo su registro.
  function fotosDeArticulos(db) {
    db.exec(`
      CREATE TABLE fotos (
        id                 TEXT PRIMARY KEY,           -- 32 hex aleatorios; es el nombre del fichero
        bytes              INTEGER NOT NULL,
        bytes_miniatura    INTEGER NOT NULL,
        ancho              INTEGER NOT NULL,
        alto               INTEGER NOT NULL,
        origen             TEXT NOT NULL,              -- 'app' o 'qr:CODIGO_FAMILIA'
        usuario            TEXT NOT NULL DEFAULT '',
        creada_en          TEXT NOT NULL
      );
      ALTER TABLE articulos ADD COLUMN foto_id TEXT REFERENCES fotos(id) ON DELETE SET NULL;
      CREATE INDEX idx_articulos_foto ON articulos(foto_id) WHERE foto_id IS NOT NULL;
    `);
  },

  // Subsala "Ateca-Radio" dentro de ATECA (planta baja), de uso habitual de
  // Radio Atlante. Se dibuja encima de ATECA, hundida unos píxeles, igual que +21.
  // INSERT OR IGNORE: si el espacio ya existiera, no se duplica.
  function subsalaAtecaRadio(db) {
    const planta = db.prepare("SELECT id FROM plantas WHERE codigo = 'PB'").get();
    db.prepare(`
      INSERT OR IGNORE INTO espacios (codigo, nombre, planta_id, tipo, grupos, color, x, y, w, h)
      VALUES ('PB-13', 'Ateca-Radio', ?, 'taller', 'Radio Atlante', '#e58bb0', 476, 325, 144, 102)`).run(planta.id);
    const espacio = db.prepare("SELECT id FROM espacios WHERE codigo = 'PB-13'").get();
    const radio = db.prepare("SELECT id FROM familias WHERE codigo = 'RAD'").get();
    if (radio) {
      db.prepare('INSERT OR IGNORE INTO espacio_familias (espacio_id, familia_id) VALUES (?, ?)').run(espacio.id, radio.id);
    }
  },

  // Dos almacenes de la familia de Seguridad y Medio Ambiente:
  //  · P2-09, en la 2ª planta, pegado al aula de Emergencias 1º-2º (P2-07);
  //  · PB-14, en el exterior de la planta baja (campo de maniobras), en la franja
  //    libre entre ATECA/Plaza y el taller de mecanizado.
  function almacenesDeSeguridad(db) {
    insertarEspacio(db, {
      codigo: 'P2-09', planta: 'P2', nombre: 'Almacén de Seguridad de Emergencia', tipo: 'almacen',
      grupos: 'Seguridad y Medio Ambiente', color: '#d5e5d0', x: 80, y: 493, w: 150, h: 110, familias: ['SEA'],
    });
    insertarEspacio(db, {
      codigo: 'PB-14', planta: 'PB', nombre: 'Almacén Campo de Maniobras', tipo: 'almacen',
      grupos: 'Exterior · Campo de Maniobras', color: '#c9e4b8', x: 470, y: 442, w: 232, h: 55, familias: ['SEA'],
    });
  },

  // Contador de visitantes únicos. Cada navegador genera un identificador
  // aleatorio y anónimo; aquí solo se guarda su huella SHA-256 (no se puede
  // volver al identificador), sin IP ni ningún dato personal.
  function visitantesUnicos(db) {
    db.exec(`
      CREATE TABLE visitantes (
        id       TEXT PRIMARY KEY,            -- sha256 del identificador aleatorio del navegador
        primera  TEXT NOT NULL,
        ultima   TEXT NOT NULL,
        visitas  INTEGER NOT NULL DEFAULT 1,  -- veces que ha abierto la aplicación
        app      INTEGER NOT NULL DEFAULT 0,  -- ha entrado a la aplicación
        qr       INTEGER NOT NULL DEFAULT 0   -- ha entrado desde un QR de inventario móvil
      );
      CREATE INDEX idx_visitantes_ultima ON visitantes(ultima);
    `);
  },
];

// `version` permite abrir una base de datos en una versión anterior del
// esquema (solo se usa en los tests de migración).
export function abrirDb(fichero = ':memory:', { version = MIGRACIONES.length } = {}) {
  if (fichero !== ':memory:') mkdirSync(dirname(fichero), { recursive: true });
  const db = new DatabaseSync(fichero);
  db.exec('PRAGMA foreign_keys = ON');
  if (fichero !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }
  // Búsquedas sin distinguir mayúsculas ni tildes ("camara" encuentra "Cámara").
  db.function('normalizar', { deterministic: true }, (s) => normalizar(s));
  migrar(db, version);
  return db;
}

function migrar(db, hasta) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < hasta; v++) {
    transaccion(db, () => {
      MIGRACIONES[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Ejecuta fn dentro de una transacción. Si ya hay una abierta, se une a ella.
export function transaccion(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
