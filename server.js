/**
 * Artistas App — Backend (parte del patrón MVC)
 * ------------------------------------------------
 * Rol en MVC: MODELO + CONTROLADOR del lado servidor.
 *  - Expone una API REST consumible desde el frontend React
 *    y desde Postman.
 *  - Flujo de búsqueda (requisito principal):
 *      1. Busca el nombre en Firestore (colección "artists").
 *      2. Si NO existe -> llama a TheAudioDB, guarda el resultado
 *         en Firestore automáticamente y lo devuelve.
 *      3. Si no existe en ningún sitio -> 404.
 *
 * Sin permisos de administrador: basta con `npm install` y
 * `npm start` (Node portable sirve).
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

try {
  require("dotenv").config();
} catch (_) {
  // dotenv es opcional
}

// ---------- Config ----------
const PORT = process.env.PORT || 8080;
const COLLECTION = process.env.FIRESTORE_COLLECTION || "artists";
const SEED_PATH = path.join(__dirname, "artists.seed.json");
const KEY_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__dirname, "firebase-key.json");
const SECRETS_PATH = path.join(__dirname, "secrets.json");

// ---------- Estado Firebase ----------
let admin = null;
let db = null;
let firestoreReady = false;

function initFirebase() {
  try {
    if (!fs.existsSync(KEY_PATH)) {
      console.warn(
        `[API] firebase-key.json no encontrado en ${KEY_PATH}. ` +
          "Modo LOCAL: se usará artists.seed.json + TheAudioDB (sin guardar en Firestore)."
      );
      return;
    }
    admin = require("firebase-admin");
    const { getFirestore } = require("firebase-admin/firestore");
    const serviceAccount = require(KEY_PATH);
    const credential =
      admin.credential && admin.credential.cert
        ? admin.credential.cert(serviceAccount)
        : admin.cert(serviceAccount);
    admin.initializeApp({ credential });
    db = getFirestore();
    firestoreReady = true;
    console.log("[API] Conectado a Firestore correctamente.");
  } catch (err) {
    console.warn("[API] No se pudo iniciar Firestore, modo LOCAL.", err.message);
    firestoreReady = false;
    db = null;
  }
}

// ---------- Utilidades ----------
function norm(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeAudioDbArtist(a) {
  const name = a.strArtist || "Desconocido";
  return {
    id: String(a.idArtist || name),
    name,
    nameLower: norm(name),
    genre: a.strGenre || "Desconocido",
    country: a.strCountry || "Desconocido",
    image: a.strArtistThumb || "",
    updatedAt: new Date().toISOString(),
  };
}

function loadSeed() {
  try {
    const raw = fs.readFileSync(SEED_PATH, "utf8");
    return JSON.parse(raw).map((a) => ({
      id: String(a.id ?? a.name),
      name: a.name || "Desconocido",
      nameLower: norm(a.name),
      genre: a.genre || "Desconocido",
      country: a.country || "Desconocido",
      website: a.website || "",
      image: a.image || "",
    }));
  } catch (_) {
    return [];
  }
}

async function fetchFromAudioDb(name) {
  const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(
    name
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TheAudioDB HTTP ${res.status}`);
  const data = await res.json();
  if (!data.artists) return [];
  return data.artists.map(normalizeAudioDbArtist);
}

// ---------- Acceso a datos (Modelo servidor) ----------
// Escanea TODA la colección (116 docs aprox.): así se usan todos los artistas.
async function searchFirestore(query) {
  const q = norm(query);
  const snap = await db.collection(COLLECTION).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return all.filter((a) => norm(a.name || "").includes(q));
}

async function saveArtists(artists) {
  const batch = db.batch();
  for (const a of artists) {
    const ref = db.collection(COLLECTION).doc(String(a.id));
    batch.set(
      ref,
      {
        id: String(a.id),
        name: a.name,
        nameLower: norm(a.name),
        genre: a.genre || "Desconocido",
        country: a.country || "Desconocido",
        image: a.image || "",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

// Devuelve TODOS los artistas de la colección, ordenados A–Z.
async function listAllFirestore() {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
}

// Filtro AND: si se pide país y género, el artista debe cumplir AMBOS.
// La comparación ignora mayúsculas y acentos.
function applyAndFilter(artists, { country, genre }) {
  const c = norm(country);
  const g = norm(genre);
  return (artists || []).filter((a) => {
    if (c && norm(a.country) !== c) return false;
    if (g && norm(a.genre) !== g) return false;
    return true;
  });
}

// Valores únicos para rellenar el desplegable de filtros.
async function distinctValues() {
  const snap = await db.collection(COLLECTION).get();
  const cs = new Set();
  const gs = new Set();
  snap.docs.forEach((d) => {
    const v = d.data();
    if (v.country) cs.add(v.country);
    if (v.genre) gs.add(v.genre);
  });
  const sortEs = (x, y) => x.localeCompare(y, "es");
  return {
    countries: [...cs].sort(sortEs),
    genres: [...gs].sort(sortEs),
  };
}
// Rellena campos que el script de importación original no guardó
// (nameLower...). Solo añade lo que falta (merge), no borra nada.
// Nota: las webs de artistas no se guardan por decisión del proyecto.
async function backfillMissing() {
  const snap = await db.collection(COLLECTION).get();
  let checked = 0;
  let updated = 0;
  const failed = [];
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    checked++;
    if (d.nameLower) continue;
    try {
      const fresh = await fetchFromAudioDb(d.name || doc.id);
      const match =
        fresh.find((a) => String(a.id) === doc.id) || fresh[0];
      if (!match) {
        failed.push(d.name || doc.id);
        continue;
      }
      const patch = {};
      if (!d.nameLower) patch.nameLower = norm(d.name);
      if (!d.genre && match.genre !== "Desconocido") patch.genre = match.genre;
      if ((!d.country || d.country === "Desconocido") && match.country !== "Desconocido")
        patch.country = match.country;
      if (!d.image && match.image) patch.image = match.image;
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date().toISOString();
        batch.set(doc.ref, patch, { merge: true });
        ops++;
        updated++;
        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
    } catch (_) {
      failed.push(d.name || doc.id);
    }
  }
  if (ops > 0) await batch.commit();
  return { checked, updated, failed };
}

// Lógica principal: buscar, y si falta -> importar y guardar.
async function searchOrImport(name) {
  const q = (name || "").trim();
  if (!q) {
    const err = new Error("Falta el parámetro de búsqueda.");
    err.status = 400;
    throw err;
  }

  // 1) Intentar Firestore
  if (firestoreReady) {
    const found = await searchFirestore(q);
    if (found.length > 0) return { artists: found, source: "firestore" };

    // 2) No está -> TheAudioDB + autoguardado
    const fresh = await fetchFromAudioDb(q);
    if (fresh.length === 0) {
      const err = new Error(`Artista "${q}" no encontrado.`);
      err.status = 404;
      throw err;
    }
    await saveArtists(fresh);
    console.log(`[API] "${q}" no estaba en Firestore: importado y guardado (${fresh.length}).`);
    return { artists: fresh, source: "theaudiodb (guardado en firestore)" };
  }

  // Modo LOCAL sin Firestore: semilla + TheAudioDB (sin persistencia)
  const seed = loadSeed().filter((a) => a.nameLower.includes(norm(q)));
  if (seed.length > 0) return { artists: seed, source: "local-seed" };
  const fresh = await fetchFromAudioDb(q);
  if (fresh.length === 0) {
    const err = new Error(`Artista "${q}" no encontrado.`);
    err.status = 404;
    throw err;
  }
  return { artists: fresh, source: "theaudiodb (modo local, sin firestore)" };
}

// ---------- App Express ----------
initFirebase();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, firestore: firestoreReady, collection: COLLECTION });
});

app.get("/api/artists/count", async (req, res) => {
  try {
    if (!firestoreReady)
      return res.json({ ok: true, total: loadSeed().length, source: "local-seed" });
    const snap = await db.collection(COLLECTION).count().get();
    res.json({ ok: true, total: snap.data().count, source: "firestore" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/artists/filters", async (req, res) => {
  try {
    if (!firestoreReady) {
      const seed = loadSeed();
      const uniq = (k) =>
        [...new Set(seed.map((a) => a[k]).filter(Boolean))].sort((x, y) =>
          x.localeCompare(y, "es")
        );
      return res.json({
        ok: true,
        countries: uniq("country"),
        genres: uniq("genre"),
        source: "local-seed",
      });
    }
    const f = await distinctValues();
    res.json({ ok: true, ...f, source: "firestore" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/artists", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const country = (req.query.country || "").trim();
    const genre = (req.query.genre || "").trim();
    const filters = { country, genre };
    if (search) {
      const result = await searchOrImport(search);
      result.artists = applyAndFilter(result.artists, filters);
      return res.json({ ok: true, query: search, filters, ...result });
    }
    // Sin búsqueda: devolver TODOS los artistas (o `limit`/`offset` si se piden,
    // para el scroll infinito), aplicando el filtro AND cuando se indique.
    const limit = Number(req.query.limit) || 0;
    const offset = Number(req.query.offset) || 0;
    if (firestoreReady) {
      const all = await listAllFirestore();
      const filtered = applyAndFilter(all, filters);
      const slice = limit > 0 ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
      if (all.length > 0)
        return res.json({
          ok: true,
          artists: slice,
          total: filtered.length,
          filters,
          source: "firestore",
        });
    }
    const seed = applyAndFilter(loadSeed(), filters);
    const slice = limit > 0 ? seed.slice(0, limit) : seed;
    return res.json({ ok: true, artists: slice, total: seed.length, filters, source: "local-seed" });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ---------- Rankings de popularidad (iTunes RSS) ----------
// Populares globales (US) y por oyentes españoles (ES). Si el artista
// del ranking no está en Firestore, se importa de TheAudioDB y se
// guarda (misma filosofía de autoguardado). Caché en memoria de 1 h.
const chartsCache = {};

async function chartArtists(storefront, limit = 20) {
  const key = String(storefront).toUpperCase();
  const now = Date.now();
  if (chartsCache[key] && now - chartsCache[key].at < 3600e3)
    return chartsCache[key].data;

  const r = await fetch(
    `https://itunes.apple.com/${key.toLowerCase()}/rss/topsongs/limit=100/json`
  );
  if (!r.ok) throw new Error(`Charts HTTP ${r.status}`);
  const j = await r.json();
  const names = [
    ...new Set(
      (j.feed.entry || [])
        .map((e) => e["im:artist"] && e["im:artist"].label)
        .filter(Boolean)
    ),
  ];

  const snap = await db.collection(COLLECTION).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Partes de colaboraciones ("A & B", "A, B", "A feat. B"...).
  const splitParts = (nm) =>
    String(nm)
      .split(/\s*,\s*|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+con\s+|\s+with\s+|\s+x\s+|\s*\/\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);

  // Emparejamiento ESTRICTO: igualdad exacta (sin includes) con el nombre
  // completo o con cada parte. Evita falsos como Prince<-Prince Royce.
  const findLocal = (nm) => {
    const cands = [nm, ...splitParts(nm)].map(norm).filter(Boolean);
    for (const n of cands) {
      const hit = docs.find((a) => norm(a.name) === n);
      if (hit) return hit;
    }
    return null;
  };

  const out = [];
  for (let i = 0; i < names.length && out.length < limit; i += 8) {
    const batch = await Promise.all(
      names.slice(i, i + 8).map(async (nm, k) => {
        const rank = i + k + 1; // posición REAL en el ranking
        try {
          let a = findLocal(nm);
          if (!a) {
            const fresh = await fetchFromAudioDb(nm);
            const cands = [nm, ...splitParts(nm)].map(norm).filter(Boolean);
            const m = fresh.find((f) => cands.includes(norm(f.name)));
            if (!m) return null;
            await saveArtists([m]);
            docs.push(m);
            a = m;
          }
          return { artist: a, rank };
        } catch (_) {
          return null;
        }
      })
    );
    for (const hit of batch) {
      if (
        hit &&
        out.length < limit &&
        !out.some((x) => String(x.id) === String(hit.artist.id))
      ) {
        out.push({ ...hit.artist, chartPos: hit.rank });
      }
    }
  }

  chartsCache[key] = { at: now, data: out };
  return out;
}

app.get("/api/charts", async (req, res) => {
  try {
    const sf = String(req.query.storefront || "US").toUpperCase();
    if (!["US", "ES"].includes(sf))
      return res.status(400).json({ ok: false, error: "storefront: US o ES." });
    if (!firestoreReady)
      return res.status(400).json({ ok: false, error: "Sin Firestore (modo local)." });
    const data = await chartArtists(sf, Math.min(Number(req.query.limit) || 20, 20));
    res.json({ ok: true, storefront: sf, artists: data, source: "itunes-charts" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Auth con Firebase Authentication ----------
// El login/registro/reset lo gestiona Firebase en el cliente; aquí solo
// se verifica el ID token (Bearer) para identificar al usuario.
const LIKES_COL = "likes";
const { getAuth } = require("firebase-admin/auth");

async function authUid(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return null;
  try {
    const decoded = await getAuth().verifyIdToken(m[1]);
    return decoded.uid;
  } catch (_) {
    return null;
  }
}

async function meFromUid(uid) {
  try {
    const u = await getAuth().getUser(uid);
    return {
      id: u.uid,
      name: u.displayName || String(u.email || "").split("@")[0],
      email: u.email || "",
    };
  } catch (_) {
    return null;
  }
}

app.get("/api/me", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "No autenticado." });
    const me = await meFromUid(uid);
    if (!me) return res.status(401).json({ ok: false, error: "No autenticado." });
    res.json({ ok: true, user: me });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// (registro/login/logout: los gestiona Firebase Authentication en el cliente)

// (login: Firebase Authentication en el cliente)

// (logout: Firebase Authentication en el cliente)

// (recuperación: la envía Firebase por email con enlace)

// (recuperación por email: la gestiona Firebase Authentication)

// ---------- reCAPTCHA v3 (solo login) ----------
// El secreto vive en secrets.json (gitignored) o env RECAPTCHA_SECRET.
function recaptchaSecret() {
  if (process.env.RECAPTCHA_SECRET) return process.env.RECAPTCHA_SECRET;
  try {
    const s = require(SECRETS_PATH);
    return s.recaptchaSecret || "";
  } catch (_) {
    return "";
  }
}

app.post("/api/auth/captcha", async (req, res) => {
  try {
    const secret = recaptchaSecret();
    if (!secret)
      return res.status(503).json({ ok: false, error: "Captcha no configurado." });
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "Falta el token." });
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await r.json();
    if (!data.success || Number(data.score || 0) < 0.5 || data.action !== "login") {
      const info = JSON.stringify({ success: data.success, score: data.score, action: data.action, codes: data["error-codes"] });
      console.warn("[captcha] rechazo:", info);
      try {
        fs.appendFileSync(
          path.join(__dirname, "server-debug.log"),
          `[${new Date().toISOString()}] [captcha] rechazo: ${info}\n`
        );
      } catch (_) {}
      return res.status(403).json({ ok: false, error: "Verificación humana fallida." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Me gusta ----------
app.post("/api/likes", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const artistId = String(req.body.artistId || "").trim();
    if (!artistId) return res.status(400).json({ ok: false, error: "Falta artistId." });
    const likeId = `${uid}_${artistId}`;
    const ref = db.collection(LIKES_COL).doc(likeId);
    const cur = await ref.get();
    if (cur.exists) {
      await ref.delete();
      return res.json({ ok: true, liked: false });
    }
    const a = await db.collection(COLLECTION).doc(artistId).get();
    if (!a.exists)
      return res.status(404).json({ ok: false, error: "Artista no encontrado." });
    const v = a.data();
    await ref.set({
      uid,
      artistId,
      name: v.name || "",
      genre: v.genre || "Desconocido",
      country: v.country || "Desconocido",
      image: v.image || "",
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, liked: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/likes/ids", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s = await db.collection(LIKES_COL).where("uid", "==", uid).get();
    res.json({ ok: true, ids: s.docs.map((d) => d.data().artistId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/likes", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    // Sin orderBy (evita exigir un índice compuesto): se ordena en memoria.
    const s = await db.collection(LIKES_COL).where("uid", "==", uid).get();
    const favs = s.docs
      .map((d) => ({ id: d.data().artistId, ...d.data() }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.json({ ok: true, artists: favs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/artists/:id/likes", async (req, res) => {
  try {
    const s = await db
      .collection(LIKES_COL)
      .where("artistId", "==", String(req.params.id))
      .count()
      .get();
    res.json({ ok: true, total: s.data().count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Me gusta en canciones ----------
const SONGLIKES_COL = "song_likes";

app.post("/api/song-likes", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const b = req.body || {};
    const trackId = String(b.trackId || "").trim();
    if (!trackId || !b.previewUrl)
      return res.status(400).json({ ok: false, error: "Faltan datos de la canción." });
    const likeId = `${uid}_${trackId}`;
    const ref = db.collection(SONGLIKES_COL).doc(likeId);
    const cur = await ref.get();
    if (cur.exists) {
      await ref.delete();
      return res.json({ ok: true, liked: false });
    }
    await ref.set({
      uid,
      trackId,
      track: String(b.track || "Sin título"),
      artist: String(b.artist || ""),
      album: String(b.album || ""),
      artwork: String(b.artwork || ""),
      previewUrl: String(b.previewUrl),
      durationMs: Number(b.durationMs) || 30000,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, liked: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/song-likes/ids", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s = await db.collection(SONGLIKES_COL).where("uid", "==", uid).get();
    res.json({ ok: true, ids: s.docs.map((d) => d.data().trackId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/song-likes", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    // Sin orderBy (evita exigir un índice compuesto): se ordena en memoria.
    const s = await db.collection(SONGLIKES_COL).where("uid", "==", uid).get();
    const favs = s.docs
      .map((d) => ({ id: d.data().trackId, ...d.data() }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.json({ ok: true, songs: favs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Notas de artistas (0-10, por usuario) ----------
const RATINGS_COL = "ratings";

app.post("/api/ratings", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const artistId = String(req.body.artistId || "").trim();
    if (!artistId) return res.status(400).json({ ok: false, error: "Falta artistId." });
    const ref = db.collection(RATINGS_COL).doc(`${uid}_${artistId}`);
    const score = req.body.score;
    if (score === null || score === undefined || score === "") {
      await ref.delete();
      return res.json({ ok: true, score: null });
    }
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 10)
      return res.status(400).json({ ok: false, error: "La nota debe ser un entero de 0 a 10." });
    await ref.set(
      { uid, artistId, score: n, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    res.json({ ok: true, score: n });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/ratings/ids", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s = await db.collection(RATINGS_COL).where("uid", "==", uid).get();
    const ratings = {};
    s.docs.forEach((d) => {
      ratings[String(d.data().artistId)] = Number(d.data().score);
    });
    res.json({ ok: true, ratings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Playlists ----------
const PLAYLISTS_COL = "playlists";
const MAX_SONGS_PER_PLAYLIST = 200;

async function ownPlaylist(uid, pid) {
  const d = await db.collection(PLAYLISTS_COL).doc(String(pid)).get();
  if (!d.exists || d.data().uid !== uid) return null;
  return d;
}

// Crear playlist
app.post("/api/playlists", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const name = String(req.body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ ok: false, error: "Falta el nombre." });
    const ref = await db.collection(PLAYLISTS_COL).add({
      uid,
      name,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, playlist: { id: ref.id, name, count: 0 } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mis playlists (con nº de canciones)
app.get("/api/playlists", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s = await db.collection(PLAYLISTS_COL).where("uid", "==", uid).get();
    const list = [];
    for (const d of s.docs) {
      const sg = await d.ref.collection("songs").get();
      // Portada = primera canción añadida (la más antigua).
      const songs = sg.docs
        .map((x) => x.data())
        .sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || "")));
      list.push({
        id: d.id,
        name: d.data().name,
        createdAt: d.data().createdAt,
        count: songs.length,
        cover: songs.length ? songs[0].artwork || "" : "",
      });
    }
    list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    res.json({ ok: true, playlists: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Borrar playlist (con sus canciones)
app.delete("/api/playlists/:id", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const d = await ownPlaylist(uid, req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: "Playlist no encontrada." });
    const songs = await d.ref.collection("songs").get();
    const batch = db.batch();
    songs.docs.forEach((x) => batch.delete(x.ref));
    batch.delete(d.ref);
    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Canciones de una playlist
app.get("/api/playlists/:id/songs", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const d = await ownPlaylist(uid, req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: "Playlist no encontrada." });
    const s = await d.ref.collection("songs").get();
    const songs = s.docs
      .map((x) => ({ id: x.data().trackId, ...x.data() }))
      .sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
    res.json({ ok: true, songs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Añadir canción a una playlist
app.post("/api/playlists/:id/songs", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const d = await ownPlaylist(uid, req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: "Playlist no encontrada." });
    const b = req.body || {};
    const trackId = String(b.trackId || "").trim();
    if (!trackId || !b.previewUrl)
      return res.status(400).json({ ok: false, error: "Faltan datos de la canción." });
    const ref = d.ref.collection("songs").doc(trackId);
    if ((await ref.get()).exists) return res.json({ ok: true, added: false });
    const c = await d.ref.collection("songs").count().get();
    if (c.data().count >= MAX_SONGS_PER_PLAYLIST)
      return res.status(400).json({ ok: false, error: "Playlist llena (200)." });
    await ref.set({
      trackId,
      track: String(b.track || "Sin título"),
      artist: String(b.artist || ""),
      album: String(b.album || ""),
      artwork: String(b.artwork || ""),
      previewUrl: String(b.previewUrl),
      durationMs: Number(b.durationMs) || 30000,
      addedAt: new Date().toISOString(),
    });
    res.json({ ok: true, added: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Quitar canción de una playlist
app.delete("/api/playlists/:id/songs/:trackId", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const d = await ownPlaylist(uid, req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: "Playlist no encontrada." });
    await d.ref.collection("songs").doc(String(req.params.trackId)).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Tracking y recomendaciones ----------
// Solo usuarios con sesión. Gusto agregado por usuario+artista (acotado).
const TASTE_COL = "taste";
const PLAY_W = 1;
const LIKE_W = 3;
const SIM_W = 2;

function lastfmKey() {
  if (process.env.LASTFM_KEY) return process.env.LASTFM_KEY;
  try {
    return require(SECRETS_PATH).lastfmKey || "";
  } catch (_) {
    return "";
  }
}

// Similitud real (Last.fm) si hay clave; si no, mismo género/país.
async function similarIds(artist, allDocs) {
  const key = lastfmKey();
  if (key) {
    try {
      const now = Date.now();
      if (artist.similarAt && now - new Date(artist.similarAt).getTime() < 30 * 86400e3 && Array.isArray(artist.similar))
        return artist.similar;
      const r = await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist.name)}&api_key=${key}&format=json&limit=12`
      );
      const j = await r.json();
      const names = ((j.similarartists && j.similarartists.artist) || []).map((a) => norm(a.name));
      const ids = [];
      for (const n of names) {
        const hit = allDocs.find((d) => norm(d.name) === n);
        if (hit && String(hit.id) !== String(artist.id) && !ids.includes(String(hit.id)))
          ids.push(String(hit.id));
        if (ids.length >= 12) break;
      }
      await db.collection(COLLECTION).doc(String(artist.id)).set(
        { similar: ids, similarAt: new Date().toISOString() },
        { merge: true }
      );
      return ids;
    } catch (_) {}
  }
  return allDocs
    .filter(
      (d) =>
        String(d.id) !== String(artist.id) &&
        (norm(d.genre) === norm(artist.genre) || norm(d.country) === norm(artist.country))
    )
    .sort((a, b) =>
      norm(a.genre) === norm(artist.genre) && norm(b.genre) !== norm(artist.genre) ? -1 : 0
    )
    .slice(0, 12)
    .map((d) => String(d.id));
}

// POST /api/plays {artistId?, trackId?, track?, artist?} -> +1 escucha
app.post("/api/plays", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const b = req.body || {};
    let artistId = String(b.artistId || "").trim();
    if (!artistId && b.artist) {
      const n = norm(b.artist);
      const s = await db.collection(COLLECTION).get();
      const hit = s.docs.find((d) => norm(d.data().name) === n);
      if (hit) artistId = hit.id;
    }
    if (!artistId) return res.json({ ok: true, logged: false });
    const ref = db.collection(TASTE_COL).doc(`${uid}_${artistId}`);
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const plays = cur.exists ? Number(cur.data().plays || 0) + 1 : 1;
      tx.set(ref, { uid, artistId, plays, updatedAt: new Date().toISOString() }, { merge: true });
    });
    res.json({ ok: true, logged: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/for-you -> rail ponderado con motivos
app.get("/api/for-you", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const snap = await db.collection(COLLECTION).get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byId = new Map(all.map((a) => [String(a.id), a]));
    const [likesS, tasteS] = await Promise.all([
      db.collection(LIKES_COL).where("uid", "==", uid).get(),
      db.collection(TASTE_COL).where("uid", "==", uid).get(),
    ]);
    const likedIds = new Set(likesS.docs.map((d) => String(d.data().artistId)));
    const plays = new Map();
    tasteS.docs.forEach((d) => plays.set(String(d.data().artistId), Number(d.data().plays || 0)));
    if (!likedIds.size && !plays.size)
      return res.json({ ok: true, artists: [], cold: true, source: "taste" });

    const score = new Map();
    const reason = new Map();
    const add = (id, pts, why) => {
      if (!byId.has(String(id))) return;
      score.set(String(id), (score.get(String(id)) || 0) + pts);
      if (!reason.has(String(id))) reason.set(String(id), why);
    };
    likedIds.forEach((id) => {
      const a = byId.get(String(id));
      if (a) add(id, LIKE_W, `Porque te gusta ${a.name}`);
    });
    plays.forEach((n, id) => {
      const a = byId.get(String(id));
      if (a) add(id, Math.min(n, 10) * PLAY_W, `Porque escuchas a ${a.name}`);
    });
    // Expansión por similitud desde las 5 semillas con más señal.
    const seeds = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => byId.get(String(id)))
      .filter(Boolean);
    for (const s of seeds) {
      const sims = await similarIds(s, all);
      sims.forEach((sid, i) => add(sid, SIM_W / (i + 1), `Similar a ${s.name}`));
    }
    const ranked = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, pts]) => ({ ...byId.get(String(id)), score: Math.round(pts * 10) / 10, reason: reason.get(String(id)) }));
    res.json({ ok: true, artists: ranked, cold: false, source: lastfmKey() ? "taste+lastfm" : "taste" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Descubrir: feed infinito de canciones del algoritmo ----------
// Devuelve una página de canciones (vistas previas de iTunes) para artistas
// puntuados con el mismo algoritmo que /api/for-you (o catálogo si es frío).
const DISCOVER_PAGE_ARTISTS = 4;
const discoverRankCache = new Map(); // uid|guest -> { at, list }

async function discoverArtists(uid) {
  const key = uid || "guest";
  const hit = discoverRankCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.list;
  const snap = await db.collection(COLLECTION).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let list = all;
  if (uid) {
    const [likesS, tasteS] = await Promise.all([
      db.collection(LIKES_COL).where("uid", "==", uid).get(),
      db.collection(TASTE_COL).where("uid", "==", uid).get(),
    ]);
    const likedIds = new Set(likesS.docs.map((d) => String(d.data().artistId)));
    const plays = new Map();
    tasteS.docs.forEach((d) => plays.set(String(d.data().artistId), Number(d.data().plays || 0)));
    if (likedIds.size || plays.size) {
      const byId = new Map(all.map((a) => [String(a.id), a]));
      const score = new Map();
      const add = (id, pts) => {
        if (!byId.has(String(id))) return;
        score.set(String(id), (score.get(String(id)) || 0) + pts);
      };
      likedIds.forEach((id) => add(id, LIKE_W));
      plays.forEach((n, id) => add(id, Math.min(n, 10) * PLAY_W));
      const seeds = [...score.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => byId.get(String(id)))
        .filter(Boolean);
      for (const s of seeds) {
        const sims = await similarIds(s, all);
        sims.forEach((sid, i) => add(sid, SIM_W / (i + 1)));
      }
      const ranked = [...score.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(String(id)))
        .filter(Boolean);
      const rest = all.filter((a) => !score.has(String(a.id)));
      list = ranked.concat(rest);
    }
  }
  // Orden estable pseudoaleatorio para invitados (rotación por sesión).
  if (!uid) list = [...all].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  discoverRankCache.set(key, { at: Date.now(), list });
  return list;
}

async function itunesPreviewPage(artistNames) {
  const pages = await Promise.all(
    artistNames.map(async (name) => {
      try {
        const url =
          `https://itunes.apple.com/search?term=${encodeURIComponent(name)}` +
          `&entity=song&limit=5&country=ES`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const data = await r.json();
        return (data.results || [])
          .filter((t) => t.previewUrl)
          .map((t) => ({
            trackId: t.trackId,
            track: t.trackName || "Sin título",
            artist: t.artistName || name,
            album: t.collectionName || "",
            artwork: (t.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
            previewUrl: t.previewUrl,
            durationMs: t.trackTimeMillis || 30000,
            artistName: name,
          }));
      } catch (_) {
        return [];
      }
    })
  );
  return pages.flat();
}

app.get("/api/discover", async (req, res) => {
  try {
    const uid = await authUid(req);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const ranked = await discoverArtists(uid);
    if (!ranked.length) return res.json({ ok: true, songs: [], hasMore: false, offset: 0 });
    const slice = ranked.slice(offset, offset + DISCOVER_PAGE_ARTISTS);
    let songs = await itunesPreviewPage(slice.map((a) => a.name));
    // Rellena con la siguiente ventana si una página sale muy corta.
    let next = offset + slice.length;
    while (songs.length < 8 && next < ranked.length && slice.length > 0) {
      const more = ranked.slice(next, next + DISCOVER_PAGE_ARTISTS);
      const extra = await itunesPreviewPage(more.map((a) => a.name));
      songs = songs.concat(extra);
      next += more.length;
      if (!more.length) break;
    }
    const seen = new Set();
    songs = songs.filter((t) => {
      const k = String(t.trackId);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    res.json({ ok: true, songs, hasMore: next < ranked.length, offset: next });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Social: amistades ----------
// friendships: doc id "uidA_uidB" ordenado; {a, b, from, status, createdAt}
const FRIENDS_COL = "friendships";

function pairId(x, y) {
  return [String(x), String(y)].sort().join("_");
}

async function friendStatus(uid, other) {
  const d = await db.collection(FRIENDS_COL).doc(pairId(uid, other)).get();
  return d.exists ? d.data() : null;
}

// Solicitud por email (se resuelve a uid de Firebase Auth).
app.post("/api/friends/request", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "Falta el email." });
    let target;
    try {
      target = await getAuth().getUserByEmail(email);
    } catch (_) {
      return res.status(404).json({ ok: false, error: "No hay ningún usuario con ese email." });
    }
    if (target.uid === uid)
      return res.status(400).json({ ok: false, error: "No puedes añadirte a ti mismo." });
    const cur = await friendStatus(uid, target.uid);
    if (cur)
      return res.status(409).json({
        ok: false,
        error: cur.status === "accepted" ? "Ya sois amigos." : "Solicitud ya enviada.",
      });
    await db.collection(FRIENDS_COL).doc(pairId(uid, target.uid)).set({
      a: [uid, target.uid].sort()[0],
      b: [uid, target.uid].sort()[1],
      from: uid,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Aceptar (accept:true) o rechazar solicitud.
app.post("/api/friends/respond", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const from = String(req.body.from || "");
    const ref = db.collection(FRIENDS_COL).doc(pairId(uid, from));
    const d = await ref.get();
    if (!d.exists || d.data().status !== "pending" || d.data().from !== from || (d.data().a !== uid && d.data().b !== uid))
      return res.status(404).json({ ok: false, error: "Solicitud no encontrada." });
    if (req.body.accept) {
      await ref.set({ status: "accepted", respondedAt: new Date().toISOString() }, { merge: true });
      return res.json({ ok: true, accepted: true });
    }
    await ref.delete();
    res.json({ ok: true, accepted: false });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Eliminar amistad.
app.delete("/api/friends/:uid", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    await db.collection(FRIENDS_COL).doc(pairId(uid, req.params.uid)).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Amigos + solicitudes.
app.get("/api/friends", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s1 = await db.collection(FRIENDS_COL).where("a", "==", uid).get();
    const s2 = await db.collection(FRIENDS_COL).where("b", "==", uid).get();
    const all = [...s1.docs, ...s2.docs].map((d) => d.data());
    const otherOf = (f) => (f.a === uid ? f.b : f.a);
    const friends = all.filter((f) => f.status === "accepted").map(otherOf);
    const pendingIn = all.filter((f) => f.status === "pending" && f.from !== uid).map((f) => f.from);
    const pendingOut = all.filter((f) => f.status === "pending" && f.from === uid).map(otherOf);
    const need = [...new Set([...friends, ...pendingIn, ...pendingOut])];
    const names = {};
    for (let i = 0; i < need.length; i += 90) {
      const r = await getAuth().getUsers(need.slice(i, i + 90).map((x) => ({ uid: x })));
      r.users.forEach((u) =>
        names[u.uid] = {
          uid: u.uid,
          name: u.displayName || String(u.email || "").split("@")[0],
          email: u.email || "",
        }
      );
    }
    const pick = (arr) => arr.map((id) => names[id] || { uid: id, name: "Usuario", email: "" });
    res.json({ ok: true, friends: pick(friends), pendingIn: pick(pendingIn), pendingOut: pick(pendingOut) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Perfil (amigos aceptados, o uno mismo).
app.get("/api/friends/:uid/profile", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    if (String(req.params.uid) !== String(uid)) {
      const f = await friendStatus(uid, req.params.uid);
      if (!f || f.status !== "accepted")
        return res.status(403).json({ ok: false, error: "No sois amigos." });
    }
    const other = req.params.uid;
    const [la, ls, ts] = await Promise.all([
      db.collection(LIKES_COL).where("uid", "==", other).get(),
      db.collection(SONGLIKES_COL).where("uid", "==", other).get(),
      db.collection(TASTE_COL).where("uid", "==", other).get(),
    ]);
    let who = { uid: other, name: "Usuario", email: "" };
    try {
      const u = await getAuth().getUser(other);
      who = { uid: other, name: u.displayName || String(u.email || "").split("@")[0], email: u.email || "" };
    } catch (_) {}
    const byTime = (a, b) =>
      String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || ""));
    const artists = la.docs.map((d) => ({ id: d.data().artistId, ...d.data() })).sort(byTime);
    const songs = ls.docs.map((d) => ({ id: d.data().trackId, ...d.data() })).sort(byTime);
    const tops = ts.docs
      .map((d) => ({ artistId: String(d.data().artistId), plays: Number(d.data().plays || 0) }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    const snap = await db.collection(COLLECTION).get();
    const byId = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    res.json({
      ok: true,
      user: who,
      artists,
      songs,
      top: tops.map((t) => ({ ...(byId.get(t.artistId) || { id: t.artistId }), plays: t.plays })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Actividad reciente de amigos para el rail social.
app.get("/api/friends/activity", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const s1 = await db.collection(FRIENDS_COL).where("a", "==", uid).get();
    const s2 = await db.collection(FRIENDS_COL).where("b", "==", uid).get();
    const friends = [...s1.docs, ...s2.docs]
      .map((d) => d.data())
      .filter((f) => f.status === "accepted")
      .map((f) => (f.a === uid ? f.b : f.a))
      .slice(0, 20);
    if (!friends.length) return res.json({ ok: true, items: [] });
    const names = {};
    const r = await getAuth().getUsers(friends.map((x) => ({ uid: x })));
    r.users.forEach((u) => (names[u.uid] = u.displayName || String(u.email || "").split("@")[0]));
    const snap = await db.collection(COLLECTION).get();
    const byId = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    const items = [];
    for (const fid of friends) {
      const fname = names[fid] || "Un amigo";
      const [la, ls, ts] = await Promise.all([
        db.collection(LIKES_COL).where("uid", "==", fid).get(),
        db.collection(SONGLIKES_COL).where("uid", "==", fid).get(),
        db.collection(TASTE_COL).where("uid", "==", fid).get(),
      ]);
      const byTime = (a, b) =>
        String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || ""));
      la.docs.map((d) => d.data()).sort(byTime).slice(0, 3).forEach((v) => {
        const a = byId.get(String(v.artistId));
        if (a) items.push({ kind: "artist", at: v.createdAt || "", friend: fname, caption: `Le gusta a ${fname}`, ...a });
      });
      ls.docs.map((d) => d.data()).sort(byTime).slice(0, 3).forEach((v) => {
        items.push({ kind: "song", at: v.createdAt || "", friend: fname, caption: `Le gusta a ${fname}`, ...v });
      });
      ts.docs
        .map((d) => ({ id: String(d.data().artistId), plays: Number(d.data().plays || 0), at: d.data().updatedAt || "" }))
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 2)
        .forEach((t) => {
          const a = byId.get(t.id);
          if (a) items.push({ kind: "artist", at: t.at, friend: fname, caption: `En repeat de ${fname}`, ...a });
        });
    }
    items.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    res.json({ ok: true, items: items.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Vistas previas de audio (30 s, iTunes Search API, sin claves).
// Sirve de proxy para evitar problemas de CORS desde el navegador.
app.get("/api/artists/preview", async (req, res) => {
  try {
    const artist = (req.query.artist || "").trim();
    if (!artist)
      return res.status(400).json({ ok: false, error: "Falta ?artist=" });
    const url =
      `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}` +
      `&entity=song&limit=8&country=ES`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`iTunes HTTP ${r.status}`);
    const data = await r.json();
    const tracks = (data.results || [])
      .filter((t) => t.previewUrl)
      .map((t) => ({
        trackId: t.trackId,
        track: t.trackName || "Sin título",
        artist: t.artistName || artist,
        album: t.collectionName || "",
        artwork: (t.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
        previewUrl: t.previewUrl,
        durationMs: t.trackTimeMillis || 30000,
      }));
    res.json({ ok: true, artist, tracks, source: "itunes" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rellena nameLower que falte (lo crea el import original sin él).
app.post("/api/artists/backfill", async (req, res) => {
  try {
    if (!firestoreReady)
      return res.status(400).json({ ok: false, error: "Sin Firestore (modo local)." });
    const result = await backfillMissing();
    res.json({ ok: true, ...result, savedIn: "firestore" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint explícito para Postman: fuerza la importación desde TheAudioDB.
app.post("/api/artists/import", async (req, res) => {
  try {
    const name = (req.body.name || req.query.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "Envía { name }." });
    const fresh = await fetchFromAudioDb(name);
    if (fresh.length === 0)
      return res.status(404).json({ ok: false, error: `Artista "${name}" no encontrado.` });
    if (firestoreReady) {
      await saveArtists(fresh);
      return res.json({ ok: true, imported: fresh.length, artists: fresh, savedIn: "firestore" });
    }
    return res.json({ ok: true, imported: fresh.length, artists: fresh, savedIn: "ninguno (modo local)" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "No encontrado" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Artistas App en http://localhost:${PORT}`);
  console.log(`Modo Firestore: ${firestoreReady ? "ACTIVO" : "LOCAL (sin clave)"}`);
});
