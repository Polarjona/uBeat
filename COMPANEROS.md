# Puesta en marcha para compañeros

El repo trae el código, pero **faltan 4 cosas que no van en git** (a propósito).
Sigue estos pasos en orden con tu usuario de Windows (sin admin).

## 1. Node.js 22 portable (sin instalar nada)

- Descarga `node-v22.17.0-win-x64.zip` de https://nodejs.org/dist/v22.17.0/
- Descomprímelo en una carpeta tuya. Tienes dos opciones:
  - **A.** Añade su carpeta al PATH de tu terminal, o instala Node 22 normal si puedes.
  - **B.** Deja la carpeta como `artistas-app\node-portable\node-v22.17.0-win-x64\`
    (el `iniciar-servidor.bat` la detecta sola).
- Tiene que ser la **v22** (el `firebase-admin` v14 la exige). Comprueba:
  `node --version` → `v22.x`.

## 2. Claves (pedirlas por Teams, NUNCA por el repo)

- `firebase-key.json` → cópialo junto a `server.js`.
  Sin él la app arranca en modo local (sin Firestore ni login).
- `secrets.json` → cópialo junto a `server.js`.
  Sin él el login falla en el captcha.

## 3. Instalar y arrancar

```bat
cd artistas-app
npm install
npm start
```

O doble clic en **`iniciar-servidor.bat`** (comprueba node, claves y arranca).

Abre **http://localhost:8080**. Comprueba `http://localhost:8080/api/health`
debe decir `"firestore":true`.

## 4. Si algo falla

| Síntoma | Causa probable |
|---|---|
| `node` no se reconoce | Punto 1 (PATH o carpeta portable) |
| Error `EBADENGINE` / raros en `npm install` | No es Node 22 |
| Página en blanco / `file://` | Hay que abrirla por `http://localhost:8080`, no con doble clic al HTML |
| `426` o HTML raro en `/api/*` | Puerto 8080 ocupado: `netstat -ano \| findstr 8080` |
| Login falla en captcha | Falta `secrets.json` o las claves reCAPTCHA no incluyen `localhost` |
| Borra `node_modules` y reinstala | Instalación corrupta (`EBUSY`/`EPERM`) |
