/**
 * Migra la colección "artists" entre dos proyectos Firebase.
 *
 * Uso:
 *   node scripts/migrar.js <ruta-clave-origen.json>
 *
 * La clave destino es siempre ./firebase-key.json. Merge, no borra.
 */
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const oldKey = require(process.argv[2]);
const newKey = require("../firebase-key.json");

const oldApp = initializeApp({ credential: cert(oldKey) }, "origen");
const newApp = initializeApp({ credential: cert(newKey) }, "destino");

async function main() {
  const src = await getFirestore(oldApp).collection("artists").get();
  console.log(`Origen: ${src.size} artistas`);
  const dst = getFirestore(newApp).collection("artists");
  let n = 0;
  for (let i = 0; i < src.docs.length; i += 400) {
    const batch = getFirestore(newApp).batch();
    src.docs.slice(i, i + 400).forEach((d) => batch.set(dst.doc(d.id), d.data(), { merge: true }));
    await batch.commit();
    n += Math.min(400, src.docs.length - i);
    console.log(`Migrados: ${n}/${src.docs.length}`);
  }
  const check = await dst.count().get();
  console.log(`Destino ahora: ${check.data().count} artistas`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
