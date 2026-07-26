# Reclamaciones en contra · Combuses

Aplicación web para registrar y hacer seguimiento a las reclamaciones por
siniestros viales: inicio de sesión, tabla, ficha por caso con bitácora e
historial de cambios. Es una **PWA** instalable.

**App en línea:** <https://desarrollocombuses.github.io/reclamaciones/>

- **Stack**: HTML / CSS / JavaScript sin build. `supabase-js` por CDN.
- **Backend**: Supabase (Auth + base de datos con RLS).
- **PWA**: instalable, el shell funciona sin conexión y se actualiza con aviso.

```
reclamaciones/
  index.html              login + tabla + formulario
  css/styles.css
  js/config.js            URL y clave publishable de Supabase, estados
  js/app.js               login, CRUD, filtros, detalle, exportar
  js/pwa.js               registro del SW, aviso de actualización, instalar
  sw.js                   service worker: caché del shell + versionado
  manifest.webmanifest    nombre, iconos y colores para instalar
  icons/                  iconos de la app
  sql/01_schema.sql       tabla, RLS, triggers, índices
  sql/03_seguimiento.sql  archivar, saldo, bitácora, auditoría
  servir.bat              levanta un servidor local
```

> Los datos reales y el script de carga (`sql/02_datos.sql`, `datos/`) **no** se
> incluyen en el repositorio por privacidad: viven solo en Supabase. En `sql/` queda
> la estructura de la base para poder recrearla o consultarla.

## Acceso

Entran las cuentas de Supabase Auth cuyo correo sea **`@combuses.com.co` o
`@combuses.com`**. La regla la aplica la base de datos (RLS): sin una sesión válida de
ese dominio, la API no devuelve ninguna fila. La clave `sb_publishable_…` de
`js/config.js` es pública por diseño; lo que protege los datos es la RLS, no la clave.
Nunca se debe poner aquí una clave secreta.

Para crear una cuenta: Supabase → **Authentication → Users → Add user**
(marcando *Auto Confirm User*).

## Cómo funciona

- **Nada se borra.** No hay opción de borrar; en su lugar se **archiva** con un motivo,
  y la reclamación se recupera con *Ver archivadas*.
- **Ficha del caso** (clic en una fila): pestañas de *Datos*, *Seguimiento* (bitácora de
  gestiones fechadas, solo se agrega) e *Historial* (auditoría automática de cambios).
- **Saldo** (`pretensiones − pagado`) y **antigüedad** del caso se calculan solos.
- **Tema claro / oscuro**, búsqueda, filtro por estado y exportación a CSV.

## Correr en local

Doble clic en `servir.bat`, o desde la terminal en esta carpeta:

```
python -m http.server 8000
```

Y abre <http://localhost:8000>. Ábrela por `http://localhost`, no con doble clic en el
archivo: con `file://` el navegador bloquea las peticiones a Supabase.

## PWA y versiones

La app es instalable (botón **Instalar app** en la barra, o la opción del navegador;
en iPhone: Safari → Compartir → *Añadir a inicio*). El shell queda en caché y abre sin
conexión; los datos sí requieren internet.

**Para publicar una versión nueva**, sube el número en un solo sitio:

```js
// sw.js
const VERSION = "1.0.1";   // 1.0.0 -> 1.0.1
```

La próxima vez que alguien abra la app aparece **"Hay una nueva versión disponible ·
Actualizar"**; al pulsarlo se estrena la versión y se limpia la caché vieja. No se
recarga solo. **Sube la versión en cada despliegue**, o los usuarios podrían quedarse
con archivos viejos en caché.

## Despliegue

El sitio se publica con **GitHub Pages** desde la rama `main` (carpeta raíz). Cada
`git push` a `main` actualiza <https://desarrollocombuses.github.io/reclamaciones/> en
uno o dos minutos. GitHub Pages sirve por HTTPS, que es lo que la PWA necesita.
