# uBeat 🎵

Buscador de cantantes estilo Spotify (solo información): **nombre, país, género e imagen**.

- **Frontend:** React 18 vía CDN (sin build) + patrón **MVC**
  - `public/js/models/ArtistModel.js` → **Modelo** (habla con `/api/*`)
  - `public/js/views/ArtistViews.jsx` → **Vista** (componentes React: SearchBar, ArtistCard, ArtistGrid)
  - `public/js/controllers/ArtistController.js` → **Controlador** (orquesta Modelo ↔ Vista)
  - `public/js/app.jsx` → arranque
- **Backend:** Node + Express + `firebase-admin`
  - `GET /api/artists?search=NOMBRE` → busca en **toda** la colección **Firestore** (`artists`); si no existe, lo trae de **TheAudioDB** y lo **guarda automáticamente** en Firestore.
  - `GET /api/artists` → catálogo paginado (`?limit=&offset=` para el scroll infinito) y filtros AND (`?country=&genre=`). `GET /api/artists/filters` → valores únicos. `GET /api/artists/count` → total.
  - `GET /api/charts?storefront=US|ES` → top 20 del ranking iTunes (global / oyentes españoles); auto-importa los que falten. Caché de 1 h.
  - `GET /api/me` → perfil del usuario según su ID token de Firebase (`Authorization: Bearer IDTOKEN`).
  - **Usuarios con Firebase Authentication**: registro/inicio en el cliente (SDK), recuperación con **enlace por email enviado por Firebase que aterriza en la app** (`/?mode=resetPassword`, formulario propio con verificación del código). **Login protegido con reCAPTCHA v3 invisible** (solo pestaña de login; `secrets.json` + clave de sitio en el Modelo). El backend solo verifica el ID token. Las cuentas del sistema anterior no migran (contraseñas incompatibles): hay que registrarse de nuevo una vez.
  - `POST /api/likes {artistId}` (alterna), `GET /api/likes`, `GET /api/likes/ids` (con `Authorization: Bearer TOKEN`).
  - `POST /api/song-likes` (alterna, con snapshot de la canción), `GET /api/song-likes`, `GET /api/song-likes/ids` (Bearer).
  - Notas de artistas: `POST /api/ratings {artistId, score}` (entero 0-10; `score: null` borra), `GET /api/ratings/ids` → mapa `{artistId: nota}` (Bearer).
  - `GET /api/discover?offset=` → feed paginado de canciones para la vista **Descubrir** (mismo algoritmo que Para ti, invitados en orden estable; devuelve `{songs, hasMore, offset}`).
  - Playlists: `POST /api/playlists {name}`, `GET /api/playlists` (con conteo), `DELETE /api/playlists/:id`, `GET|POST /api/playlists/:id/songs`, `DELETE /api/playlists/:id/songs/:trackId` (Bearer, solo el dueño, máx. 200 por playlist).
  - Tracking y Para ti (solo con sesión): `POST /api/plays {artistId|artist, trackId?, track?}` suma escuchas agregadas por usuario+artista; `GET /api/for-you` devuelve el rail ponderado (Me gusta ×3, escuchas ×1 topadas a 10, similitud ×2 decreciente) con el motivo de cada artista. Similitud real con Last.fm si hay clave (`secrets.json` → `{"lastfmKey": "..."}` o env `LASTFM_KEY`, clave gratis en last.fm/api); sin clave usa género/país.
  - Social: `POST /api/friends/request {email}`, `POST /api/friends/respond {from, accept}`, `DELETE /api/friends/:uid`, `GET /api/friends`, `GET /api/friends/:uid/profile` (solo amigos), `GET /api/friends/activity` (rail social, máx. 20).
  - `POST /api/artists/import` con `{ "name": "..." }` → importación manual (ideal para **Postman**).
  - `POST /api/artists/backfill` → rellena `nameLower` ausente. Las webs de artistas no se guardan ni se muestran.
  - `GET /api/artists/preview?artist=NOMBRE` → top canciones con vista previa de audio (30 s, iTunes, sin claves). El backend actúa de proxy.
- **Frontend:** portada con carrusel → **Inicio** con rails “Para ti” (si hay sesión), “Le gusta a tus amigos” (si hay amigos), “Populares ahora” y “Populares en España” (flechas, máx. 20) + “Todos los artistas” con **scroll infinito** (24 por tanda). **Menú lateral** que se despliega al pasar el ratón por el borde izquierdo (Inicio / **Descubrir** / Mis artistas favoritos / Mis canciones favoritas / Playlists / Ajustes) con desplegable **Social** (añadir por email, solicitudes, amigos, perfiles). **Vista Descubrir**: scroll infinito de canciones del algoritmo, auto-reproducción al terminar cada tema y botón de **auto-scroll** (por defecto off). **Perfil de amigo o propio abierto como card/modal** (no cambia de vista). **Nota 0-10 por artista** en su ficha (persistida por usuario). **Vista Ajustes** con **color de página** (fondo general, independiente del acento), **color de acento personalizable** (6 tonos + libre, con persistencia), tema, cuenta y cookies. **Usuarios**: registro e inicio de sesión; corazón en la ficha (se tiñe con animación) y vista de favoritos. **Canciones con Me gusta**, vista propia con reproducción y botón ⋮ para añadirlas a tus **playlists** (crear, abrir, quitar canciones, eliminar). Reproductor in-app en la ficha ampliada y **barra inferior** (imagen, título, controles, volumen, Me gusta) con animación de aparición.

## Requisitos (sin permisos de administrador)

1. **Node.js portable** (ya descargado durante el montaje en `Temp/opencode/node-portable/node-v22.17.0-win-x64/`).
   Si lo perdiste, descarga el `.zip` de https://nodejs.org/dist/ y descomprímelo en tu carpeta de usuario.
2. Este proyecto. Nada más: el frontend usa React por CDN.

## Puesta en marcha

```bat
cd artistas-app
REM 1) Copia tu clave de Firebase junto a server.js (ya está copiada de musica.zip)
copy ..\musica\firebase-key.json firebase-key.json  (o la ruta donde la tengas)

REM 2) Instala dependencias (usa el node portable si no tienes node en PATH)
"C:\...\node-portable\node-v22.17.0-win-x64\npm.cmd" install

REM 3) Arranca (puerto 8080: el 3000/3001 los ocupa otro programa del equipo)
"C:\...\node-portable\node-v22.17.0-win-x64\node.exe" server.js
REM o simplemente: npm start   (si node está en PATH)
```

Abre **http://localhost:8080**.

> Sin `firebase-key.json` la app funciona en **modo local** (`artists.seed.json` + TheAudioDB, sin guardar). Con la clave, se activa **Firestore**.

## Probar con Postman

1. Importa `postman_collection.json`.
2. Ejecuta **Buscar artista (crea en Firestore si no existe)** con un nombre nuevo (ej. `Rammstein`).
3. Comprueba en [Firestore Console](https://console.firebase.google.com/) → colección `artists` que el documento se creó solo.

## Día de la presentación (vaciar y resembrar)

- Vaciar solo artistas: `node scripts/vaciar.js artistas`
- Vaciar todo (artistas + likes + playlists): `node scripts/vaciar.js todo`
- Resembrar ~100 artistas (merge, sin borrar): `node scripts/resembrar.js`
- Sin argumento no borra nada. Tras vaciar, la home se rellena sola con
  tendencias y cada búsqueda guarda su artista: ideal para la demo en directo.

## Notas de Firebase Auth

- En consola: **Authentication → Sign-in method → Email/Password** activado. Los emails de recuperación los envía Google desde una dirección `noreply` del proyecto (personalizable en consola: Authentication → Templates).
- El `firebaseConfig` del frontend (`public/js/firebase-init.js`) es público por diseño.
- Para probar la API desde Postman se usa la REST de Identity Toolkit con esa `apiKey` (ver colección): `accounts:signUp`, `accounts:signInWithPassword` y `accounts:sendOobCode` (reset). El `idToken` devuelto va como `Bearer` en nuestro backend.

## Estructura

```
artistas-app/
  server.js                 Backend (Modelo+Controlador servidor + API Postman)
  artists.seed.json         Respaldo local (viene de tu artists.json)
  firebase-key.json         (poner aquí, NO subir a git)
  postman_collection.json   Colección Postman
  public/
    index.html
    css/styles.css          Tema oscuro atractivo
    js/models/ArtistModel.js
    js/views/ArtistViews.jsx
    js/controllers/ArtistController.js
    js/app.jsx
```

## Mejoras incluidas

- Búsqueda insensible a mayúsculas/acentos (`nameLower`).
- Tarjetas con imagen, país y género (sin webs), con fallback si falta imagen.
- Estado visible de la fuente (`firestore` / `theaudiodb guardado` / `local`).
- Lote de escritura en Firestore (`batch`) y `merge: true`
