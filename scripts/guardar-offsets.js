/**
 * Sube un JSON de offsets a Firestore (colección `preview_offsets`, un
 * documento por trackId) para que /api/lyrics devuelva `previewOffset`.
 *
 * El JSON lo genera el script de ASR: python scripts/alinear-previews.py
 * (usa --salida para trabajar en paralelo; luego --fichero aquí para subir
 * cada worker o el fichero principal).
 *
 * Uso:
 *   node scripts/guardar-offsets.js            # sube los que falten
 *   node scripts/guardar-offsets.js --fuerza   # recalcula también los existentes
 *   node scripts/guardar-offsets.js --limite 50
 *   node scripts/guardar-offsets.js --fichero ruta/workers-a.json
 *
 * Al subir, borra los documentos equivalentes de `preview_offsets_pending`
 * (la cola que el servidor va apuntando cuando falta un offset).
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("../firebase-key.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const COL = "preview_offsets";
const PEND_COL = "preview_offsets_pending";
const FICHERO_DEFECTO = path.join(__dirname, "preview-offsets.json");

async function main() {
  const fuerza = process.argv.includes("--fuerza");
  const li = process.argv.indexOf("--limite");
  const limite = li >= 0 ? Number(process.argv[li + 1]) || 0 : 0;
  const fi = process.argv.indexOf("--fichero");
  const fichero = fi >= 0 && process.argv[fi + 1] ? process.argv[fi + 1] : FICHERO_DEFECTO;

  if (!fs.existsSync(fichero)) {
    console.error(`No existe ${fichero}. Ejecuta antes: python scripts/alinear-previews.py`);
    process.exit(1);
  }
  const tabla = JSON.parse(fs.readFileSync(fichero, "utf8"));
  let filas = Object.values(tabla);
  if (limite > 0) filas = filas.slice(0, limite);
  if (!filas.length) {
    console.log("El JSON está vacío, nada que subir.");
    return;
  }

  // Sin --fuerza solo subimos los trackId que aún no están en Firestore.
  const existentes = new Set();
  if (!fuerza) {
    const CHUNK = 400; // el tope de Firestore por batch es 500
    for (let i = 0; i < filas.length; i += CHUNK) {
      const refs = filas.slice(i, i + CHUNK).map((f) => db.collection(COL).doc(String(f.trackId)));
      const docs = await db.getAll(...refs);
      docs.forEach((d) => {
        if (d.exists && typeof d.data().offset === "number") existentes.add(d.id);
      });
    }
  }

  const pendientes = filas.filter((f) => !existentes.has(String(f.trackId)));
  console.log(`${filas.length} en el JSON, ${pendientes.length} por subir (fuerza=${fuerza}).`);

  const CHUNK = 400;
  let subidos = 0;
  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const lote = pendientes.slice(i, i + CHUNK);
    const batch = db.batch();
    lote.forEach((f) => {
      batch.set(
        db.collection(COL).doc(String(f.trackId)),
        {
          trackId: f.trackId,
          track: f.track || "",
          artist: f.artist || "",
          album: f.album || "",
          offset: f.offset,
          confidence: typeof f.confidence === "number" ? f.confidence : null,
          votes: typeof f.votes === "number" ? f.votes : null,
          durationMs: f.durationMs || 0,
          updatedAt: f.updatedAt || new Date().toISOString(),
        },
        { merge: true }
      );
    });
    await batch.commit();
    subidos += lote.length;
    console.log(`  lote ${Math.floor(i / CHUNK) + 1}: ${lote.length} documentos`);
  }

  // La cola de pendientes ya no hace falta para estas pistas.
  let borrados = 0;
  for (let i = 0; i < pendientes.length; i += CHUNK) {
    const batch = db.batch();
    pendientes.slice(i, i + CHUNK).forEach((f) => {
      batch.delete(db.collection(PEND_COL).doc(String(f.trackId)));
    });
    await batch.commit();
    borrados += Math.min(CHUNK, pendientes.length - i);
  }
  console.log(`Listo: ${subidos} offsets en "${COL}", ${borrados} pendientes limpiados.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
