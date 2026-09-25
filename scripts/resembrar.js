/**
 * Resembrar artistas rápido para la demo (merge: nunca borra).
 *
 * Uso:
 *   node scripts/resembrar.js
 *
 * Recorre la lista de ~100 nombres, los trae de TheAudioDB en lotes
 * de 8 y los guarda en Firestore con batch. Tarda 1-3 minutos.
 */
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = require("../firebase-key.json");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const NOMBRES = [
  "Metallica","Queen","Nirvana","Muse","Coldplay","AC/DC",
  "The Beatles","Pink Floyd","Radiohead","Oasis","Blur",
  "Green Day","Linkin Park","Foo Fighters","Pearl Jam",
  "Red Hot Chili Peppers","U2","Bon Jovi","Aerosmith",
  "The Rolling Stones","Iron Maiden","Black Sabbath",
  "Deep Purple","Kiss","Journey","Europe","Scorpions",
  "Ghost","Evanescence","Paramore","The Killers",
  "Arctic Monkeys","The Strokes","Imagine Dragons",
  "Maroon 5","OneRepublic","Mecano",
  "Heroes del Silencio","Extremoduro","Marea",
  "Fito & Fitipaldis","Jarabe de Palo","Dover",
  "The Cure","The Doors","The Clash","Ramones",
  "Sex Pistols","Blink-182","Sum 41","Simple Plan",
  "Rammstein","System Of A Down","Korn","Slipknot",
  "Megadeth","Slayer","Anthrax","Pantera",
  "Dream Theater","Nightwish","Within Temptation",
  "Epica","Sabaton","Volbeat","Placebo",
  "Keane","Snow Patrol","Franz Ferdinand",
  "Kings of Leon","The White Stripes","Interpol",
  "Editors","Kasabian","The Fratellis","The Smiths",
  "Depeche Mode","New Order","INXS","Simple Minds",
  "Toto","Foreigner","REO Speedwagon","Boston",
  "Supertramp","Yes","Genesis","Camel",
  "Rush","Dire Straits","The Police",
  "Whitesnake","Mr. Big","Accept","Helloween",
  "Blind Guardian","Avantasia","Alanis Morissette",
  "Garbage","The Cranberries","No Doubt",
  "Skillet","Breaking Benjamin","Three Days Grace",
  "Shinedown","Papa Roach","Thirty Seconds To Mars",
];

const norm = (s) =>
  (s || "").toString().trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function traer(nombre) {
  try {
    const r = await fetch(
      `https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(nombre)}`
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (data.artists || []).map((a) => ({
      id: String(a.idArtist),
      name: a.strArtist || nombre,
      nameLower: norm(a.strArtist),
      genre: a.strGenre || "Desconocido",
      country: a.strCountry || "Desconocido",
      image: a.strArtistThumb || "",
      updatedAt: new Date().toISOString(),
    }));
  } catch (_) {
    return [];
  }
}

async function main() {
  let total = 0;
  for (let i = 0; i < NOMBRES.length; i += 8) {
    const lote = NOMBRES.slice(i, i + 8);
    const res = await Promise.all(lote.map(traer));
    const batch = db.batch();
    let n = 0;
    for (const a of res.flat()) {
      batch.set(db.collection("artists").doc(a.id), a, { merge: true });
      n++;
    }
    if (n > 0) await batch.commit();
    total += n;
    console.log(`${Math.min(i + 8, NOMBRES.length)}/${NOMBRES.length} nombres -> ${total} artistas`);
  }
  console.log(`Listo: ${total} artistas guardados (merge, sin borrar).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
