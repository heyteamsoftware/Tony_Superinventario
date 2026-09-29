# Superinventario · CIFP Tony Gallardo

Aplicación web interna para gestionar el inventario del centro **aula por aula, sobre el plano del edificio**.
Cada familia profesional puede tener material en cualquier espacio, y todo queda registrado: quién lo dio de alta,
lo movió, lo cambió o lo dio de baja, y cuándo se revisó por última vez.

No usa contraseñas: al entrar se pide el nombre, que queda en el historial de cada cambio.

## Qué hace

- **Plano interactivo** (pantalla principal) con las 3 plantas y los 36 espacios calcados del plano del centro (`plano.jpg`).
  - Selector de planta tipo ascensor, con el número de artículos de cada una.
  - Tres modos de color: **Plano** (colores originales), **Material** (mapa de calor por cantidad) y **Revisiones** (al día / pronto / vencida).
  - Filtro por familia: resalta las aulas donde tiene material y marca con borde discontinuo las que usa habitualmente.
  - Buscador «¿Dónde está…?»: hace parpadear las aulas que tienen lo buscado y salta a la planta correcta.
  - Al pinchar un aula: su material agrupado por familia, su estado de revisión y los botones **Añadir material** y **Revisar aula**.
- **Inventariado rápido**: «Guardar y añadir otro» conserva la familia, el aula y la categoría para ir metiendo material seguido.
- **Ficha de cada artículo** con historial completo, traslado (total o **parcial**: mover 5 de 20 sillas crea un artículo nuevo en el destino), baja con motivo, reactivación y etiqueta con QR.
- **Revisiones del inventario**: cada familia confirma, aula por aula o entera, que su material coincide (marcando cada artículo). También cuentan como repaso las altas, bajas, traslados y ediciones.
  - Si una familia pasa **más de 365 días** sin repasar su inventario aparece un aviso en el plano, en el menú y en su ficha (el plazo y el preaviso se configuran en *Datos*).
- **Tabla de inventario** con búsqueda sin tildes, filtros, orden, paginación y acciones en lote (trasladar, cambiar estado, imprimir etiquetas).
- **Inventario de una familia en PDF**, ordenado por planta y aula (y por nombre dentro de cada aula), con subtotales, estado de revisión, casilla por artículo para la revisión física y bloque de firma. Opcionalmente con valor económico y bajas. Desde *Familias*, *Inventario* o *Datos*.
- **Importación desde Excel (CSV)** con comprobación previa: o entran todas las filas o ninguna, con un informe de errores por fila. La **exportación** abre directamente en Excel y se puede volver a importar.
- **Copia de seguridad** de la base de datos con un clic.
- **Etiquetas QR** imprimibles: al escanearlas con el móvil (en la red del centro) se abre la ficha del artículo.

Familias incluidas: Servicios Socioculturales y a la Comunidad, Seguridad y Medio Ambiente, Madera Mueble y Corcho,
Actividades Físicas y Deportivas, Instalación y Mantenimiento, Sanidad, Industrias Alimentarias, Comercio y Marketing,
Hostelería y Turismo, Coordinación TIC, Radio Atlante y Orientación. Se pueden añadir más desde la aplicación.

## Puesta en marcha

Requisito: **Node.js 22.13 o superior** (recomendado 24 LTS). No necesita base de datos externa: usa SQLite integrado en Node.

```bash
npm install
npm start
```

Abre `http://localhost:3000`. El servidor muestra también la dirección para el resto de ordenadores de la red del centro
(por ejemplo `http://192.168.1.20:3000`). En Windows basta con hacer doble clic en `iniciar.bat`.

Variables opcionales:

| Variable  | Por defecto            | Uso                               |
|-----------|------------------------|-----------------------------------|
| `PORT`    | `3000`                 | Puerto HTTP                       |
| `HOST`    | `0.0.0.0`              | Interfaz de red                   |
| `DB_PATH` | `data/inventario.db`   | Fichero de la base de datos       |

### Datos de ejemplo

Para probar la aplicación con material ficticio (sin tocar la base real):

```bash
npm run demo
DB_PATH=data/demo.db npm start
```

## Servidor (producción)

Publicada en **https://myappsserver.duckdns.org/Tony_Superinventario/**, junto al resto de apps del servidor Apache:

| Pieza | Dónde |
|---|---|
| Código (clon de este repo) | `/var/www/html/Tony_Superinventario` |
| Base de datos y copias diarias | `/var/lib/tony-superinventario/` (fuera de la carpeta web) |
| Servicio | `tony-superinventario` (systemd, `deploy/tony-superinventario.service`), escucha solo en `127.0.0.1:3100` |
| Apache | proxy inverso de `/Tony_Superinventario/` (`deploy/apache-superinventario.conf`) |
| Node.js | binario oficial (v24) en `/opt/node/actual`, enlazado en `/usr/local/bin/node` |
| Copia diaria | 03:30, se guardan 30 (`deploy/cron-copias` → `/etc/cron.d/tony-superinventario`) |

Actualizar a la última versión de GitHub (hace copia de seguridad antes de reiniciar):

```bash
sudo bash /var/www/html/Tony_Superinventario/deploy/actualizar.sh
```

Ver el estado o los registros: `systemctl status tony-superinventario` · `journalctl -u tony-superinventario -f`.

## Copias de seguridad

Toda la información está en `data/inventario.db`. Desde **Datos → Descargar copia de seguridad** se obtiene una copia
consistente aunque haya gente usando la aplicación. Para restaurarla, detén el servidor y sustituye ese fichero.

## Desarrollo

```bash
npm run dev    # recarga el servidor al guardar
npm test       # tests de la API y de las utilidades
```

```
src/
  server.js              arranque del servidor
  app.js                 Express, cabeceras de seguridad y ficheros estáticos
  api.js                 rutas de la API REST (/api/...)
  db/index.js            esquema SQLite y migraciones versionadas
  db/semilla.js          plantas, familias, categorías y espacios del plano
  servicios/             lógica: artículos, catálogo, revisiones, estadísticas, importación
  lib/                   validación, CSV y utilidades
public/                  interfaz (HTML, CSS y JavaScript sin compilación)
  js/vistas/             plano, inventario, familias, revisiones, historial, datos, etiquetas
  js/componentes/        formularios, ficha del artículo y diálogo de revisión
test/                    tests con node:test
scripts/demo.js          genera una base de datos de ejemplo
```

Decisiones técnicas:

- **Sin compilación ni dependencias nativas**: Express, `qrcode`, `pdfkit` y el SQLite integrado de Node. Se instala en cualquier PC del centro con `npm install`.
- **Integridad**: claves foráneas, restricciones `CHECK`, transacciones en todas las operaciones compuestas y un historial de movimientos que no se modifica. Los códigos de inventario (`SAN-00012`) no cambian ni se reutilizan.
- **Seguridad** (aunque sea una app interna): todo el HTML se genera escapando los datos, consultas parametrizadas, `Content-Security-Policy` estricta y protección contra fórmulas en los CSV exportados.
- **Plano**: la geometría de cada espacio está en `src/db/semilla.js`. Los nombres, grupos y familias habituales de cada aula se editan desde la aplicación (*Datos → Espacios del plano*).
