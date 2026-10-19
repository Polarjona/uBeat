"""
Alinea las previews de iTunes con la letra sincronizada de LRCLIB.

Cada sello corta la preview donde quiere (a veces el inicio, a veces el
estribillo), así que la letra no siempre empieza en el segundo 0 de la
preview. Este script calcula ese desplazamiento ("offset") pista a pista:

  1. Baja la preview (m4a) y la transcribe con faster-whisper (marcas por
     palabra, sin claves ni servicios externos).
  2. Pide la letra sincronizada al servidor local (usa la caché y los
     reintentos de /api/lyrics).
  3. Vota el offset que mejor casa las palabras transcritas con las de la
     letra y lo guarda en scripts/preview-offsets.json.

Después, `node scripts/guardar-offsets.js` sube el JSON a Firestore
(colección `preview_offsets`, documentada por trackId) y el servidor lo
devuelve en /api/lyrics como `previewOffset`.

Requisitos:
  - Servidor local corriendo (npm start, puerto 8080).
  - pip install faster-whisper numpy

Uso:
  python scripts/alinear-previews.py --artista "Shawn Mendes"
  python scripts/alinear-previews.py --limite 10        # 10 primeros artistas
  python scripts/alinear-previews.py                    # todo el catálogo
  python scripts/alinear-previews.py --archivo pistas.json
  python scripts/alinear-previews.py --modelo tiny      # más rápido
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

# ---------------------------------------------------------------------------
# Ajustes
# ---------------------------------------------------------------------------
SERVIDOR = "http://localhost:8080"
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview-offsets.json")
MODELO_CACHE = os.path.join(os.environ.get("TEMP", "."), "whisper-modelos")
MIN_PESO = 4.0       # mínimo de "peso" de un clúster para fiarse de un offset
SEMI = 8.0           # decaimiento del peso: peso = 1 / (1 + t_preview / 8)
EMPATE = 0.8         # clúster con ≥ 80 % del peso del ganador = casi empatado
DISTANCIA_RIVAL = 6  # segundos mínimos entre clústeres rivales
UA = "uBeat/1.0 (https://github.com/Polarjona/uBeat)"


def http_json(url, intentos=4):
    """GET con reintentos; devuelve el JSON o None si el servidor está caído."""
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - reintentamos ante cualquier fallo
            if i == intentos - 1:
                print(f"    ! sin respuesta de {url}: {e}")
                return None
            time.sleep(1.5 * (i + 1))
    return None


def pedir_letra(track, base):
    """Letra sincronizada desde el servidor local (con su caché/fallback)."""
    p = urllib.parse.urlencode(
        {
            "artist": track.get("artist", ""),
            "title": track.get("track", ""),
            "album": track.get("album", ""),
            "duration": str(int(track.get("durationMs") or 0) // 1000 or ""),
            "trackId": str(track.get("trackId") or ""),
        }
    )
    for intento in range(3):
        data = http_json(f"{base}/api/lyrics?{p}")
        if data is None:
            return None
        if data.get("cooled"):
            # LRCLIB limitado: esperamos y reintentamos (no es "sin letra").
            print("    LRCLIB enfriado, espero 30 s…")
            time.sleep(30)
            continue
        return data.get("syncedLyrics")
    return None


def descargar_preview(url, ruta):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        datos = r.read()
    with open(ruta, "wb") as f:
        f.write(datos)
    return len(datos)


def cargar_audio(ruta):
    """m4a/aac -> numpy float32 mono a 16 kHz (pyav, incluido con faster-whisper)."""
    import av

    with av.open(ruta) as cont:
        stream = cont.streams.audio[0]
        res = av.AudioResampler(format="flt", layout="mono", rate=16000)
        trozos = []
        for frame in cont.decode(stream):
            frame.pts = None
            for salida in res.resample(frame):
                trozos.append(salida.to_ndarray().reshape(-1))
        try:
            for salida in res.resample(None):  # flush
                trozos.append(salida.to_ndarray().reshape(-1))
        except Exception:  # noqa: BLE001 - sin flush no pasa nada para ASR
            pass
    if not trozos:
        raise ValueError("audio vacío")
    return np.concatenate(trozos).astype(np.float32)


def transcribir(modelo, ruta, idioma=None):
    """-> [(tiempo_en_preview, palabra_normalizada), …]"""
    x = cargar_audio(ruta)
    # Sin VAD: silero se come la voz cantada con producción pop (probado:
    # 11 palabras con VAD frente a 58 sin él). Y sin contexto previo para
    # que whisper no entre en bucles de repetición sobre música.
    segmentos, _ = modelo.transcribe(
        x,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=False,
        language=idioma,
        beam_size=5,
    )
    palabras = []
    for seg in segmentos:
        for w in seg.words or []:
            palabra = normalizar(w.word)
            if palabra:
                palabras.append((float(w.start), palabra))
    return palabras


# ---------------------------------------------------------------------------
# Letra: línea de tiempo palabra a palabra
# ---------------------------------------------------------------------------
def normalizar(texto):
    texto = texto.lower().strip()
    texto = re.sub(r"[^a-z0-9']+", "", texto)
    return texto.strip("'")


def palabras_de_letra(synced):
    """LRCLIB da tiempos por línea; repartimos sus palabras dentro de la línea
    (acotado, para no arrastrar los silencios instrumentales)."""
    lineas = []
    for l in (synced or "").split("\n"):
        m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)$", l)
        if m:
            texto = m[3].strip()
            if texto:
                lineas.append((int(m.group(1)) * 60 + float(m.group(2)), texto))
    lineas.sort(key=lambda x: x[0])
    salida = []
    for i, (t, texto) in enumerate(lineas):
        sig = lineas[i + 1][0] if i + 1 < len(lineas) else t + 4
        span = min(sig - t, max(1.0, len(texto) / 5.0))
        toks = [normalizar(w) for w in re.split(r"\s+", texto)]
        toks = [w for w in toks if w]
        if not toks:
            continue
        for j, w in enumerate(toks):
            salida.append((t + span * (j + 0.5) / len(toks), w))
    return salida


def le1(a, b):
    """¿Distancia de edición ≤ 1? (rápido: solo inserts/borra/sustituye)"""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if la > lb:
        a, b, la, lb = b, a, lb, la
    if lb - la > 1:
        return False
    i = j = 0
    diferencias = 0
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        else:
            diferencias += 1
            if diferencias > 1:
                return False
            if la == lb:
                i += 1
                j += 1
            else:
                j += 1  # inserción en b
    return True


def empareja(a, b):
    if not a or not b:
        return False
    if a == b:
        return True
    # Las palabras cortas ("the", "she") casan con demasiadas: solo exactas.
    if max(len(a), len(b)) <= 4:
        return False
    return le1(a, b)


# ---------------------------------------------------------------------------
# Votación del offset
# ---------------------------------------------------------------------------
def alinear(palabras_prev, palabras_letra, duracion_s):
    """offset = segundo de la CANCIÓN donde empieza la preview.

    Las palabras transcritas que casan con la letra votan offset = t_letra −
    t_preview, con un peso que decae según cae el tiempo dentro de la
    preview: las primeras palabras son las que hay que situar EN el offset
    (siempre), mientras que las últimas pueden coincidir por azar con un
    estribillo repetido. Así el coro repetido no le roba el pico al tramo
    correcto (p. ej. Stitches, con tres coros casi idénticos).

    Si además hay clústeres casi empatados, nos quedamos con el de offset
    más bajo: los sellos suelen cortar el primer estribillo.
    """
    votos = []  # (offset, peso)
    for tp, wp in palabras_prev:
        if len(wp) < 4:
            continue
        peso = 1.0 / (1.0 + tp / SEMI)
        for tl, wl in palabras_letra:
            if empareja(wp, wl):
                votos.append((tl - tp, peso))
    if len(votos) < 4:
        return None
    # Clústeres por unión de votos con ≤ 3 s entre vecinos.
    votos.sort(key=lambda v: v[0])
    clu = []  # [[offsets…], [pesos…]] por clúster
    for off, peso in votos:
        if clu and off - clu[-1][0][-1] <= 3:
            clu[-1][0].append(off)
            clu[-1][1].append(peso)
        else:
            clu.append(([off], [peso]))
    fuertes = [(statistics.median(o), sum(p)) for o, p in clu if sum(p) >= MIN_PESO]
    if not fuertes:
        return None
    mejor = max(fuertes, key=lambda c: c[1])
    casi = [c for c in fuertes if c[1] >= EMPATE * mejor[1]]
    elegido = min(casi, key=lambda c: c[0])
    rival = max(
        (p for off, p in fuertes if abs(off - elegido[0]) > DISTANCIA_RIVAL),
        default=0.0,
    )
    offset = elegido[0]
    if offset < -2:
        return None  # inconsistente (la preview no empieza antes del tema)
    if duracion_s and offset > duracion_s - 25:
        return None  # la preview no cabe en la canción
    if offset < 0:
        offset = 0.0
    return {
        "offset": round(offset, 2),
        "confidence": round(elegido[1] / (elegido[1] + rival), 2),
        "votes": round(elegido[1], 1),
    }


# ---------------------------------------------------------------------------
# Fuentes de pistas
# ---------------------------------------------------------------------------
def pistas_de_artista(nombre, base):
    data = http_json(f"{base}/api/artists/preview?{urllib.parse.urlencode({'artist': nombre})}")
    if not data or not data.get("ok"):
        return []
    return data.get("tracks") or []


def cargar_catalogo(base, limite, desde=0):
    data = http_json(f"{base}/api/artists")
    if not data or not data.get("ok"):
        print("!! No puedo leer el catálogo del servidor local.")
        return []
    nombres = [a.get("name") for a in data.get("artists") or [] if a.get("name")]
    nombres = nombres[desde:]
    if limite > 0:
        nombres = nombres[:limite]
    print(f"Catálogo: {len(nombres)} artistas (desde {desde})")
    todas = []
    for i, nombre in enumerate(nombres, 1):
        tr = pistas_de_artista(nombre, base)
        print(f"  [{i}/{len(nombres)}] {nombre}: {len(tr)} pistas")
        todas.extend(tr)
    return todas


def cargar_archivo(ruta):
    with open(ruta, encoding="utf-8") as f:
        datos = json.load(f)
    if isinstance(datos, dict):
        datos = datos.get("tracks") or []
    return datos


def leer_salida(ruta=SALIDA):
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    return {}


def guardar_salida(tabla, ruta=SALIDA):
    tmp = ruta + ".tmp"
    # Windows: el antivirus o el índice pueden bloquear el fichero un
    # instante y os.replace lanza PermissionError; reintentamos antes de
    # rendirnos (los datos siguen en memoria, el siguiente track vuelve a
    # intentar la escritura igualmente).
    for intento in range(6):
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(tabla, f, ensure_ascii=False, indent=1)
            os.replace(tmp, ruta)
            return
        except PermissionError:
            time.sleep(0.4 * (intento + 1))
    print("  ! no puedo escribir " + ruta + " (bloqueado), se reintenta en el próximo track")


def rellenar_desde_itunes(track):
    """Pistas de la cola de pendientes: sin previewUrl, la traemos de iTunes."""
    tid = track.get("trackId")
    if not tid or track.get("previewUrl"):
        return track
    data = http_json(f"https://itunes.apple.com/lookup?id={tid}&country=ES")
    r = (data or {}).get("results") or []
    if not r:
        return track
    t = r[0]
    track["previewUrl"] = t.get("previewUrl") or ""
    track["track"] = track.get("track") or t.get("trackName") or ""
    track["artist"] = track.get("artist") or t.get("artistName") or ""
    track["album"] = track.get("album") or t.get("collectionName") or ""
    track["durationMs"] = track.get("durationMs") or t.get("trackTimeMillis") or 0
    return track


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Calcula el offset de preview por ASR")
    ap.add_argument("--artista", action="append", default=[], help="artista (repetible)")
    ap.add_argument("--archivo", help="JSON con la lista de pistas")
    ap.add_argument("--limite", type=int, default=0, help="N artistas del catálogo (tras --desde)")
    ap.add_argument("--desde", type=int, default=0, help="saltar los N primeros artistas del catálogo")
    ap.add_argument("--salida", default=SALIDA, help="fichero de salida (trabajos en paralelo)")
    ap.add_argument("--modelo", default="base", help="whisper: base (defecto), tiny, small…")
    ap.add_argument("--idioma", default=None, help="forzar idioma (en, es…); autodetección si se omite")
    ap.add_argument("--servidor", default=SERVIDOR)
    ap.add_argument("--reintentar", action="store_true", help="recalcular aunque ya tenga offset")
    args = ap.parse_args()

    if args.archivo:
        pistas = cargar_archivo(args.archivo)
    elif args.artista:
        pistas = []
        for nombre in args.artista:
            pistas.extend(pistas_de_artista(nombre, args.servidor))
    else:
        pistas = cargar_catalogo(args.servidor, args.limite, args.desde)
    if not pistas:
        print("No hay pistas que procesar.")
        return

    # Sin trackId no hay dónde guardar el offset. Sin previewUrl (pistas de
    # la cola de pendientes) la traemos de iTunes por su id.
    pistas = [p for p in pistas if p.get("trackId")]
    pistas = [rellenar_desde_itunes(p) for p in pistas]
    pistas = [p for p in pistas if p.get("previewUrl")]
    salida = args.salida
    ya = leer_salida(salida)
    if salida != SALIDA:
        # Con trabajos en paralelo respetamos también el fichero principal.
        for k, v in leer_salida(SALIDA).items():
            ya.setdefault(k, v)
    if not args.reintentar:
        antes = len(pistas)
        pistas = [p for p in pistas if str(p["trackId"]) not in ya]
        if antes != len(pistas):
            print(f"{antes - len(pistas)} pistas ya calculadas, se omiten.")
    if not pistas:
        print("Nada pendiente.")
        return

    from faster_whisper import WhisperModel

    print(f"Cargando whisper '{args.modelo}'…")
    modelo = WhisperModel(args.modelo, device="cpu", compute_type="int8",
                          download_root=MODELO_CACHE)

    ok = fallos = sin_letra = 0
    for n, track in enumerate(pistas, 1):
        tid = str(track["trackId"])
        titulo = f"{track.get('track', '?')} — {track.get('artist', '?')}"
        print(f"[{n}/{len(pistas)}] {titulo}")
        letra = pedir_letra(track, args.servidor)
        if not letra:
            sin_letra += 1
            print("    sin letra sincronizada, se omite")
            continue
        ruta = os.path.join(MODELO_CACHE, f"preview-{tid}.m4a")
        try:
            descargar_preview(track["previewUrl"], ruta)
            prev = transcribir(modelo, ruta, args.idioma)
        except Exception as e:  # noqa: BLE001 - una pista mala no corta el lote
            fallos += 1
            print(f"    ! fallo de audio/ASR: {e}")
            continue
        finally:
            if os.path.exists(ruta):
                try:
                    os.remove(ruta)
                except OSError:
                    pass
        if not prev:
            fallos += 1
            print("    ! transcripción vacía (¿instrumental?)")
            continue
        dur_s = int(track.get("durationMs") or 0) // 1000
        r = alinear(prev, palabras_de_letra(letra), dur_s)
        if not r:
            fallos += 1
            print(f"    offset no fiable ({len(prev)} palabras transcritas)")
            continue
        ya[tid] = {
            "trackId": track["trackId"],
            "track": track.get("track", ""),
            "artist": track.get("artist", ""),
            "album": track.get("album", ""),
            "offset": r["offset"],
            "confidence": r["confidence"],
            "votes": r["votes"],
            "durationMs": track.get("durationMs") or 0,
            "modelo": args.modelo,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        guardar_salida(ya, salida)  # guardado incremental: se puede cortar en cualquier momento
        ok += 1
        print(f"    offset = {r['offset']} s (confianza {r['confidence']}, {r['votes']} votos)")

    print(f"\nListo: {ok} offsets nuevos, {fallos} descartados, {sin_letra} sin letra.")
    print(f"Guardado en {salida}")
    print("Siguiente paso: node scripts/guardar-offsets.js")


if __name__ == "__main__":
    sys.exit(main())
