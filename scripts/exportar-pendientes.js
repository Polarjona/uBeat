/**
 * Exporta la cola `preview_offsets_pending` (pistas sin offset que la app ha
 * pedido reproducir) a un JSON para alinearlas con ASR:
 *
 *   node scripts/exportar-pendientes.js
 *   python scripts/alinear-previews.py --archivo scripts/preview-pendientes.json
 *   node scripts/guardar-offsets.js --fichero scripts/preview-pendientes.json
 *     (sube los offsets y limpia los pendientes ya resueltos)
 *
 * Opcional: --min-misses N (solo pistas pedidas ≥ N veces, por defecto 1).
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("../firebase-key.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const FICHERO = path.join(__dirname, "preview-pendientes.json");

async function main() {
  const mi = process.argv.indexOf("--min-misses");
  const minMisses = mi >= 0 ? Number(process.argv[mi + 1]) || 1 : 1;

  const snap = await db.collection("preview_offsets_pending").get();
  const filas = snap.docs
    .map((d) => d.data())
    .filter((r) => r.trackId && r.title && (r.misses || 1) >= minMisses)
    .sort((a, b) => (b.misses || 1) - (a.misses || 1))
    .map((r) => ({
      trackId: r.trackId,
      track: r.title || "",
      artist: r.artist || "",
      album: r.album || "",
      durationMs: r.durationMs || 0,
      previewUrl: "", // alinear-previews.py la trae de iTunes por trackId
      misses: r.misses || 1,
    }));

  fs.writeFileSync(FICHERO, JSON.stringify(filas, null, 1), "utf8");
  console.log(`${filas.length} pistas pendientes exportadas a ${FICHERO}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
