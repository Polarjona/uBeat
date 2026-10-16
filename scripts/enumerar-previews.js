/**
 * Recorre el catálogo de artistas y recoge sus previews de iTunes SIN
 * agotar el rate-limit de Apple (responde 403 al martillearlo). Llama al
 * servidor local (/api/artists/preview), que aplica el mismo filtro que la
 * app, con ritmo lento y reintentos con espera creciente. Pensado para
 * alimentar el batch de ASR:
 *
 *   node scripts/enumerar-previews.js               # catálogo completo
 *   node scripts/enumerar-previews.js --reintentar  # solo los que fallaron
 *   node scripts/enumerar-previews.js --ritmo 7000  # ms entre artistas
 *
 * Salida (resumible: se corta y se sigue donde quedó):
 *   scripts/catalogo-previews.json → { artistas: {...}, tracks: [pistas] }
 *
 * Luego, en paralelo (sin tocar iTunes):
 *   python scripts/alinear-previews.py --archivo scripts/catalogo-previews.json \
 *     --salida scripts/trabajos-a.json --modelo tiny
 */
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:8080";
const FICHERO = path.join(__dirname, "catalogo-previews.json");
const ESPERAS = [45000, 90000, 180000]; // espera tras el intento 1, 2 y 3

const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
};
const RITMO = Number(arg("--ritmo", "5000"));
const REINTENTAR = process.argv.includes("--reintentar");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function cargar() {
  if (!fs.existsSync(FICHERO)) return { artistas: {}, tracks: [] };
  const d = JSON.parse(fs.readFileSync(FICHERO, "utf8"));
  return { artistas: d.artistas || {}, tracks: d.tracks || [] };
}

function guardar(estado, porId) {
  estado.tracks = [...porId.values()];
  const tmp = FICHERO + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 1), "utf8");
  fs.renameSync(tmp, FICHERO);
}

async function main() {
  const estado = cargar();
  const porId = new Map(estado.tracks.map((t) => [String(t.trackId), t]));

  const cat = await fetchJson(`${BASE}/api/artists`);
  if (!cat || !cat.ok) {
    console.error("No puedo leer el catálogo del servidor local.");
    process.exit(1);
  }
  const nombres = cat.artists.map((a) => a.name).filter(Boolean);
  const pendientes = nombres.filter((n) => {
    const previo = estado.artistas[n];
    if (REINTENTAR) return previo && previo.fallo;
    return !previo;
  });
  console.log(
    `${nombres.length} artistas en el catálogo, ${pendientes.length} por enumerar ` +
      `(ya hay ${porId.size} pistas, ${Object.keys(estado.artistas).length} artistas hechos).`
  );

  let fallosNuevos = 0;
  for (let i = 0; i < pendientes.length; i++) {
    const nombre = pendientes[i];
    let tr = null;
    for (let intento = 0; intento <= ESPERAS.length; intento++) {
      if (intento > 0) {
        const espera = ESPERAS[intento - 1];
        console.log(`    reintento ${intento}/${ESPERAS.length} en ${espera / 1000} s…`);
        await sleep(espera);
      }
      try {
        const d = await fetchJson(
          `${BASE}/api/artists/preview?artist=${encodeURIComponent(nombre)}`
        );
        if (d && d.ok) {
          tr = d.tracks || [];
          break;
        }
      } catch (_) {
        /* servidor reiniciando o iTunes caído: reintentamos */
      }
    }
    if (tr) {
      tr.forEach((t) => porId.set(String(t.trackId), t));
      estado.artistas[nombre] = { n: tr.length };
      console.log(`  [${i + 1}/${pendientes.length}] ${nombre}: ${tr.length} pistas`);
    } else {
      estado.artistas[nombre] = { fallo: 1 };
      fallosNuevos++;
      console.log(`  [${i + 1}/${pendientes.length}] ${nombre}: FALLO (queda para --reintentar)`);
    }
    guardar(estado, porId);
    await sleep(RITMO + Math.floor(Math.random() * 1500));
  }

  const fallos = Object.entries(estado.artistas)
    .filter(([, v]) => v.fallo)
    .map(([k]) => k);
  console.log(
    `Listo: ${porId.size} pistas de ${Object.keys(estado.artistas).length} artistas → ${FICHERO}` +
      (fallos.length ? ` | ${fallos.length} artistas fallidos (repite con --reintentar)` : "")
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
