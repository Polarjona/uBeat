/**
 * Artistas App — Backend (parte del patrón MVC)
 * ------------------------------------------------
 * Rol en MVC: MODELO + CONTROLADOR del lado servidor.
 *  - Expone una API REST consumible desde el frontend React
 *    y desde Postman.
 *  - Flujo de búsqueda (requisito principal):
 *      1. Busca el nombre en Firestore (colección "artists").
 *      2. Si NO existe -> llama a TheAudioDB (si TheAudioDB no lo tiene,
 *         usa el buscador de artistas de iTunes), guarda el resultado
 *         en Firestore automáticamente y lo devuelve.
 *      3. Si no existe en ningún sitio -> 404.
 *
 * Sin permisos de administrador: basta con `npm install` y
 * `npm start` (Node portable sirve).
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
    let serviceAccount = null;
    const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (jsonEnv) {
      serviceAccount = JSON.parse(jsonEnv);
    } else if (fs.existsSync(KEY_PATH)) {
      serviceAccount = require(KEY_PATH);
    } else {
      console.warn(
        `[API] firebase-key.json no encontrado en ${KEY_PATH}. ` +
          "Modo LOCAL: se usará artists.seed.json + TheAudioDB (sin guardar en Firestore)."
      );
      return;
    }
    admin = require("firebase-admin");
    const { getFirestore } = require("firebase-admin/firestore");
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

// Fuente principal: TheAudioDB (como siempre). Si TheAudioDB no tiene al
// artista (p. ej. "Ado") o su primer resultado no se parece al nombre
// buscado, se usa iTunes (misma fuente que los gráficos y las previews)
// para no dejar al artista fuera del catálogo.
async function fetchFromAudioDb(name) {
  const url = `https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(
    name
  )}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.artists && data.artists.length) {
        const list = data.artists.map(normalizeAudioDbArtist);
        if (list.some((a) => similar(a.name, name))) return list;
      }
    }
  } catch (_) {}
  return fetchFromItunesArtist(name);
}

function similar(name, q) {
  const n = norm(name);
  const t = norm(q);
  return n === t || n.includes(t) || t.includes(n);
}

async function fetchFromItunesArtist(name) {
  try {
    const r = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        name
      )}&entity=musicArtist&limit=3`
    );
    const j = await r.json();
    const hits = (j.results || []).filter((x) => similar(x.artistName, name));
    if (!hits.length) return [];
    const exact = hits.filter((x) => norm(x.artistName) === norm(name));
    const selected = [exact[0] || hits[0]];
    let image = "";
    try {
      const l = await fetch(
        `https://itunes.apple.com/lookup?id=${selected[0].artistId}&entity=album&limit=1`
      );
      const lj = await l.json();
      const art = (lj.results || []).find((x) => x.artworkUrl100);
      if (art) image = art.artworkUrl100.replace("100x100bb", "600x600bb");
    } catch (_) {}
    return selected.map((x) => ({
      id: String(x.artistId),
      name: x.artistName,
      nameLower: norm(x.artistName),
      genre: x.primaryGenreName || "Desconocido",
      country: "Desconocido",
      image,
      updatedAt: new Date().toISOString(),
    }));
  } catch (_) {
    return [];
  }
}

// ---------- Acceso a datos (Modelo servidor) ----------
// Caché en memoria de TODA la colección: al entrar en la página se
// disparaban ~5 escaneos completos de "artists" (lista, filtros, charts,
// Para ti, Descubrir...). TTL de 60 s + deduplicación de la petición en
// vuelo + invalidación al escribir. El comportamiento no cambia.
const ARTISTS_TTL_MS = 60e3;
let artistsCacheDocs = null;
let artistsCacheAt = 0;
let artistsCachePending = null;

function invalidateArtistsCache() {
  artistsCacheDocs = null;
  artistsCacheAt = 0;
}

async function allArtistsDocs() {
  const now = Date.now();
  if (artistsCacheDocs && now - artistsCacheAt < ARTISTS_TTL_MS) return artistsCacheDocs;
  if (artistsCachePending) return artistsCachePending;
  artistsCachePending = (async () => {
    const snap = await db.collection(COLLECTION).get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    artistsCacheDocs = docs;
    artistsCacheAt = Date.now();
    artistsCachePending = null;
    return docs;
  })().catch((e) => {
    artistsCachePending = null;
    throw e;
  });
  return artistsCachePending;
}

// Escanea TODA la colección (116 docs aprox.): así se usan todos los artistas.
async function searchFirestore(query) {
  const q = norm(query);
  const all = await allArtistsDocs();
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
  invalidateArtistsCache();
}

// Devuelve TODOS los artistas de la colección, ordenados A–Z.
async function listAllFirestore() {
  const all = await allArtistsDocs();
  return [...all].sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
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
  const docs = await allArtistsDocs();
  const cs = new Set();
  const gs = new Set();
  docs.forEach((v) => {
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
    const docs = await allArtistsDocs();
    res.json({ ok: true, total: docs.length, source: "firestore" });
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

  const docs = (await allArtistsDocs()).slice();

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

// ---------- Planes de suscripción ----------
// Colección "subscriptions" (doc id = uid): { plan, source, updatedAt }.
// Sin documento => plan gratuito (por defecto).
//   - free: todo excepto Social y el algoritmo (Para ti / Descubrir).
//   - pro:  3,99 €/mes, acceso total.
const SUBS_COL = "subscriptions";
const PRO_PRICE = "3,99 €/mes";
const planCache = new Map(); // uid -> { at, plan }
const PLAN_TTL_MS = 30e3;

function invalidatePlan(uid) {
  planCache.delete(String(uid));
}

async function getUserPlan(uid) {
  if (!uid) return "free";
  const key = String(uid);
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  let plan = "free";
  if (firestoreReady) {
    try {
      const d = await db.collection(SUBS_COL).doc(key).get();
      if (d.exists && d.data() && d.data().plan === "pro") plan = "pro";
    } catch (_) {}
  }
  planCache.set(key, { at: Date.now(), plan });
  return plan;
}

async function setUserPlan(uid, plan, source) {
  const v = plan === "pro" ? "pro" : "free";
  if (!firestoreReady) return v;
  await db
    .collection(SUBS_COL)
    .doc(String(uid))
    .set(
      {
        uid: String(uid),
        plan: v,
        source: source || "admin",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  invalidatePlan(uid);
  return v;
}

// uid si el usuario tiene plan PRO; si no, responde el error y devuelve null.
async function proUid(req, res) {
  const uid = await authUid(req);
  if (!uid) {
    res.status(401).json({ ok: false, error: "Inicia sesión." });
    return null;
  }
  if ((await getUserPlan(uid)) !== "pro") {
    res
      .status(403)
      .json({ ok: false, error: "Esta función requiere el plan PRO.", code: "plan" });
    return null;
  }
  return uid;
}

app.get("/api/plan", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const plan = await getUserPlan(uid);
    res.json({ ok: true, plan, price: PRO_PRICE });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Pago SIMULADO (demo): no hay pasarela real; al confirmar se activa PRO.
app.post("/api/plan/upgrade", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const plan = await setUserPlan(uid, "pro", "checkout");
    res.json({ ok: true, plan, price: PRO_PRICE });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/plan/cancel", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión." });
    const plan = await setUserPlan(uid, "free", "cancel");
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

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
      invalidateAiCache();
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
    invalidateAiCache();
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
      invalidateAiCache();
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
    invalidateAiCache();
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
      invalidateAiCache();
      return res.json({ ok: true, score: null });
    }
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 10)
      return res.status(400).json({ ok: false, error: "La nota debe ser un entero de 0 a 10." });
    await ref.set(
      { uid, artistId, score: n, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    invalidateAiCache();
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
// (solo plan PRO: alimenta el algoritmo).
app.post("/api/plays", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
    const b = req.body || {};
    let artistId = String(b.artistId || "").trim();
    if (!artistId && b.artist) {
      const n = norm(b.artist);
      const all = await allArtistsDocs();
      const hit = all.find((a) => norm(a.name) === n);
      if (hit) artistId = String(hit.id);
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

// GET /api/for-you -> rail ponderado con motivos (solo plan PRO)
app.get("/api/for-you", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
    const all = await allArtistsDocs();
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
// El orden es aleatorio en cada renovación de caché (sesgado por el algoritmo
// en usuarios con sesión), para que el feed no sea siempre igual.
const DISCOVER_PAGE_ARTISTS = 4;
const DISCOVER_TTL_MS = 2 * 60e3;
const discoverRankCache = new Map(); // uid|guest -> { at, list }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

async function discoverArtists(uid) {
  const key = uid || "guest";
  const hit = discoverRankCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVER_TTL_MS) return hit.list;
  const all = await allArtistsDocs();
  let list = shuffle(all);
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
      // Puntuados primero pero con jitter aleatorio (mantiene la sesga del
      // algoritmo sin un orden fijo); el resto, barajado.
      const ranked = [...score.entries()]
        .map(([id, sc]) => ({ a: byId.get(String(id)), w: sc * (0.5 + Math.random()) }))
        .filter((x) => x.a)
        .sort((x, y) => y.w - x.w)
        .map((x) => x.a);
      const rest = shuffle(all.filter((a) => !score.has(String(a.id))));
      list = ranked.concat(rest);
    }
  }
  discoverRankCache.set(key, { at: Date.now(), list });
  return list;
}

// Devuelve un grupo de canciones POR artista (barrado dentro de cada uno),
// para poder intercalarlos y no mostrar N previews seguidas del mismo.
async function itunesPreviewGroups(artistNames) {
  const pages = await Promise.all(
    artistNames.map(async (name) => {
      try {
        const url =
          `https://itunes.apple.com/search?term=${encodeURIComponent(name)}` +
          `&entity=song&limit=5&country=ES`;
        const r = await fetch(url);
        if (!r.ok) return [];
        const data = await r.json();
        return shuffle(
          (data.results || [])
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
            }))
        );
      } catch (_) {
        return [];
      }
    })
  );
  return pages;
}

// Round-robin: una canción de cada artista por vuelta (A1,B1,C1,A2,B2,...).
// Nunca salen dos previews seguidas del mismo artista si hay varios grupos.
function interleaveGroups(groups) {
  const queues = groups.filter((g) => g && g.length).map((g) => [...g]);
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      if (q.length) {
        out.push(q.shift());
        added = true;
      }
    }
  }
  return out;
}

function countSongs(groups) {
  return groups.reduce((n, g) => n + g.length, 0);
}

app.get("/api/discover", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const ranked = await discoverArtists(uid);
    if (!ranked.length) return res.json({ ok: true, songs: [], hasMore: false, offset: 0 });
    const byName = new Map();
    ranked.forEach((a) => {
      const k = String(a.name || "").toLowerCase();
      if (!byName.has(k)) byName.set(k, a);
    });
    const attach = (songs) =>
      songs.map((t) => {
        const src = byName.get(String(t.artistName || t.artist || "").toLowerCase());
        if (!src) return t;
        return {
          ...t,
          artistId: String(src.id),
          artistName: src.name || t.artistName,
          artistImage: src.image || "",
          artistCountry: src.country || "",
          artistGenre: src.genre || "",
        };
      });
    const slice = ranked.slice(offset, offset + DISCOVER_PAGE_ARTISTS);
    let groups = await itunesPreviewGroups(slice.map((a) => a.name));
    // Rellena con la siguiente ventana si una página sale muy corta.
    let next = offset + slice.length;
    while (countSongs(groups) < 8 && next < ranked.length && slice.length > 0) {
      const more = ranked.slice(next, next + DISCOVER_PAGE_ARTISTS);
      const extra = await itunesPreviewGroups(more.map((a) => a.name));
      groups = groups.concat(extra);
      next += more.length;
      if (!more.length) break;
    }
    // Intercala artista a artista para que el feed no agrupe previews.
    let songs = attach(interleaveGroups(groups));
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

// Solicitud por email (se resuelve a uid de Firebase Auth). Solo plan PRO.
app.post("/api/friends/request", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
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

// Aceptar (accept:true) o rechazar solicitud. Solo plan PRO.
app.post("/api/friends/respond", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
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

// Eliminar amistad. Solo plan PRO.
app.delete("/api/friends/:uid", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
    await db.collection(FRIENDS_COL).doc(pairId(uid, req.params.uid)).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Amigos + solicitudes. Solo plan PRO.
app.get("/api/friends", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
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

// Perfil (amigos aceptados, o uno mismo). Solo plan PRO.
app.get("/api/friends/:uid/profile", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
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
    const allDocs = await allArtistsDocs();
    const byId = new Map(allDocs.map((d) => [String(d.id), d]));
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

// Actividad reciente de amigos para el rail social. Solo plan PRO.
app.get("/api/friends/activity", async (req, res) => {
  try {
    const uid = await proUid(req, res);
    if (!uid) return;
    const snap = await db.collection(FRIENDS_COL).where("a", "==", uid).get();
    const s2 = await db.collection(FRIENDS_COL).where("b", "==", uid).get();
    const friends = [...snap.docs, ...s2.docs]
      .map((d) => d.data())
      .filter((f) => f.status === "accepted")
      .map((f) => (f.a === uid ? f.b : f.a))
      .slice(0, 20);
    if (!friends.length) return res.json({ ok: true, items: [] });
    const names = {};
    const r = await getAuth().getUsers(friends.map((x) => ({ uid: x })));
    r.users.forEach((u) => (names[u.uid] = u.displayName || String(u.email || "").split("@")[0]));
    const allArtists = await allArtistsDocs();
    const byId = new Map(allArtists.map((d) => [String(d.id), d]));
    const items = [];
    // Las consultas de TODOS los amigos se lanzan en paralelo (antes: en serie).
    const rows = await Promise.all(
      friends.map(async (fid) => {
        const [la, ls, ts] = await Promise.all([
          db.collection(LIKES_COL).where("uid", "==", fid).get(),
          db.collection(SONGLIKES_COL).where("uid", "==", fid).get(),
          db.collection(TASTE_COL).where("uid", "==", fid).get(),
        ]);
        return { fid, fname: names[fid] || "Un amigo", la, ls, ts };
      })
    );
    const byTime = (a, b) =>
      String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || ""));
    for (const { fname, la, ls, ts } of rows) {
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

// ---------- Soporte: tiquets + IA local de datos ----------
// Colección "support_tickets": { uid, userName, email, subject, message,
// status: "open" | "resolved", createdAt, updatedAt }.
const TICKETS_COL = "support_tickets";
const TICKET_STATUSES = ["open", "resolved"];
const supportRate = new Map(); // clave -> { at, n }

function rateOk(key, max, windowMs) {
  const now = Date.now();
  let r = supportRate.get(key);
  if (!r || now - r.at > windowMs) {
    r = { at: now, n: 0 };
    supportRate.set(key, r);
  }
  if (r.n >= max) return false;
  r.n += 1;
  return true;
}

function rateKey(req, prefix) {
  return prefix + ":" + (req.ip || req.socket.remoteAddress || "?");
}

app.post("/api/support/tickets", async (req, res) => {
  try {
    if (!rateOk(rateKey(req, "ticket"), 5, 60 * 60e3))
      return res
        .status(429)
        .json({ ok: false, error: "Demasiados tiquets en la última hora. Inténtalo más tarde." });
    const subject = String((req.body && req.body.subject) || "").trim();
    const message = String((req.body && req.body.message) || "").trim();
    const email = String((req.body && req.body.email) || "").trim();
    if (subject.length < 3 || subject.length > 150)
      return res.status(400).json({ ok: false, error: "El asunto debe tener entre 3 y 150 caracteres." });
    if (message.length < 10 || message.length > 5000)
      return res.status(400).json({ ok: false, error: "El mensaje debe tener entre 10 y 5000 caracteres." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ ok: false, error: "El email no es válido." });
    const uid = (await authUid(req)) || "";
    let userName = "";
    let userEmail = email;
    if (uid) {
      const me = await meFromUid(uid);
      if (me) {
        userName = me.name;
        if (!userEmail) userEmail = me.email;
      }
    }
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible: no se pueden guardar tiquets." });
    const now = new Date().toISOString();
    const doc = await db.collection(TICKETS_COL).add({
      uid,
      userName,
      email: userEmail,
      subject,
      message,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    res.json({ ok: true, id: doc.id, status: "open" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/support/tickets", async (req, res) => {
  try {
    const uid = await authUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Inicia sesión para ver tus tiquets." });
    if (!firestoreReady) return res.json({ ok: true, tickets: [] });
    // Sin orderBy en la consulta (evita requerir un índice compuesto en Firestore).
    const snap = await db.collection(TICKETS_COL).where("uid", "==", uid).limit(100).get();
    const tickets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50);
    res.json({ ok: true, tickets });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- IA de soporte (local, responde con datos reales de la app) ----
// Pool amplio de sugerencias: cada respuesta muestra 5 al azar para cubrir
// más tipos de pregunta (datos, rankings, canciones, ayuda de la interfaz).
const ASK_POOL = [
  "¿Cuál es el artista mejor valorado de la app?",
  "¿Cuáles son los artistas más gustados?",
  "¿Cuántos artistas hay?",
  "¿Quién es Ado?",
  "¿Qué planes hay?",
  "¿Quién lidera el ranking de España?",
  "¿Cuáles son las canciones más gustadas?",
  "¿Qué nota tiene Queen?",
  "¿Quiénes son los artistas más escuchados?",
  "¿Qué géneros predominan en el catálogo?",
  "Dame un artista al azar",
  "¿Qué canciones me gustan?",
  "¿Cómo cancelo mi suscripción?",
  "¿Cómo cambio el tema a claro?",
  "¿Cómo recupero mi contraseña?",
  "¿Qué me recomiendas según mis gustos?",
  "¿Quiénes son los más parecidos a Nirvana?",
  "¿Qué es mi perfil de gustos?",
  "¿Cómo se añade una canción a una playlist?",
  "¿Por qué el login me pide verificar?",
  "¿Qué hago si algo no funciona?",
];

function sugg() {
  const a = ASK_POOL.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 5);
}
const aiCache = new Map(); // "ratings"|"likes" -> { at, rows }
const AI_TTL_MS = 60e3;

// Se limpia cuando cambian las puntuaciones o los likes para no responder
// con datos de hace un minuto.
function invalidateAiCache() {
  aiCache.delete("ratings");
  aiCache.delete("likes");
  aiCache.delete("songlikes");
}

async function aiArtists() {
  if (!firestoreReady) return loadSeed();
  return allArtistsDocs();
}

async function aiAgg(kind) {
  const hit = aiCache.get(kind);
  if (hit && Date.now() - hit.at < AI_TTL_MS) return hit.v;
  let rows = [];
  if (firestoreReady) {
    if (kind === "ratings") {
      const snap = await db.collection(RATINGS_COL).limit(10000).get();
      const by = {};
      snap.docs.forEach((d) => {
        const r = d.data();
        const id = String(r.artistId);
        const s = Number(r.score);
        if (!id || !isFinite(s)) return;
        if (!by[id]) by[id] = { id, sum: 0, n: 0 };
        by[id].sum += s;
        by[id].n += 1;
      });
      rows = Object.values(by).map((r) => ({ id: r.id, sum: r.sum, n: r.n, avg: r.sum / r.n }));
    } else if (kind === "likes") {
      const snap = await db.collection(LIKES_COL).limit(5000).get();
      const by = {};
      snap.docs.forEach((d) => {
        const id = String(d.data().artistId);
        if (!id) return;
        by[id] = (by[id] || 0) + 1;
      });
      rows = Object.entries(by).map(([id, n]) => ({ id, n }));
    }
  }
  aiCache.set(kind, { at: Date.now(), v: rows });
  return rows;
}

const dec1 = (n) => Number(n).toFixed(1).replace(".", ",");
const plural = (n, w) =>
  `${n} ${n === 1 ? w : /ón$/.test(w) ? w.replace(/ón$/, "ones") : `${w}s`}`;

async function aiNameMap() {
  const list = await aiArtists();
  return { list, byId: new Map(list.map((a) => [String(a.id), a])) };
}

async function aiTopRated() {
  const rows = await aiAgg("ratings");
  const { byId } = await aiNameMap();
  return rows
    .map((r) => ({ ...r, name: (byId.get(r.id) || {}).name || r.id }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n);
}

async function aiTopLikes() {
  const rows = await aiAgg("likes");
  const { byId } = await aiNameMap();
  return rows
    .map((r) => ({ ...r, name: (byId.get(r.id) || {}).name || r.id }))
    .sort((a, b) => b.n - a.n);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ¿Aparece la palabra/term como palabra suelta en q? (evita "pop" en "populares")
const wordIn = (q, term) =>
  new RegExp("(?:^|[^a-z0-9])" + escRe(term) + "(?:[^a-z0-9]|$)").test(q);

// Encuentra nombres de catálogo citados en la pregunta (el más largo primero,
// para que "The Beatles" gane a "The"). Devuelve hasta `max` coincidencias.
function findAllInText(q, list, max = 3) {
  const cands = (list || [])
    .filter((a) => a && a.name)
    .sort((x, y) => String(y.name).length - String(x.name).length);
  const out = [];
  for (const a of cands) {
    const n = norm(a.name);
    if (n.length < 2) continue;
    const hit = wordIn(q, n) || (n.length >= 5 && q.includes(n));
    if (!hit) continue;
    if (out.some((o) => norm(o.name).includes(n) && norm(o.name) !== n)) continue;
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}
const findInText = (q, list) => findAllInText(q, list, 1)[0] || null;

// Canciones con más "Me gusta" (colección song_likes).
async function aiSongLikes() {
  const hit = aiCache.get("songlikes");
  if (hit && Date.now() - hit.at < AI_TTL_MS) return hit.v;
  let rows = [];
  if (firestoreReady) {
    const snap = await db.collection(SONGLIKES_COL).limit(5000).get();
    const by = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      const id = String(r.trackId || "");
      if (!id) return;
      if (!by[id])
        by[id] = { id, n: 0, track: String(r.track || ""), artist: String(r.artist || "") };
      by[id].n += 1;
    });
    rows = Object.values(by).sort((a, b) => b.n - a.n);
  }
  aiCache.set("songlikes", { at: Date.now(), v: rows });
  return rows;
}

// Artistas más escuchados (suma de escuchas de la colección taste; TTL 60 s).
async function aiPlays() {
  const hit = aiCache.get("plays");
  if (hit && Date.now() - hit.at < AI_TTL_MS) return hit.v;
  let rows = [];
  if (firestoreReady) {
    const snap = await db.collection(TASTE_COL).limit(5000).get();
    const by = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      const id = String(r.artistId || "");
      if (!id) return;
      by[id] = (by[id] || 0) + (Number(r.plays) || 0);
    });
    rows = Object.entries(by)
      .map(([id, n]) => ({ id, n }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n);
  }
  aiCache.set("plays", { at: Date.now(), v: rows });
  return rows;
}

// Traducciones habituales -> nación tal como aparece en el catálogo.
// El campo country guarda a veces ciudad+país ("Barcelona, Spain"), así que
// se trabaja con la última parte del string ("nación").
const GEO_ALIAS = [
  ["espana", "spain"],
  ["reino unido", "uk"],
  ["ee uu", "usa"],
  ["estados unidos", "usa"],
  ["norteamerica", "usa"],
  ["alemania", "germany"],
  ["francia", "france"],
  ["japon", "japan"],
  ["mexico", "mexico"],
  ["canada", "canada"],
];

const COUNTRY_LABEL = {
  spain: "España",
  usa: "EE. UU.",
  uk: "Reino Unido",
  england: "Inglaterra",
  scotland: "Escocia",
  wales: "Gales",
  ireland: "Irlanda",
  "northern ireland": "Irlanda del Norte",
  germany: "Alemania",
  france: "Francia",
  italy: "Italia",
  netherlands: "Países Bajos",
  australia: "Australia",
  japan: "Japón",
  mexico: "México",
  canada: "Canadá",
};

function nationOf(country) {
  const parts = norm(country).split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
}

// ¿La pregunta menciona algún país del catálogo (directo o por alias)?
// Devuelve {label, test} para filtrar artistas, o null.
function geoFilter(q, countries) {
  const nations = [...new Set(countries.map(nationOf).filter(Boolean))];
  let nation = null;
  for (const [k, v] of GEO_ALIAS) {
    if (wordIn(q, k)) {
      nation = v;
      break;
    }
  }
  if (!nation)
    for (const n of nations)
      if (n.length >= 3 && wordIn(q, n)) {
        nation = n;
        break;
      }
  if (!nation) return null;
  return {
    label: COUNTRY_LABEL[nation] || nation,
    test: (a) => nationOf(a.country || "") === nation,
  };
}

// Ficha corta de un artista con sus métricas (valoración, likes, escuchas).
async function artistCard(found) {
  const id = String(found.id);
  const [ratings, likes, plays] = await Promise.all([
    aiAgg("ratings"),
    aiAgg("likes"),
    aiPlays(),
  ]);
  const r = ratings.find((x) => x.id === id);
  const l = likes.find((x) => x.id === id);
  const p = plays.find((x) => x.id === id);
  return (
    `${found.name} — género: ${found.genre || "Desconocido"} · país: ${found.country || "Desconocido"}.` +
    (r ? ` Valoración media: ${dec1(r.avg)}/10 (${plural(r.n, "puntuación")}).` : " Sin puntuaciones todavía.") +
    (l ? ` Likes: ${l.n}.` : "") +
    (p ? ` Escuchas: ${p.n}.` : "")
  );
}

// Perfil de gustos del usuario: favoritos, notas, escuchas y canciones, más
// pesos de género/país para puntuar candidatos en las recomendaciones.
async function aiProfile(uid) {
  const [likedS, ratedS, tasteS, songS] = await Promise.all([
    db.collection(LIKES_COL).where("uid", "==", uid).get(),
    db.collection(RATINGS_COL).where("uid", "==", uid).get(),
    db.collection(TASTE_COL).where("uid", "==", uid).get(),
    db.collection(SONGLIKES_COL).where("uid", "==", uid).get(),
  ]);
  const likedIds = new Set(likedS.docs.map((d) => String(d.data().artistId)));
  const ratedRows = ratedS.docs.map((d) => d.data()).filter((r) => isFinite(Number(r.score)));
  const ratedMap = new Map(ratedRows.map((r) => [String(r.artistId), Number(r.score)]));
  const playRows = tasteS.docs.map((d) => d.data()).filter((r) => Number(r.plays) > 0);
  const playsMap = new Map(playRows.map((r) => [String(r.artistId), Number(r.plays)]));
  const { byId } = await aiNameMap();
  const genreW = {};
  const countryW = {};
  const touch = (id, w) => {
    const a = byId.get(id);
    if (!a) return;
    if (a.genre && a.genre !== "Desconocido") genreW[a.genre] = (genreW[a.genre] || 0) + w;
    if (a.country && a.country !== "Desconocido") countryW[a.country] = (countryW[a.country] || 0) + w;
  };
  likedIds.forEach((id) => touch(id, 3));
  ratedRows.forEach((r) => touch(String(r.artistId), 1 + Number(r.score) / 5));
  playRows.forEach((r) => touch(String(r.artistId), Math.min(Number(r.plays), 10) / 4));
  return {
    likedIds,
    ratedMap,
    playsMap,
    byId,
    likedCount: likedIds.size,
    ratedRows,
    playTotal: playRows.reduce((s, r) => s + Number(r.plays), 0),
    songCount: songS.size,
    genreW,
    countryW,
  };
}

// Recomendaciones personalizadas: con sesión, los candidatos se puntúan por
// afinidad de género/país con los gustos del usuario + popularidad + valoración
// media (excluyendo lo que ya tiene en favoritos/notas/escuchado); sin sesión,
// lo más gustado. Respeta filtros de la pregunta ("de Rock", "de España").
async function recommendFor(uid, q) {
  const list = await aiArtists();
  const [likesAgg, ratedAgg] = await Promise.all([aiAgg("likes"), aiAgg("ratings")]);
  const likeN = new Map(likesAgg.map((r) => [r.id, r.n]));
  const avgM = new Map(ratedAgg.map((r) => [r.id, r.avg]));
  const countries = [...new Set(list.map((a) => a.country).filter((c) => c && c !== "Desconocido"))];
  const genreQ = list.map((a) => a.genre).find((g) => g && g !== "Desconocido" && wordIn(q, norm(g)));
  const geo = geoFilter(q, countries);
  let pool = list;
  if (genreQ) pool = pool.filter((a) => a.genre === genreQ);
  if (geo) pool = pool.filter(geo.test);
  const empty = !pool.length;
  if (empty) pool = list;
  const decorate = (a) => ({
    a,
    n: likeN.get(String(a.id)) || 0,
    avg: avgM.get(String(a.id)) || 0,
  });
  if (!uid || !firestoreReady) {
    const picks = pool
      .map(decorate)
      .sort((x, y) => y.n - x.n || y.avg - x.avg)
      .slice(0, 4);
    return {
      intro:
        genreQ || geo
          ? `Lo más gustado de ${genreQ || geo.label}:`
          : "Lo más gustado ahora mismo:",
      lines: picks.map(
        (p) =>
          `${p.a.name} — ${p.n ? plural(p.n, "like") : "sin likes"}${p.avg ? ` · ${dec1(p.avg)}/10` : ""}`
      ),
    };
  }
  const p = await aiProfile(uid);
  let cand = pool.filter(
    (a) =>
      !p.likedIds.has(String(a.id)) &&
      !p.ratedMap.has(String(a.id)) &&
      !p.playsMap.has(String(a.id))
  );
  if (cand.length < 4) cand = pool.filter((a) => !p.likedIds.has(String(a.id)));
  if (!cand.length) cand = pool;
  const rows = cand.map((a) => {
    const id = String(a.id);
    const g = a.genre && a.genre !== "Desconocido" ? p.genreW[a.genre] || 0 : 0;
    const c = a.country && a.country !== "Desconocido" ? p.countryW[a.country] || 0 : 0;
    const pop = Math.min(likeN.get(id) || 0, 60) / 15;
    const rate = (avgM.get(id) || 0) / 10;
    return {
      a,
      id,
      g,
      c,
      n: likeN.get(id) || 0,
      avg: avgM.get(id) || 0,
      s: g * 2 + c + pop + rate,
    };
  });
  rows.sort((x, y) => y.s - x.s);
  const refIds = [...p.likedIds, ...p.ratedMap.keys(), ...p.playsMap.keys()];
  const reason = (row) => {
    if (row.g > 0) {
      for (const rid of refIds) {
        const ref = p.byId.get(rid);
        if (ref && rid !== row.id && ref.genre === row.a.genre)
          return `mismo género que ${ref.name} (${row.a.genre})`;
      }
    }
    if (row.c > 0) return `mismo país que otros de tus favoritos (${row.a.country})`;
    if (row.n >= 3) return `top de likes (${row.n})`;
    if (row.avg >= 7) return `muy bien valorado (${dec1(row.avg)}/10)`;
    return row.a.genre || "del catálogo";
  };
  const tastes = [];
  if (p.likedCount) tastes.push(plural(p.likedCount, "favorito"));
  if (p.ratedRows.length) tastes.push(plural(p.ratedRows.length, "puntuación"));
  if (p.playTotal) tastes.push(plural(p.playTotal, "escucha"));
  if (p.songCount) tastes.push(plural(p.songCount, "canción"));
  let intro;
  if (empty && (genreQ || geo))
    intro = `No hay novedades de ${genreQ || geo.label}, así que te propongo del catálogo general:`;
  else if (genreQ || geo) intro = `Según tus gustos, de ${genreQ || geo.label}:`;
  else if (tastes.length) intro = `Según lo que te gusta (${tastes.join(", ")}):`;
  else intro = "Todavía no sé mucho de ti, así que te propongo lo mejor del catálogo:";
  return { intro, lines: rows.slice(0, 4).map((r) => `${r.a.name} — ${reason(r)}`) };
}

const SUPPORT_FAQ = [
  {
    keys: ["como se valora", "como puntuar", "como dar nota", "poner nota", "escala de valoracion"],
    answer:
      "Para puntuar: abre la ficha de un artista y usa la escala 0–10. Tu nota se guarda en tu cuenta y alimenta la valoración media que usa el resto de la app (y el asistente).",
  },
  {
    keys: ["como crear playlist", "crear playlist", "nueva playlist", "como hago una playlist"],
    answer:
      "Ve a Menú → Playlists, escribe un nombre en «Crear playlist» y lista. Después abre la playlist y añade canciones desde cualquier ficha de artista o desde los rankings.",
  },
  {
    keys: ["quitar cancion de playlist", "borrar cancion de playlist", "quito una cancion"],
    answer:
      "Abre Menú → Playlists y entra en tu playlist: cada canción tiene un botón «Quitar de la playlist».",
  },
  {
    keys: ["borrar playlist", "eliminar playlist", "quito la playlist"],
    answer:
      "En Menú → Playlists, cada playlist tiene su botón de eliminar. Solo puede borrarla quien la creó.",
  },
  {
    keys: [
      "como anadir amigo",
      "anadir amigo",
      "invitar amigo",
      "add amigo",
      "como agrego un amigo",
      "como anado un amigo",
      "anado un amigo",
      "anadir un amigo",
      "agregar amigo",
    ],
    answer:
      "Añadir amigos es una función del plan PRO: Menú → Social → escribe el email de tu amigo y envía la solicitud. Cuando acepte, verás su actividad en el cajón lateral.",
  },
  {
    keys: ["como buscar", "busco artistas", "donde busco"],
    answer:
      "En Inicio, escribe el nombre en el buscador superior (p. ej., Queen o Ado). Si el artista no está en el catálogo, se importa automáticamente de TheAudioDB y queda guardado.",
  },
  {
    keys: [
      "olvide mi contrasena",
      "olvide la contrasena",
      "recuperar contrasena",
      "recupero",
      "recuerdo mi contrasena",
      "cambiar contrasena",
      "cambio la contrasena",
      "cambio mi contrasena",
      "resetear contrasena",
      "no puedo entrar",
      "no me deja entrar",
      "nueva contrasena",
    ],
    answer:
      "En la ventana de Usuarios, pestaña «Iniciar sesión», pulsa «He olvidado mi contraseña»: escribe tu email y recibirás un enlace para crear una nueva contraseña (te llega de Google en nombre del proyecto).",
  },
  {
    keys: ["registrarme", "crear cuenta", "como me registro", "nuevo usuario", "darme de alta"],
    answer:
      "En la ventana de Usuarios, pestaña «Registrarse»: nombre, email y contraseña (mínimo 6 caracteres). El registro va protegido con reCAPTCHA invisible.",
  },
  {
    keys: ["hacerse pro", "hazte pro", "pasarme a pro", "pagar pro", "comprar pro", "me hago pro", "upgrade"],
    answer:
      "En Menú → Ajustes → Suscripción, pulsa «Hazte PRO — 3,99 €/mes». Es un pago simulado para la demo y el plan PRO se activa al instante.",
  },
  {
    keys: ["cancelar suscripcion", "cancelar plan", "baja del pro", "dejar de pagar", "cancelar pro"],
    answer:
      "Con plan PRO, en Menú → Ajustes → Suscripción verás «Cancelar suscripción»: vuelves al plan gratuito al momento y conservas tus datos.",
  },
  {
    keys: ["cerrar sesion", "salir de mi cuenta", "cambiar de cuenta", "cerrar cuenta", "desconectar"],
    answer:
      "Menú → Ajustes → Cuenta → «Salir». Después vuelve a pulsar «Iniciar sesión» con la cuenta que quieras.",
  },
  {
    keys: [
      "modo oscuro",
      "modo claro",
      "cambiar tema",
      "cambio el tema",
      "tema claro",
      "tema oscuro",
      "a claro",
      "a oscuro",
      "poner a claro",
      "poner a oscuro",
    ],
    answer:
      "Menú → Ajustes → tarjeta «Apariencia»: botones «Claro» y «Oscuro». Al cambiar de tema se restablece también el color de página personalizado, porque el tema cambia el fondo.",
  },
  {
    keys: ["cambiar color", "cambio el color", "color de pagina", "color de acento", "cambiar el color", "paleta"],
    answer:
      "En Ajustes tienes «Color de la página» (fondo general de toda la app) y «Color de acento» (botones y detalles), con tonos predefinidos y uno personalizado. El color de página se restablece al cambiar de tema.",
  },
  {
    keys: ["que es descubrir", "como funciona descubrir", "feed de canciones", "tipo tiktok", "descubrir"],
    answer:
      "Descubrir es un feed vertical estilo TikTok: una canción por pantalla con scroll automático, toque para pausar, Me gusta y acceso a la ficha del artista, con scroll infinito y orden aleatorio. Es una función PRO.",
  },
  {
    keys: ["que es para ti", "como funciona para ti", "rail de recomendaciones", "recomendaciones", "para ti"],
    answer:
      "«Para ti» es tu rail personalizado: mezcla tus Me gusta (×3), tus escuchas (×1, hasta 10 por artista) y similitud de género/país, y te dice el motivo de cada recomendación. Requiere plan PRO.",
  },
  {
    keys: ["que es social", "como funciona social", "que da social", "social"],
    answer:
      "Social conecta cuentas: añade amigos por email, mira su actividad y sus favoritos y sigue sus gustos. Es una función del plan PRO.",
  },
  {
    keys: ["vista previa", "escuchar cancion", "previsualizar", "suena la cancion", "como escucho"],
    answer:
      "Cada ficha y cada canción tiene vista previa de 30 s (vía iTunes, sin necesidad de suscripción). El reproductor inferior se queda mientras navegas; el seguimiento de escuchas solo cuenta si suena 5 s o más.",
  },
  {
    keys: ["que hace la app", "para que sirve", "como funciona la app", "explicame la app"],
    answer:
      "uBeat es un buscador de cantantes estilo Spotify (solo información): catálogo con nombre, país, género e imagen, búsqueda que importa artistas nuevos automáticamente, rankings de iTunes, favoritos, playlists, valoraciones 0–10, canciones con Me gusta y vistas previas de 30 s. Con sesión añades tu cuenta y, con plan PRO, Para ti, Descubrir y Social.",
  },
  {
    keys: [
      "corazon",
      "marcar favorito",
      "marco un artista",
      "hago favorito",
      "dar me gusta a un artista",
      "desmarcar",
      "quito de favoritos",
    ],
    answer:
      "Para marcar un artista: abre su ficha y pulsa el corazón (se tiñe con animación). Los verás en Menú → Mis artistas favoritos, y para quitarlo, pulsa el corazón otra vez.",
  },
  {
    keys: ["quitar nota", "borrar mi nota", "quito la nota", "cambio mi nota"],
    answer:
      "En la ficha del artista, junto a la escala 0–10, tienes «Quitar nota» para borrar tu puntuación (deja de contar en la media) o simplemente elige otra nota para cambiarla.",
  },
  {
    keys: [
      "anadir cancion",
      "anado una cancion",
      "anado cancion",
      "anadir a mi playlist",
      "guardar cancion",
      "boton de tres puntos",
      "donde guardo la cancion",
      "como anado temas",
    ],
    answer:
      "En cualquier canción pulsa el botón ⋮ y elige la playlist donde guardarla (o crea una desde Menú → Playlists). Cada playlist admite hasta 200 canciones.",
  },
  {
    keys: ["filtros", "filtrar por", "filtro de pais", "filtro de genero"],
    answer:
      "En Inicio tienes filtros de país y género: se combinan en modo AND (p. ej., España + Rock). Los valores salen del catálogo real y se actualizan solos; quita un filtro con su × para volver a la lista completa.",
  },
  {
    keys: ["reproductor", "barra inferior", "cola de reproduccion", "siguiente cancion"],
    answer:
      "El reproductor es la barra inferior: al pulsar una canción se abre con imagen, título y controles, y se queda mientras navegas por otras vistas. Tiene volumen, Me gusta y avanzar; la vista previa dura 30 s.",
  },
  {
    keys: ["buscar cancion", "busco canciones", "buscar temas", "buscador de canciones"],
    answer:
      "El buscador superior es de artistas (escribe el nombre y se importa solo si falta). Las canciones están en las fichas de cada artista y en los rankings (Populares en España), con vista previa de 30 s.",
  },
  {
    keys: ["no encuentro a", "no sale en el buscador", "no lo encuentra", "no me lo importa", "falta un artista"],
    answer:
      "Escribe el nombre exacto (con sus acentos o sin ellos): la app busca en TheAudioDB y, si tampoco está, en iTunes, y lo guarda en el catálogo. Si sigue sin salir, prueba con solo el nombre del artista, sin el del álbum o grupo.",
  },
  {
    keys: ["que son los graficos", "como funcionan los graficos", "populares en espana", "lista de exitos"],
    answer:
      "«Populares en España» es el top 20 de iTunes (también hay versión EE. UU.), actualizado cada hora y con auto-importación de los que falten en el catálogo. Los carruseles de Inicio usan esos datos.",
  },
  {
    keys: ["recaptcha", "captcha", "por que me verifica", "me pide verificar"],
    answer:
      "El login va protegido con reCAPTCHA v3 invisible: comprueba que no eres un robot sin pedirte nada. Solo afecta a la pestaña de inicio de sesión; si alguna vez falla, recarga e inténtalo de nuevo.",
  },
  {
    keys: ["configurar cookies", "que son las cookies", "preferencias de cookies", "cookie"],
    answer:
      "Menú → Ajustes → tarjeta «Cookies» → «Configurar cookies». Puedes permitir las de sesión (mantenerte conectado) y las de preferencias (recordar ajustes como el volumen).",
  },
  {
    keys: ["ver perfil de", "perfil de mi amigo", "actividad de mis amigos", "ver a mis amigos"],
    answer:
      "Con plan PRO: Menú → Social → pulsa sobre un amigo para abrir su card con favoritos y actividad (no cambias de vista). Las solicitudes pendientes aparecen ahí mismo para aceptarlas o rechazarlas.",
  },
  {
    keys: ["sin sesion", "sin cuenta", "sin registrarme", "sin iniciar sesion"],
    answer:
      "Sin sesión puedes buscar, filtrar, ver rankings y escuchar vistas previas de 30 s. Con sesión guardas favoritos, playlists y notas; con PRO añades amigos, Para ti y Descubrir.",
  },
  {
    keys: ["portada", "carrusel", "que veo al abrir", "pantalla de inicio"],
    answer:
      "Al abrir ves la portada con un carrusel de destacados. En Inicio están los rails (Para ti, Le gusta a tus amigos, Populares…) y la lista «Todos los artistas» con scroll infinito de 24 en 24.",
  },
  {
    keys: ["que hay en la ficha", "ficha del artista", "como veo las canciones", "todo de un artista"],
    answer:
      "La ficha muestra imagen, país, género, tus Me gusta y tu nota 0–10, y su lista de canciones con vista previa de 30 s. Al pulsar una se abre el reproductor inferior, y con ⋮ la guardas en playlists.",
  },
];

async function supportAnswer(question, req) {
  const q = norm(question);
  const has = (w) => q.includes(norm(w));
  const uid = await authUid(req);
  const greet = /^(hola|buenas|hey|oye|saludos|que tal)\b/.test(q);
  const shortHelp = q.length < 24 && (has("ayuda") || has("help"));
  const who = has("quien eres") || has("que puedes") || has("que sabes hacer");

  if (greet || who || shortHelp) {
    let name = "";
    if (uid)
      try {
        const u = await getAuth().getUser(uid);
        name = String(u.displayName || (u.email || "").split("@")[0] || "").trim();
      } catch (_) {}
    return {
      answer:
        (name ? `¡Hola, ${name}! ` : "¡Hola! ") +
        "Soy el asistente de soporte de uBeat. Respondo dudas sobre los datos de la app (valoraciones, likes, escuchas, rankings, canciones, artistas, planes y tu cuenta), sobre cómo usarla (playlists, tema, contraseña…) y puedo recomendarte música según tus gustos. Prueba con «¿Qué me recomiendas?».",
      suggestions: sugg(),
    };
  }

  if (/^(gracias|muchas gracias|genial|perfecto|vale|de acuerdo|buena idea)\b/.test(q) && q.length < 40)
    return {
      answer: "¡A ti! Si se te ocurre otra duda sobre la app, pregunta sin problema.",
      suggestions: sugg(),
    };
  if (/^(adios|chao|hasta luego|nos vemos|bye|buenas noches|hasta pronto)\b/.test(q))
    return {
      answer: "Hasta luego. Aquí sigo por si vuelves con más dudas sobre uBeat.",
      suggestions: sugg(),
    };

  if (has("estado del servidor") || has("esta el servidor") || has("firestore") || has("estado de la app"))
    return {
      answer: `Estado: Firestore ${firestoreReady ? "conectado" : "modo local (sin clave)"} · catálogo de ${(
        await aiArtists()
      ).length} artistas · servidor en el puerto ${PORT}.`,
      suggestions: sugg(),
    };

  // Rankings de iTunes ("¿Quién lidera el ranking de España?")
  const wantsChart =
    (has("ranking") ||
      has("top 20") ||
      has("top20") ||
      has("exitos") ||
      has("chart") ||
      has("lidera") ||
      has("lider del") ||
      has("populares en") ||
      has("lista de las canciones")) &&
    !has("likes") &&
    !has("valorad") &&
    !has("puntuad") &&
    !has("gustad") &&
    !has("mejor") &&
    !has("peor");
  if (wantsChart) {
    const us = /\b(us|usa|ee uu|estados unidos|global|internacional)\b/.test(q);
    try {
      const rows = await chartArtists(us ? "US" : "ES", 20);
      const top = rows
        .slice(0, 5)
        .map((r) => `${r.chartPos || "–"}. ${r.name}`)
        .join("\n");
      return {
        answer:
          `Top 5 del ranking de ${us ? "EE. UU." : "España"} (iTunes, caché de 1 h):\n${top}` +
          (rows.length > 5 ? "\n\nHay 20 posiciones en total: verás el listado completo en Inicio, en «Populares en España»." : ""),
        suggestions: sugg(),
      };
    } catch (_) {
      return {
        answer: "Ahora mismo no puedo leer el ranking de iTunes. Inténtalo de nuevo en unos minutos.",
        suggestions: sugg(),
      };
    }
  }

  // Mejor / peor valorado
  if (has("mejor valorad") || has("mejor puntuad") || has("mejor calificad") || has("mejor nota")) {
    const rows = await aiTopRated();
    if (!rows.length)
      return {
        answer: "Todavía no hay puntuaciones en la app, así que no puedo calcular el mejor valorado.",
        suggestions: sugg(),
      };
    const top = rows
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} — ${dec1(r.avg)}/10 (${plural(r.n, "puntuación")})`)
      .join("\n");
    return {
      answer: `El artista mejor valorado es ${rows[0].name}, con una media de ${dec1(rows[0].avg)}/10 basada en ${plural(
        rows[0].n,
        "puntuación"
      )}.\n\nTop 5 valorados:\n${top}`,
      suggestions: sugg(),
    };
  }
  if (has("peor valorad") || has("peor puntuad") || has("peor nota")) {
    const rows = await aiTopRated();
    if (!rows.length)
      return { answer: "Todavía no hay puntuaciones en la app.", suggestions: sugg() };
    const r = rows[rows.length - 1];
    return {
      answer: `${r.name} es hoy el peor valorado, con una media de ${dec1(r.avg)}/10 (${plural(
        r.n,
        "puntuación"
      )}).`,
      suggestions: sugg(),
    };
  }

  // Más gustados (likes)
  if (
    has("mas gustad") ||
    has("mas popul") ||
    has("populares") ||
    has("mas likes") ||
    has("mas me gusta") ||
    has("favorito de todos") ||
    has("top de likes")
  ) {
    const rows = await aiTopLikes();
    if (!rows.length)
      return {
        answer: "Todavía no hay likes en la app, así que no puedo calcular los más gustados.",
        suggestions: sugg(),
      };
    const top = rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.name} — ${plural(r.n, "like")}`).join("\n");
    return {
      answer: `Los artistas más gustados de la app:\n${top}`,
      suggestions: sugg(),
    };
  }

  // Canciones con más Me gusta
  if (
    has("canciones mas gustad") ||
    has("top canciones") ||
    has("canciones favoritas de todos") ||
    has("canciones populares") ||
    has("mas me gusta en canciones") ||
    has("canciones con mas me gusta")
  ) {
    const rows = await aiSongLikes();
    if (!rows.length)
      return {
        answer: "Todavía no hay canciones con Me gusta en la app.",
        suggestions: sugg(),
      };
    const top = rows
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.track}${r.artist ? ` — ${r.artist}` : ""} (${plural(r.n, "like")})`)
      .join("\n");
    return {
      answer: `Las canciones con más Me gusta de la app:\n${top}`,
      suggestions: sugg(),
    };
  }

  // Artistas más escuchados (escuchas registradas)
  if (
    has("mas escuchad") ||
    has("que mas suena") ||
    has("mas suenan") ||
    has("artistas que mas") ||
    has("top de escuchas") ||
    has("mas escuchados")
  ) {
    const rows = await aiPlays();
    if (!rows.length)
      return {
        answer: "Todavía no hay escuchas registradas en la app.",
        suggestions: sugg(),
      };
    const { byId } = await aiNameMap();
    const top = rows
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${(byId.get(r.id) || {}).name || r.id} — ${plural(r.n, "escucha")}`)
      .join("\n");
    return {
      answer: `Los artistas que más se escuchan (escuchas de más de 5 s):\n${top}`,
      suggestions: sugg(),
    };
  }

  // Conteos del catálogo
  if (
    (has("cuantos artistas") ||
      has("numero de artistas") ||
      has("total de artistas") ||
      has("cuantos grupos") ||
      has("cuantas canciones")) &&
    !(has("cuantas canciones") && has("me gustan"))
  ) {
    const list = await aiArtists();
    if (has("cuantas canciones")) {
      const rows = await aiSongLikes();
      const total = rows.reduce((s, r) => s + r.n, 0);
      return {
        answer: `Hay ${plural(total, "Me gusta")} a canciones en la app. Las vistas previas salen de iTunes (top 20 de España/EE. UU.), así que el repertorio de canciones crece con los rankings.`,
        suggestions: sugg(),
      };
    }
    const genres = new Set(list.map((a) => a.genre).filter((g) => g && g !== "Desconocido"));
    const countries = [...new Set(list.map((a) => a.country).filter((c) => c && c !== "Desconocido"))];
    const geo = geoFilter(q, countries);
    const gen = list.map((a) => a.genre).find((g) => g && g !== "Desconocido" && wordIn(q, norm(g)));
    if (geo || gen) {
      let filtered = list;
      if (geo) filtered = filtered.filter(geo.test);
      if (gen) filtered = filtered.filter((a) => a.genre === gen);
      const what = [geo && geo.label, gen].filter(Boolean).join(" y ");
      if (!filtered.length)
        return {
          answer: `No hay artistas de ${what} en el catálogo todavía. Escríbelos en el buscador y se importarán si están en TheAudioDB.`,
          suggestions: sugg(),
        };
      return {
        answer: `Hay ${plural(filtered.length, "artista")} de ${what} en el catálogo: ${filtered
          .slice(0, 5)
          .map((a) => a.name)
          .join(", ")}${filtered.length > 5 ? "…" : ""}.`,
        suggestions: sugg(),
      };
    }
    return {
      answer: `El catálogo tiene ${plural(list.length, "artista")} y ${plural(
        genres.size,
        "género"
      )} distintos. Si buscas a alguien que no está, escríbelo en el buscador y se importará automáticamente.`,
      suggestions: sugg(),
    };
  }
  if (has("cuantos usuarios") || has("numero de usuarios") || has("usuarios registrados")) {
    let n = 0;
    if (firestoreReady) {
      try {
        const page = await getAuth().listUsers(1000);
        n = page.users ? page.users.length : 0;
      } catch (_) {}
    }
    return {
      answer: `Hay ${plural(n, "usuario")} registrado(s) en la app${n >= 1000 ? " (hasta 1.000 contados)" : ""}.`,
      suggestions: sugg(),
    };
  }

  // Planes / precio / cobros
  if (has("plan") || /\bpro\b/.test(q) || has("precio") || has("cuesta") || has("suscri")) {
    if (has("cancel") || has("baja") || has("dejar de pagar") || has("anular"))
      return {
        answer:
          "Para cancelar: Menú → Ajustes → Suscripción y pulsa «Cancelar suscripción» (solo aparece con plan PRO). Vuelves al plan gratuito al instante y conservas tus datos.",
        suggestions: sugg(),
      };
    if (
      has("hacerse") ||
      has("hazte") ||
      has("me hago") ||
      has("pagar") ||
      has("comprar") ||
      has("pasarme") ||
      has("pasar a pro") ||
      has("upgrade") ||
      has("activar pro")
    )
      return {
        answer:
          "Hazte PRO en Menú → Ajustes → Suscripción, botón «Hazte PRO — 3,99 €/mes». Es un pago simulado para la demo y se activa al momento.",
        suggestions: sugg(),
      };
    let personal = "";
    if (uid) {
      const p = await getUserPlan(uid);
      personal = ` Tu plan actual es ${p === "pro" ? "PRO" : "gratuito"}.`;
    }
    return {
      answer:
        `Hay dos planes: Gratuito (catálogo, favoritos, playlists, canciones y valoraciones) y PRO (3,99 €/mes), que añade Social (amigos y actividad) y las funciones Para ti y Descubrir.` +
        personal,
      suggestions: sugg(),
    };
  }

  // Datos personales
  if (
    /\bmis\b/.test(q) ||
    has("me gustan") ||
    has("que me gusta") ||
    has("mi para ti") ||
    has("mi perfil")
  ) {
    if (!uid)
      return {
        answer: "Inicia sesión para ver tus datos personales (favoritos, puntuaciones, playlists, amigos y plan).",
        suggestions: sugg(),
      };
    if (firestoreReady) {
      // Un artista concreto: "¿qué nota le puse a Queen?", "¿me gusta Queen?"
      const { list } = await aiNameMap();
      const mine = findAllInText(q, list, 1)[0];
      if (
        mine &&
        (has("nota") || has("puntu") || has("valor") || has("like") || has("gusta") || has("favorito"))
      ) {
        const id = String(mine.id);
        const [rat, lik, ratings] = await Promise.all([
          db.collection(RATINGS_COL).doc(`${uid}_${id}`).get(),
          db.collection(LIKES_COL).doc(`${uid}_${id}`).get(),
          aiAgg("ratings"),
        ]);
        const s = rat.exists && isFinite(Number(rat.data().score)) ? Number(rat.data().score) : null;
        const r = ratings.find((x) => x.id === id);
        return {
          answer:
            `${mine.name}: ` +
            (s === null ? "todavía no le has puesto nota" : `tu nota es ${s}/10`) +
            (lik.exists ? " y está en tus favoritos" : " y no está en tus favoritos") +
            (r
              ? `. Su media en la app es ${dec1(r.avg)}/10 (${plural(r.n, "puntuación")}).`
              : ". Todavía no tiene puntuaciones."),
          suggestions: sugg(),
        };
      }
      // Perfil de gustos / "¿qué me gusta?", "mis gustos", "mi Para ti"
      if (
        has("mis gustos") ||
        has("que me gusta") ||
        has("que tipo") ||
        has("mi perfil") ||
        has("mi para ti") ||
        has("mis recomendaciones")
      ) {
        const prof = await aiProfile(uid);
        const parts = [];
        if (prof.likedCount) parts.push(plural(prof.likedCount, "favorito"));
        if (prof.ratedRows.length) parts.push(plural(prof.ratedRows.length, "puntuación"));
        if (prof.playTotal) parts.push(plural(prof.playTotal, "escucha"));
        if (prof.songCount) parts.push(plural(prof.songCount, "canción favorita"));
        const rec = await recommendFor(uid, q);
        const recBlock = `${rec.intro}\n${rec.lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
        if (!parts.length)
          return {
            answer:
              "Todavía no sé nada de ti: marca favoritos con el corazón, puntúa artistas 0–10 y deja que suenen previews y podré personalizarte todo. Mientras tanto:\n" +
              recBlock,
            suggestions: sugg(),
          };
        const favNames = [...prof.likedIds]
          .map((id) => (prof.byId.get(id) || {}).name)
          .filter(Boolean);
        const genreTop = Object.entries(prof.genreW)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([g]) => g);
        const avg =
          prof.ratedRows.length > 1
            ? ` Media que das: ${dec1(
                prof.ratedRows.reduce((s, r) => s + Number(r.score), 0) / prof.ratedRows.length
              )}/10.`
            : "";
        const favs = favNames.length
          ? ` Tus favoritos: ${favNames.slice(0, 5).join(", ")}${favNames.length > 5 ? "…" : ""}.`
          : "";
        const genres = genreTop.length ? ` Tus géneros: ${genreTop.join(", ")}.` : "";
        const isRail = has("mi para ti") || has("mis recomendaciones");
        return {
          answer:
            (isRail
              ? "Tu rail «Para ti» (PRO) mezcla tus Me gusta ×3, escuchas ×1 y similitud de género/país ×2. Ahora mismo saldrían:\n"
              : `Tu perfil de uBeat: ${parts.join(", ")}.${favs}${genres}${avg}\n\n`) +
            recBlock,
          suggestions: sugg(),
        };
      }
      if (has("cancion")) {
        const snap = await db.collection(SONGLIKES_COL).where("uid", "==", uid).get();
        if (!snap.size)
          return {
            answer: "Todavía no has puesto Me gusta a ninguna canción. Ábrelas desde una ficha de artista y pulsa Me gusta.",
            suggestions: sugg(),
          };
        return {
          answer: `Tienes ${plural(snap.size, "canción")} con Me gusta. Las ves todas en Menú → Mis canciones favoritas.`,
          suggestions: sugg(),
        };
      }
      if (has("escucha") || has("escuchado") || has("veces escuch")) {
        const snap = await db.collection(TASTE_COL).where("uid", "==", uid).get();
        const total = snap.docs.reduce((s, d) => s + (Number(d.data().plays) || 0), 0);
        return {
          answer: total
            ? `Llevas ${plural(total, "escucha")} registradas (cada preview que suena 5 s o más). Con eso se alimenta tu rail «Para ti».`
            : "Todavía no tienes escuchas registradas: deja que una preview suene 5 s o más y contará.",
          suggestions: sugg(),
        };
      }
      if (has("amigo")) {
        const [a, b] = await Promise.all([
          db.collection(FRIENDS_COL).where("a", "==", uid).get(),
          db.collection(FRIENDS_COL).where("b", "==", uid).get(),
        ]);
        const n = a.size + b.size;
        return { answer: `Tienes ${plural(n, "amistad")} en la app.`, suggestions: sugg() };
      }
      if (has("playlist")) {
        const snap = await db.collection(PLAYLISTS_COL).where("uid", "==", uid).get();
        if (!snap.size)
          return {
            answer: "Todavía no tienes playlists: ve a Menú → Playlists y crea la primera con «Crear playlist».",
            suggestions: sugg(),
          };
        const names = snap.docs.map((d) => String(d.data().name || "")).filter(Boolean);
        return {
          answer: `Tienes ${plural(snap.size, "playlist")}: ${names.slice(0, 6).join(", ")}${
            names.length > 6 ? "…" : ""
          }. Las ves en Menú → Playlists.`,
          suggestions: sugg(),
        };
      }
      if (has("nota") || has("puntuacion") || has("valoracion")) {
        const snap = await db.collection(RATINGS_COL).where("uid", "==", uid).get();
        const docs = snap.docs.map((d) => d.data()).filter((r) => isFinite(Number(r.score)));
        if (!docs.length)
          return {
            answer: "Todavía no has puntuado ningún artista. Abre una ficha y usa la escala 0–10.",
            suggestions: sugg(),
          };
        const avg = docs.reduce((s, r) => s + Number(r.score), 0) / docs.length;
        const { byId } = await aiNameMap();
        const sorted = docs.slice().sort((a, b) => Number(b.score) - Number(a.score));
        const nameOf = (r) => (byId.get(String(r.artistId)) || {}).name || r.artistId;
        return {
          answer:
            `Has puntuado ${plural(docs.length, "artista")} con una media de ${dec1(avg)}/10. ` +
            `Tu mejor nota: ${nameOf(sorted[0])} ${sorted[0].score}/10` +
            (sorted.length > 1
              ? `; la más baja: ${nameOf(sorted[sorted.length - 1])} ${sorted[sorted.length - 1].score}/10.`
              : "."),
          suggestions: sugg(),
        };
      }
      const snap = await db.collection(LIKES_COL).where("uid", "==", uid).get();
      if (!snap.size)
        return {
          answer: "Todavía no tienes artistas favoritos: abre una ficha y pulsa el corazón.",
          suggestions: sugg(),
        };
      const { byId } = await aiNameMap();
      const names = snap.docs
        .map((d) => (byId.get(String(d.data().artistId)) || {}).name)
        .filter(Boolean);
      return {
        answer: `Tienes ${plural(snap.size, "artista")} en favoritos: ${names.slice(0, 6).join(", ")}${
          names.length > 6 ? "…" : ""
        }. Los ves en Menú → Mis artistas favoritos.`,
        suggestions: sugg(),
      };
    }
    return { answer: "Firestore no está disponible, no puedo leer tus datos.", suggestions: sugg() };
  }

  // Géneros y países más comunes
  if (
    has("genero mas") ||
    has("top genero") ||
    has("generos mas") ||
    has("genero popular") ||
    has("que generos") ||
    has("generos hay") ||
    has("todos los generos") ||
    has("lista de generos") ||
    has("listado de generos")
  ) {
    const list = await aiArtists();
    const by = {};
    list.forEach((a) => {
      if (!a.genre || a.genre === "Desconocido") return;
      by[a.genre] = (by[a.genre] || 0) + 1;
    });
    const top = Object.entries(by)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([g, n], i) => `${i + 1}. ${g} (${n})`)
      .join("\n");
    return {
      answer: top ? `Los géneros más comunes del catálogo:\n${top}` : "No hay géneros etiquetados aún.",
      suggestions: sugg(),
    };
  }
  if (has("pais") || has("paises")) {
    const list = await aiArtists();
    const by = {};
    list.forEach((a) => {
      if (!a.country || a.country === "Desconocido") return;
      const n = nationOf(a.country);
      if (!n) return;
      by[n] = (by[n] || 0) + 1;
    });
    const top = Object.entries(by)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([c, n], i) => `${i + 1}. ${COUNTRY_LABEL[c] || c} (${n})`)
      .join("\n");
    return {
      answer: top ? `Los países con más artistas en el catálogo:\n${top}` : "No hay países etiquetados aún.",
      suggestions: sugg(),
    };
  }

  // ---- Artista(s) citado(s) en la pregunta ----
  const LOOKUP = /(quien es|quien fue|que es|informacion|info de|datos de|que sabes de|dime (de|sobre)|hablame de|sobre|habla de|conoces a)/;
  const howTo =
    has("como se") ||
    has("como puntuar") ||
    has("como dar") ||
    has("como crear") ||
    has("como anadir") ||
    has("como hago") ||
    has("como recupero") ||
    has("como cancelo") ||
    has("donde ");
  const { list: catList } = await aiNameMap();
  const hits = findAllInText(q, catList, 3);

  // 1) Comparativa de 2 o más artistas ("Queen o Nirvana", "X vs Y")
  if (hits.length >= 2 && !howTo) {
    const [ratings, likes, plays] = await Promise.all([
      aiAgg("ratings"),
      aiAgg("likes"),
      aiPlays(),
    ]);
    const stat = (x) => {
      const id = String(x.id);
      return {
        r: ratings.find((y) => y.id === id),
        l: likes.find((y) => y.id === id),
        p: plays.find((y) => y.id === id),
      };
    };
    const line = (x, s) =>
      `• ${x.name}: ${
        s.r ? `${dec1(s.r.avg)}/10 (${plural(s.r.n, "puntuación")})` : "sin notas"
      }${s.l ? `, ${s.l.n} likes` : ""}${s.p ? `, ${s.p.n} escuchas` : ""}`;
    const [a, b] = hits;
    const sa = stat(a);
    const sb = stat(b);
    let verdict = "";
    const compareQ =
      /\bvs\b|versus|frente a|contra\b|mejor que|quien gana|cual gana|compara|comparacion/.test(q) ||
      wordIn(q, "mejor") ||
      wordIn(q, "o") ||
      has("cuál gana");
    if (compareQ) {
      if (sa.r && sb.r)
        verdict =
          sa.r.avg === sb.r.avg
            ? `\nVan empatados a ${dec1(sa.r.avg)}/10.`
            : `\nPor valoración media va mejor ${sa.r.avg > sb.r.avg ? a.name : b.name}.`;
      else if (sa.l && sb.l)
        verdict =
          sa.l.n === sb.l.n
            ? `\nEmpatados a ${sa.l.n} likes.`
            : `\nPor likes va mejor ${sa.l.n > sb.l.n ? a.name : b.name}.`;
      else verdict = "\nTodavía no hay datos suficientes para emitir un veredicto.";
    }
    return {
      answer: hits.map((x) => line(x, stat(x))).join("\n") + verdict,
      suggestions: sugg(),
    };
  }

  // 2) Métricas de un artista concreto ("¿qué nota tiene Queen?", "¿cuántos likes tiene X?")
  const metricQ =
    has("nota") ||
    has("puntu") ||
    has("valorac") ||
    has("like") ||
    has("gusta") ||
    has("cuantos") ||
    has("cuantas") ||
    has("cuanto") ||
    has("escuch") ||
    has("estrellas") ||
    has("opinion") ||
    has("como va") ||
    has("estadistic") ||
    has("popular") ||
    has("fama") ||
    has("pais") ||
    has("genero");
  if (hits.length === 1 && metricQ && !howTo && !LOOKUP.test(q)) {
    const x = hits[0];
    const id = String(x.id);
    const [ratings, likes, plays, rated, liked] = await Promise.all([
      aiAgg("ratings"),
      aiAgg("likes"),
      aiPlays(),
      aiTopRated(),
      aiTopLikes(),
    ]);
    const r = ratings.find((y) => y.id === id);
    const l = likes.find((y) => y.id === id);
    const p = plays.find((y) => y.id === id);
    const rankR = rated.findIndex((y) => String(y.id) === id);
    const rankL = liked.findIndex((y) => String(y.id) === id);
    const parts = [
      r
        ? `valoración media ${dec1(r.avg)}/10 (${plural(r.n, "puntuación")}${
            rankR >= 0 ? `, puesto ${rankR + 1} de la app` : ""
          })`
        : "sin puntuaciones",
      l
        ? `${plural(l.n, "like")}${rankL >= 0 ? ` (puesto ${rankL + 1} de la app)` : ""}`
        : "sin likes",
    ];
    if (p) parts.push(`${plural(p.n, "escucha")}`);
    return {
      answer: `${x.name} (${x.genre || "Desconocido"} · ${x.country || "Desconocido"}): ${parts.join(", ")}.`,
      suggestions: sugg(),
    };
  }

  // 3) Artistas parecidos a uno concreto
  const similarQ =
    has("parecid") ||
    has("similar") ||
    has("algo como") ||
    has("otros como") ||
    has("del mismo genero") ||
    has("recomienda parecid") ||
    has("tambien de");
  if (hits.length === 1 && similarQ && !howTo) {
    const x = hits[0];
    const g = x.genre && x.genre !== "Desconocido" ? x.genre : null;
    if (!g)
      return {
        answer: `No tengo el género de ${x.name} etiquetado, así que no puedo buscarte parecidos. Prueba con «recomiéndame algo».`,
        suggestions: sugg(),
      };
    const [likes, rated] = await Promise.all([aiTopLikes(), aiTopRated()]);
    const likeN = new Map(likes.map((y) => [String(y.id), y.n]));
    const avgM = new Map(rated.map((y) => [String(y.id), y.avg]));
    const same = catList
      .filter((a) => norm(a.name) !== norm(x.name) && a.genre === g)
      .sort(
        (a, b) =>
          (likeN.get(String(b.id)) || 0) - (likeN.get(String(a.id)) || 0) ||
          (avgM.get(String(b.id)) || 0) - (avgM.get(String(a.id)) || 0)
      )
      .slice(0, 5);
    if (!same.length)
      return {
        answer: `No hay otros artistas de ${g} en el catálogo. Si buscas a alguno, escríbelo en el buscador.`,
        suggestions: sugg(),
      };
    return {
      answer: `Si te gusta ${x.name} (${g}), prueba con: ${same
        .map((a) => a.name + (likeN.has(String(a.id)) ? ` (${likeN.get(String(a.id))} likes)` : ""))
        .join(", ")}.`,
      suggestions: sugg(),
    };
  }

  // 4) Ficha de un artista concreto ("¿Quién es Ado?", "información de Queen"…)
  if (hits.length === 1 && LOOKUP.test(q) && !howTo)
    return { answer: await artistCard(hits[0]), suggestions: sugg() };

  if (LOOKUP.test(q) && !hits.length) {
    const PHRASES = [
      "informacion sobre",
      "informacion de",
      "informacion",
      "que sabes de",
      "sabes algo de",
      "conoces a",
      "hablame de",
      "dime sobre",
      "dime de",
      "habla de",
      "quien es",
      "quien fue",
      "que es",
      "cual es",
      "datos de",
      "info de",
      "sobre",
      "el artista",
      "la artista",
      "artista",
      "cantante",
      "grupo",
      "musico",
      "en la aplicacion",
      "en la app",
      "de la app",
      "por favor",
    ];
    let name = q.replace(/[?¡!]/g, " ");
    PHRASES.forEach((p) => {
      name = name.split(p).join(" ");
    });
    name = name.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (name.length >= 2) {
      // A veces "lo que no está en el catálogo" es una función de la app
      // ("¿Qué es Descubrir?"): primero consultamos las FAQ.
      for (const f of SUPPORT_FAQ)
        if (f.keys.some((k) => q.includes(k)))
          return { answer: f.answer, suggestions: sugg() };
      return {
        answer: `No encuentro a «${name}» en el catálogo. Escribe su nombre en el buscador de Inicio: si está en TheAudioDB se importará automáticamente.`,
        suggestions: sugg(),
      };
    }
  }

  // Recomendación (no robar las preguntas de azar/sorteo)
  if (
    (has("recomienda") ||
      has("recomiend") ||
      has("recomend") ||
      has("sugiere") ||
      has("sugier") ||
      has("que escucho") ||
      has("dame un artista")) &&
    !has("al azar") &&
    !has("sorprend") &&
    !has("elige uno")
  ) {
    const rec = await recommendFor(uid, q);
    if (!rec.lines.length)
      return {
        answer: "El catálogo está vacío, no hay nada que recomendar ahora mismo.",
        suggestions: sugg(),
      };
    return {
      answer: `${rec.intro}\n${rec.lines
        .map((l, i) => `${i + 1}. ${l}`)
        .join("\n")}\nBúscalos en Inicio para ver su ficha.`,
      suggestions: sugg(),
    };
  }

  // Artista al azar
  if (has("al azar") || has("sorprendeme") || has("sorprende") || has("dame algun artista") || has("elige uno")) {
    const list = await aiArtists();
    if (list.length) {
      const pick = list[Math.floor(Math.random() * list.length)];
      return {
        answer: `Hoy te toca ${pick.name} (${pick.genre || "Desconocido"} · ${pick.country || "Desconocido"}). Escríbelo en el buscador si no lo tienes en favoritos.`,
        suggestions: sugg(),
      };
    }
    return { answer: "El catálogo está vacío, no puedo sortear nada.", suggestions: sugg() };
  }

  // Incidencias y contacto humano
  if (
    has("no funciona") ||
    has("no carga") ||
    has("no me va") ||
    has("error") ||
    has("falla") ||
    has("fallo") ||
    has("bug") ||
    has("roto") ||
    has("rompe") ||
    has("estrope") ||
    has("lent") ||
    has("problema") ||
    has("queja") ||
    has("reclamacion") ||
    has("contactar") ||
    has("hablar con") ||
    has("persona real") ||
    has("soporte humano")
  )
    return {
      answer:
        "Pasos rápidos:\n1. Recarga la página (F5).\n2. Comprueba tu conexión y usa un navegador actualizado (Chrome, Edge o Firefox).\n3. Si es de tu cuenta, revisa sesión, plan (Ajustes → Suscripción) y contraseña («He olvidado mi contraseña»).\n4. Repite la acción en otra ventana de incógnito para ver si es de tu equipo o del navegador.\n\nSi persiste, abre Menú → Soporte y describe el problema (pasos que diste, qué esperabas, navegador y mensaje de error): se abre un tiquet que el equipo verá en el panel de soporte.",
      suggestions: sugg(),
    };

  // Preguntas frecuentes de la app
  for (const f of SUPPORT_FAQ) {
    if (f.keys.some((k) => q.includes(k)))
      return { answer: f.answer, suggestions: sugg() };
  }

  // Un nombre suelto ("Queen") devuelve su ficha
  if (hits.length === 1)
    return { answer: await artistCard(hits[0]), suggestions: sugg() };

  return {
    answer:
      "No tengo una respuesta para eso todavía. Puedo ayudarte con: valoraciones y rankings, likes y escuchas, canciones, artistas y géneros, planes, tu cuenta y cómo usar la app (playlists, tema, contraseña…). Prueba con una de estas:",
    suggestions: sugg(),
  };
}

app.post("/api/support/ask", async (req, res) => {
  try {
    const question = String((req.body && req.body.question) || "").trim();
    if (question.length < 2 || question.length > 400)
      return res.status(400).json({ ok: false, error: "La pregunta debe tener entre 2 y 400 caracteres." });
    if (!rateOk(rateKey(req, "ask"), 40, 5 * 60e3))
      return res.status(429).json({ ok: false, error: "Demasiadas preguntas. Espera unos minutos." });
    const answer = await supportAnswer(question, req);
    res.json({ ok: true, ...answer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Panel de administración ----------
// Credenciales: secrets.json {"adminUser","adminPass"} o env ADMIN_USER/ADMIN_PASS.
const ADMIN_TOKEN_TTL_MS = 12 * 3600e3;
const adminTokens = new Map(); // token -> expiresAt
const adminLoginTries = new Map(); // ip -> { at, n }

function adminCredentials() {
  let u = process.env.ADMIN_USER || "admin";
  let p = process.env.ADMIN_PASS || "P@ssw0rd";
  try {
    const s = require(SECRETS_PATH);
    if (s && s.adminUser) u = s.adminUser;
    if (s && s.adminPass) p = s.adminPass;
  } catch (_) {}
  return { u, p };
}

function adminOk(req) {
  const t = req.get("x-admin-token");
  const exp = t && adminTokens.get(t);
  if (!exp) return false;
  if (exp < Date.now()) {
    adminTokens.delete(t);
    return false;
  }
  return true;
}

function pruneAdminTokens() {
  const now = Date.now();
  for (const [t, exp] of adminTokens) if (exp < now) adminTokens.delete(t);
}

function adminRateLimited(req) {
  const ip = req.ip || req.socket.remoteAddress || "?";
  const now = Date.now();
  let r = adminLoginTries.get(ip);
  if (!r || now - r.at > 5 * 60e3) {
    r = { at: now, n: 0 };
    adminLoginTries.set(ip, r);
  }
  r.n += 1;
  return r.n > 5;
}

app.post("/api/admin/login", (req, res) => {
  try {
    if (adminRateLimited(req))
      return res
        .status(429)
        .json({ ok: false, error: "Demasiados intentos. Espera 5 minutos." });
    const { u, p } = adminCredentials();
    const user = String((req.body && req.body.user) || "");
    const pass = String((req.body && req.body.password) || "");
    if (user !== u || pass !== p)
      return res.status(401).json({ ok: false, error: "Credenciales incorrectas." });
    const token = crypto.randomBytes(24).toString("hex");
    adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
    pruneAdminTokens();
    res.json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use("/api/admin", (req, res, next) => {
  if (!adminOk(req)) return res.status(401).json({ ok: false, error: "No autorizado." });
  next();
});

app.get("/api/admin/stats", async (req, res) => {
  try {
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible." });
    const [users, docs, likesS, subsS, frS, songS, ratS, plS, tkS, tkOpenS] = await Promise.all([
      firestoreReady ? getAuth().listUsers(1000) : { users: [] },
      allArtistsDocs(),
      db.collection(LIKES_COL).count().get(),
      db.collection(SUBS_COL).count().get(),
      db.collection(FRIENDS_COL).count().get(),
      db.collection(SONGLIKES_COL).count().get(),
      db.collection(RATINGS_COL).count().get(),
      db.collection(PLAYLISTS_COL).count().get(),
      db.collection(TICKETS_COL).count().get(),
      db.collection(TICKETS_COL).where("status", "==", "open").get(),
    ]);
    const likeRows = (await db.collection(LIKES_COL).limit(5000).get()).docs.map((d) => d.data());
    const byArtist = {};
    likeRows.forEach((r) => (byArtist[String(r.artistId)] = (byArtist[String(r.artistId)] || 0) + 1));
    const byName = new Map(docs.map((d) => [String(d.id), d.name]));
    const topLikes = Object.entries(byArtist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, n]) => ({ id, name: byName.get(id) || id, likes: n }));
    const plans = { free: 0, pro: 0 };
    (await db.collection(SUBS_COL).get()).docs.forEach((d) => {
      const p = d.data().plan === "pro" ? "pro" : "free";
      plans[p]++;
    });
    res.json({
      ok: true,
      stats: {
        users: users.users ? users.users.length : 0,
        artists: docs.length,
        likes: likesS.data().count,
        songLikes: songS.data().count,
        ratings: ratS.data().count,
        playlists: plS.data().count,
        friendships: frS.data().count,
        subscriptions: subsS.data().count,
        plans,
        topLikes,
        tickets: tkS.data().count,
        ticketsOpen: tkOpenS.size,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    let list = [];
    if (firestoreReady) {
      const page = await getAuth().listUsers(1000);
      list = page.users;
    }
    const subs = new Map();
    const subSnap = await db.collection(SUBS_COL).get();
    subSnap.docs.forEach((d) => subs.set(d.id, d.data().plan === "pro" ? "pro" : "free"));
    let rows = list.map((u) => ({
      uid: u.uid,
      name: u.displayName || String(u.email || "").split("@")[0],
      email: u.email || "",
      created: u.metadata && u.metadata.creationTime ? u.metadata.creationTime : "",
      plan: subs.get(u.uid) || "free",
    }));
    if (search)
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(search) || r.email.toLowerCase().includes(search) || r.uid.includes(search)
      );
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);
    res.json({ ok: true, users: rows, total, offset, limit });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/plan", async (req, res) => {
  try {
    const uid = String((req.body && req.body.uid) || "");
    const plan = String((req.body && req.body.plan) || "");
    if (!uid) return res.status(400).json({ ok: false, error: "Falta el uid." });
    if (plan !== "free" && plan !== "pro")
      return res.status(400).json({ ok: false, error: "Plan inválido." });
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible." });
    await setUserPlan(uid, plan, "admin");
    res.json({ ok: true, uid, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/users/:uid", async (req, res) => {
  try {
    const uid = String(req.params.uid);
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible." });
    try {
      await getAuth().deleteUser(uid);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }
    const deletes = [];
    for (const col of [LIKES_COL, SONGLIKES_COL, TASTE_COL, RATINGS_COL, PLAYLISTS_COL, SUBS_COL, TICKETS_COL]) {
      deletes.push(
        db
          .collection(col)
          .where("uid", "==", uid)
          .get()
          .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
      );
    }
    deletes.push(
      db
        .collection(FRIENDS_COL)
        .where("a", "==", uid)
        .get()
        .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
    );
    deletes.push(
      db
        .collection(FRIENDS_COL)
        .where("b", "==", uid)
        .get()
        .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
    );
    await Promise.all(deletes);
    invalidatePlan(uid);
    res.json({ ok: true, uid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- Tiquets de soporte (panel admin) ----
app.get("/api/admin/tickets", async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const status = String(req.query.status || "").trim();
    const search = norm(req.query.search || "");
    if (!firestoreReady) return res.json({ ok: true, tickets: [], total: 0, offset, limit });
    // Sin filtros en la consulta: se filtra en memoria (evita índices compuestos).
    const snap = await db.collection(TICKETS_COL).orderBy("createdAt", "desc").limit(500).get();
    let rows = snap.docs.map((d) => {
      const t = d.data();
      return {
        id: d.id,
        subject: t.subject || "",
        message: t.message || "",
        userName: t.userName || "",
        email: t.email || "",
        uid: t.uid || "",
        status: t.status === "resolved" ? "resolved" : "open",
        createdAt: t.createdAt || "",
      };
    });
    if (status === "open" || status === "resolved") rows = rows.filter((r) => r.status === status);
    if (search)
      rows = rows.filter(
        (r) =>
          norm(r.subject).includes(search) ||
          norm(r.message).includes(search) ||
          norm(r.userName).includes(search) ||
          norm(r.email).includes(search)
      );
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);
    res.json({ ok: true, tickets: rows, total, offset, limit });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/admin/tickets/status", async (req, res) => {
  try {
    const id = String((req.body && req.body.id) || "");
    const status = String((req.body && req.body.status) || "");
    if (!id) return res.status(400).json({ ok: false, error: "Falta el id." });
    if (!TICKET_STATUSES.includes(status))
      return res.status(400).json({ ok: false, error: "Estado inválido (open | resolved)." });
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible." });
    const ref = db.collection(TICKETS_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "Tiquet no encontrado." });
    await ref.update({ status, updatedAt: new Date().toISOString() });
    res.json({ ok: true, id, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/admin/tickets/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!firestoreReady)
      return res.status(503).json({ ok: false, error: "Firestore no disponible." });
    const ref = db.collection(TICKETS_COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "Tiquet no encontrado." });
    await ref.delete();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "No encontrado" });
  if (req.path === "/admin") return res.sendFile(path.join(__dirname, "public", "admin.html"));
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Artistas App en http://localhost:${PORT}`);
    console.log(`Modo Firestore: ${firestoreReady ? "ACTIVO" : "LOCAL (sin clave)"}`);
  });
}

module.exports = app;
