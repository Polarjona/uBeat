/**
 * Vaciar colecciones para la demo (día de la presentación).
 *
 * Uso:
 *   node scripts/vaciar.js artistas   -> borra TODOS los artistas
 *   node scripts/vaciar.js todo       -> artistas + likes + song_likes + playlists
 * Sin argumento no borra nada (muestra ayuda).
 *
 * Tras vaciar, la propia app rellena sola: la home importa tendencias
 * y cada búsqueda guarda su artista automáticamente.
 */
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("../firebase-key.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function vaciarColeccion(nombre) {
  const snap = await db.collection(nombre).get();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    n += Math.min(400, snap.docs.length - i);
    console.log(`${nombre}: ${n}/${snap.docs.length}`);
  }
  return snap.size;
}

async function main() {
  const que = process.argv[2];
  if (que !== "artistas" && que !== "todo") {
    console.log("Uso: node scripts/vaciar.js artistas|todo");
    process.exit(1);
  }
  await vaciarColeccion("artists");
  if (que === "todo") {
    await vaciarColeccion("likes");
    await vaciarColeccion("song_likes");
    const pls = await db.collection("playlists").get();
    for (const p of pls.docs) {
      const sg = await p.ref.collection("songs").get();
      const b = db.batch();
      sg.docs.forEach((x) => b.delete(x.ref));
      b.delete(p.ref);
      await b.commit();
    }
    console.log(`playlists: ${pls.size} borradas`);
  }
  console.log("Listo.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
