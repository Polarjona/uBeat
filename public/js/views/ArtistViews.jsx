(function () {
  const { useState, useEffect, useRef } = React;

  function SearchBar({ value, onChange, onSearch, loading, onPick }) {
    const [sugs, setSugs] = useState([]);
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    // Sugerencias: busca en el catálogo con debounce mientras escribes.
    useEffect(() => {
      const q = (value || "").trim();
      if (q.length < 2) {
        setSugs([]);
        return undefined;
      }
      let dead = false;
      const t = setTimeout(() => {
        window.ArtistModel.search(q, { limit: 6 })
          .then((r) => {
            if (!dead) setSugs(r.artists || []);
          })
          .catch(() => {
            if (!dead) setSugs([]);
          });
      }, 220);
      return () => {
        dead = true;
        clearTimeout(t);
      };
    }, [value]);

    // Cierra el desplegable al pulsar fuera.
    useEffect(() => {
      if (!open) return undefined;
      const onDown = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    const pick = (a) => {
      setOpen(false);
      const input = wrapRef.current ? wrapRef.current.querySelector("input") : null;
      const rect = input
        ? input.getBoundingClientRect()
        : { top: 60, left: 60, width: 40, height: 40 };
      onPick && onPick(a, rect);
    };

    const show = open && sugs.length > 0 && (value || "").trim().length >= 2;
    return (
      <form
        className="search"
        ref={wrapRef}
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSearch();
        }}
      >
        <span className="search-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" /></svg>
        </span>
        <input
          id="global-search"
          type="text"
          placeholder="Buscar artistas… (p. ej., Queen)"
          autoComplete="off"
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
        />
        <button type="submit">Buscar</button>
        {show && sugs.length > 0 && (
          <ul className="suggestions">
            {sugs.map((a) => (
              <li key={a.id} onClick={() => pick(a)}>{a.name}</li>
            ))}
          </ul>
        )}
      </form>
    );
  }

  function FilterDropdown({
    countries,
    genres,
    country,
    genre,
    open,
    onToggle,
    onChange,
    onClear,
    wrapRef,
  }) {
    const active = (country ? 1 : 0) + (genre ? 1 : 0);
    return (
      <div className="filters-wrap" ref={wrapRef}>
        <button className="btn ghost filters-btn" type="button" onClick={onToggle}>
          Filtros
          {active > 0 ? <span className="badge">{active}</span> : null}
        </button>
        {open ? (
          <div className="filters-panel">
            <label>País</label>
            <select value={country} onChange={(e) => onChange("country", e.target.value)}>
              <option value="">Todos</option>
              {(countries || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label>Género</label>
            <select value={genre} onChange={(e) => onChange("genre", e.target.value)}>
              <option value="">Todos</option>
              {(genres || []).map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <button className="btn ghost clear-btn" type="button" onClick={onClear}>
              Limpiar filtros
            </button>
            <p className="and-note">Los filtros se combinan: país y género.</p>
          </div>
        ) : null}
      </div>
    );
  }

  function SourcePill({ source, health }) {
    const isDb =
      (source || "").includes("firestore") || (source || "").includes("local-seed");
    return (
      <span className={"pill " + (health && health.firestore ? "ok" : "warn")}>
        {health && health.firestore ? "● Firestore conectado" : "● Modo local"}
        {source ? ` · ${source}` : ""}
      </span>
    );
  }

  function ArtistCard({ artist, onSelect }) {
    const [img, setImg] = useState(artist.image);
    return (
      <article
        className="card"
        onClick={(e) => onSelect && onSelect(artist, e.currentTarget.getBoundingClientRect())}
        title="Ver detalle"
      >
        <img
          className="card-img"
          src={img}
          alt={artist.name}
          loading="lazy"
        />
        <span className="card-name">{artist.name}</span>
      </article>
    );
  }

  function ArtistGrid({ artists, onSelect }) {
    return (
      <div className="artist-grid">
        {artists.map((artist) => (
          <ArtistCard artist={artist} onSelect={onSelect} key={artist.id} />
        ))}
      </div>
    );
  }

  function ArtistChart({ artists, onSelect }) {
    return (
      <section className="chart-list">
        {[...artists.entries()].sort((a, b) => b.total - a.total).map((a) => (
          <button
            type="button"
            className="chart-row top"
            title="Ver detalle"
            key={a.id}
          >
            <span className="chart-pos">{a.rank}</span>
            <img
              src={a.image}
              alt=""
              loading="lazy"
            />
            <span className="chart-body">
              <strong>{a.name}</strong>
              <span className="chips">
                <span className="chip chip-accent">{a.genre}</span>
                <span className="chip">{a.country}</span>
              </span>
            </span>
            <span className="chart-cta" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        ))}
      </section>
    );
  }

  function Rail({ title, subtitle, artists, loading, onSelect, showReason }) {
    return (
      <div className="rail">
        <div className="rail-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="rail-nav">
            <button type="button" onClick={() => scroll(-1)} aria-label="Anterior">‹</button>
            <button type="button" onClick={() => scroll(1)} aria-label="Siguiente">›</button>
          </div>
        </div>
        {loading ? (
          <div className="rail-track">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="rail-item" key={i}>
                <SkeletonCard />
              </div>
            ))}
          </div>
        ) : (
          <div className="rail-track">
            {artists.map((it, i) => (
              <div className="rail-item" key={`${it.kind}-${it.id || it.trackId}-${i}`}>
                {it.kind === "artist" ? (
                  <React.Fragment>
                    <ArtistCard artist={it} onSelect={onOpenArtist} />
                    <span className="rail-reason">{it.caption}</span>
                  </React.Fragment>
                ) : (
                  <div
                    className="song-mini"
                    onClick={() => onPlaySong(it)}
                    title="Reproducir"
                  >
                    {it.artwork ? <img src={it.artwork} alt="" loading="lazy" /> : null}
                  </div>
                )
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function ArtistDetail({
    artist,
    rect,
    closing,
    onClose,
    tracks,
    trackIdx,
    playing,
    loadingPreview,
    previewError,
    onToggle,
    onStep,
    onSelectTrack,
    liked,
    onToggleLike,
    songLikeIds,
    onToggleSong,
    onTrackStart,
    rating,
    onRate,
    onExpand,
    playerTrack,
  }) {
    // Rect de expansión desde el modal/bar al reproductor completo.
    const expandRect = () => {
      const bb = document.querySelector('.bottombar');
      if (!bb) return { left: 0, top: 0, width: 0, height: 0 };
      const b = bb.getBoundingClientRect();
      const centerX = b.left + b.width / 2;
      const centerY = b.bottom + 20;
      const w = window.innerWidth * 0.94;
      const h = window.innerHeight * 0.8;
      return {
        left: centerX - w / 2,
        top: centerY - h / 2,
        width: w,
        height: h,
      };
    };

    const [style, setStyle] = useState({ position: "fixed", margin: 0, ...rect });

    useEffect(() => {
      document.body.style.overflow = "hidden";
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setStyle((s) => ({ ...s, ...expandRect() })))
      );
      return () => {
        document.body.style.overflow = "";
        cancelAnimationFrame(raf);
      };
    }, []);

    // Al redimensionar (o girar el móvil) sigue quedando centrado.
    useEffect(() => {
      const onResize = () => setStyle((s) => ({ ...s, ...expandRect() }));
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
      if (closing) setStyle((s) => ({ ...s, opacity: 0, transform: "scale(0.93)" }));
    }, [closing]);

    const [img, setImg] = useState(artist.image);

    // Reproductor in-app (vistas previas de 30 s).
    const audioRef = useRef(null);
    const [progress, setProgress] = useState(0);
    const [curTime, setCurTime] = useState(0);
    const [dur, setDur] = useState(0);
    const current = (tracks || [])[trackIdx];

    useEffect(() => {
      const a = audioRef.current;
      if (!a) return undefined;
      if (playing && current) {
        if (a.src !== current.previewUrl) {
          a.src = current.previewUrl;
          setDur(0);
          setCurTime(0);
          setProgress(0);
          if (onTrackStart)
            onTrackStart({
              artistId: artist.id,
              trackId: current.trackId,
              track: current.track,
              artist: artist.name,
            });
        }
        a.play().catch(() => {});
      } else {
        a.pause();
      }
      return () => a.pause();
    }, [playing, trackIdx, tracks]);

    const seek = (v) => {
      const a = audioRef.current;
      if (a && a.duration) a.currentTime = v * a.duration;
    };

    // Determina si mostramos el botón de expandir (cuando hay una canción reproducida)
    const canExpand = !!playerTrack && !closing;

    return (
      <div
        className={"detail-backdrop" + (closing ? " closing" : "")}
        onClick={onClose}
      >
        <div
          className="detail-panel"
          style={style}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={artist.name}
        >
          <img
            className="detail-img"
            src={img}
            alt={artist.name}
            onError={() => setImg(window.ArtistModel.fallbackImg)}
          />
          <div className={"detail-body" + (closing ? " closing" : "")}>
            <div className="detail-top">
              <HeartButton liked={liked} onToggle={onToggleLike} />
              <button className="btn ghost detail-close" type="button" onClick={onClose}>
                Cerrar ✕
              </button>
            </div>
            <p className="detail-eyebrow">Ficha del artista</p>
            <h2>{artist.name}</h2>
            <div className="meta">
              <span><span className="k">País</span><br /><b>{artist.country}</b></span>
            </div>
            <span className="tag">{artist.genre}</span>

            <div className="rate-box">
              <div className="rate-head">
                <p className="detail-eyebrow">Tu nota al artista</p>
                <span className={"rate-score" + (rating === null || rating === undefined ? "empty" : "")}>
                  {rating === null || rating === undefined ? "—" : `${rating}/10`}
                </span>
              </div>
              <div className="rate-row" role="group" aria-label="Puntuación de 0 a 10">
                {Array.from({ length: 11 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    className={
                      "rate-btn" +
                      (rating !== null && rating !== undefined && n <= rating ? "filled" : "") +
                      (rating === n ? "active" : "")
                    }
                    onClick={() => onRate && onRate(n)}
                    aria-pressed={rating === n}
                    aria-label={`Puntuar ${n} de 10`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="rate-foot">
                <span>
                  {rating === null || rating === undefined
                    ? "Sin puntuar · elige de 0 a 10"
                    : `Valoración: ${rating <= 3 ? "Flojo" : rating <= 6 ? "Regular" : rating <= 8 ? "Muy bueno" : "Excelente"}`}
                </span>
                {rating !== null && rating !== undefined ? (
                  <button type="button" className="link" onClick={() => onRate && onRate(null)}>
                    Quitar nota
                  </button>
                ) : null}
              </div>
            </div>

            <div className="player">
              <p className="detail-eyebrow">Reproducir · Vista previa</p>
              {loadingPreview ? (
                <p className="muted">Cargando vistas previas…</p>
              ) : !(tracks || []).length ? (
                <p className="muted">{previewError || "Sin vistas previas disponibles."}</p>
              ) : current ? (
                <React.Fragment>
                  {current.artwork ? (
                    <img src={current.artwork} alt="" loading="lazy" />
                  ) : null}
                  <div className="player-info">
                    <strong>{current.track}</strong>
                    <span>{current.album}</span>
                  </div>
                  <audio
                    ref={audioRef}
                    preload="metadata"
                    onEnded={() => onStep(1)}
                    onError={() => onStep(1)}
                    onLoadedMetadata={(e) => {
                      const a = e.currentTarget;
                      setDur(a.duration || 0);
                      setCurTime(0);
                      setProgress(0);
                    }}
                    onTimeUpdate={(e) => {
                      const a = e.currentTarget;
                      setCurTime(a.currentTime || 0);
                      setProgress(a.duration ? a.currentTime / a.duration : 0);
                    }}
                  />
                </React.Fragment>
              ) : null}
              </div>
            </div>

            {canExpand && (
              <div className="expand-trigger" style={{ marginTop: 'auto', textAlign: 'center' }}>
                <button type="button" className="crystal-btn secondary" onClick={() => onExpand && onExpand()}>
                  Reproductor completo ⤴
                </button>
              </div>
            )}

            <div className="expand-trigger" style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '100' }} onClick={onClose}>
              ✕
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // --- NUEVO: Pantalla completa Crystal Liquid ---
  function ArtistPlayerScreen({
    isOpen,
    onClose,
    artist,
    track,
    onTogglePlay,
    onExpand,
    lyrics,
    appleMusicUrl,
  }) {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [curTime, setCurTime] = useState(0);
    const [dur, setDur] = useState(0);
    const [lyricIdx, setLyricIdx] = useState(0);

    // Actualizar tiempo de la letra sincronizada
    useEffect(() => {
      if (!playing || !lyrics || lyrics.length === 0) return;
      const timer = setInterval(() => {
        const t = audioRef?.current?.currentTime || 0;
        // Encontrar la línea cuya marca de tiempo es <= t
        const line = lyrics.find((l) => l.time * 1000 <= t * 1000);
        if (line) setLyricIdx(lyrics.indexOf(line));
      }, 200);
      return () => clearInterval(timer);
    }, [playing, lyrics]);

    // Parseo simple de formato LRCLIB: [mm:ss.xx]texto
    const parseLyrics = (lyr) =>
      (lyr || '')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          const m = l.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
          if (!m) return { time: 0, text: l, active: false };
          const mins = parseInt(m[1]),
            secs = parseInt(m[2]),
            ms = parseInt(m[3]);
          return { time: mins * 60 + secs + ms / 1000, text: m[4].trim(), active: false };
          });

    const lyricData = lyrics ? parseLyrics(lyrics) : [];
    const totalLines = lyricData.length;

    // Reiniciar índice al cambiar de canción
    useEffect(() => {
      setLyricIdx(0);
    }, [lyrics]);

    // Reproductor de audio
    const audioRef = useRef(null);
    useEffect(() => {
      if (!playing || !track) return undefined;
      const a = audioRef.current;
      if (a.src !== track.previewUrl) {
        a.src = track.previewUrl;
        setDur(0);
        setCurTime(0);
        setProgress(0);
      }
      if (playing) a.play().catch(() => {});
      a.ontimeupdate = () => {
        setCurTime(a.currentTime || 0);
        setProgress(a.duration ? a.currentTime / a.duration : 0);
      };
      return () => {
        a.ontimeupdate = null;
        a.pause();
      };
    }, [playing, track]);

    const seek = (v) => {
      const a = audioRef.current;
      if (a && a.duration) a.currentTime = v * a.duration;
    };

    // Cerrar pantalla
    const handleClose = () => {
      setPlaying(false);
      onClose && onClose();
    };

    return (
      <div
        className="crystal-liquid screen-enter"
        onClick={handleClose}
        style={{
          width: '100vw',
          height: '100vh',
          margin: 0,
          left: 0,
          top: 0,
        }}
      >
        <div className="crystal-card" style={{
          height: '100%',
          display: 'grid',
          gridTemplateAreas: "'header header'",
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr auto',
          gap: '20px',
          padding: '20px',
        }}>
          {/* Izquierda: Portada + Biografía */}
          <div className="crystal-card crystal-cover" style={{
            gridArea: 'header',
            borderRadius: '20px 20px 0 0',
            backdropFilter: 'blur(20px) saturate(180%)',
            -webkitBackdropFilter: 'blur(20px) saturate(180%)',
          }}>
            <img
              className="cover-float"
              src={artist.image}
              alt={artist.name}
              style={{ width: '100%', height: '260px', objectFit: 'cover', borderRadius: '20px 20px 0 0' }}
            />
            <div style={{
              position: 'absolute',
              bottom: '20px',
              left: '20px',
              right: '20px',
              color: 'var(--text)',
            }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '20px' }}>{artist.name}</h3>
              <p style={{ margin: '0', fontSize: '14px', opacity: '0.8' }}>{artist.bio || 'Sin biografía disponible'}</p>
            </div>
          </div>

          {/* Derecha: Reproductor + Letra */}
          <div className="crystal-card" style={{
            gridArea: 'header',
            background: 'rgba(17, 23, 32, 0.8)',
            backdropFilter: 'blur(20px) saturate(180%)',
            -webkitBackdropFilter: 'blur(20px) saturate(180%)',
            borderRadius: '12px',
            padding: '24px 20px',
          }}>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <button
                type="button"
                className="crystal-btn secondary"
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: 'rgba(255,255,255,0.1)',
                  borderColor: 'rgba(255,255,255,0.15)',
                }}
                onClick={() => window.open(appleMusicUrl || '#', '_blank')}
              >
                Escuchar en Apple Music ▶
              </button>
            </div>

            {/* Barra de progreso cristalina */}
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="player-controls" style={{ margin: '16px 0' }}>
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="crystal-btn"
                style={{ width: '40px', height: '40px', padding: '0', fontSize: '20px' }}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="player-time">
                {fmtTime(curTime)} / {fmtTime(dur || 30)}
              </span>
            </div>

            {/* Letra sincronizada LRCLIB */}
            <div className="lyric-container">
              {lyricData.map((l, i) => (
                <div
                  key={i}
                  className={`lyric-line ${i === lyricIdx ? 'active' : i < lyricIdx - 2 ? 'faded' : ''}`}
                  style={{
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: i === lyricIdx ? 'scale(1.05)' : 'translateY(0)',
                  }}
                >
                  {l.text}
                </div>
              ))
            </div>
          </div>
        </div>
      </div>
    );
  }

  function SongRow({
    song,
    active,
    playing,
    liked,
    onPlay,
    onToggleLike,
    onRemove,
    playlists,
    onAddToPlaylist,
    onGoPlaylists,
    domId,
  }) {
    const [menu, setMenu] = useState(false);
    const [addedId, setAddedId] = useState(null);

    const choose = async (pid) => {
      if (addedId) return;
      await onAddToPlaylist(pid, song);
      setAddedId(pid);
      setTimeout(() => {
        setAddedId(null);
        setMenu(false);
      }, 700);
    };

    return (
      <li className={"song-row" + (active ? " active" : "")} id={domId || undefined}>
        <button type="button" className="song-main" onClick={onPlay}>
          {song.artwork ? <img src={song.artwork} alt="" loading="lazy" /> : null}
          <span className="song-info">
            <strong>{song.track}</strong>
            <span>{song.artist}{song.album ? ` · ${song.album}` : ""}</span>
          </span>
          {active && playing ? <span className="eq" /> : null}
        </button>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="song-menu"
          onClick={() => setMenu(true)}
        >
          <path d="M19 14c0 1-1 1-1 1H5c-1 0-1-1-1-1V8c0-1 1-1 1-1h8c1 0 1 1 1 1v4zM9 18H5v2h4v-2zm6-4h-2l-2-4l2-4h2l2 4l-2 4z" />
        </svg>
        <Menu
          open={menu}
          onRequestClose={() => setMenu(false)}
        >
          <MenuItem onClick={() => choose(p)}>Añadir a playlist</MenuItem>
          <MenuItem onClick={() => choose(p)}>Quitar de playlist</MenuItem>
        </Menu>
      </li>
    );
  }

  function SongList({ songs, currentId, playing, likeIds, onPlay, onToggleLike, onRemove, playlists, onAddToPlaylist, onGoPlaylists, emptyMessage }) {
    if (!songs || !songs.length) {
      return (
        <p className="muted">
          {emptyMessage || "Aún no tienes canciones favoritas. Reproduce una vista previa y pulsa el corazón."}
        </p>
      );
    }
    return (
      <ol>
        {songs.map((song, i) => (
          <li key={song.id || i} className={"song-item" + (i === currentId ? " current" : "")}>
            <button type="button" className="song-item-main" onClick={() => onPlay && onPlay(song)}>
              <img src={song.artwork ? song.artwork : song.image} alt="" loading="lazy" />
              <span className="song-item-name">
                {song.track}
              </span>
              <span className="song-item-artist">{song.artist}</span>
            </button>
          </li>
        ))}
      </ol>
    );
  }

  function DiscoverSlide({ song, index, active, paused, liked, onToggleLike, onOpenArtist, onTrackStart }) {
    return (
      <div className="discover-slide" style={{ zoom: active ? 1.1 : 1 }}>
        <img
          src={song.artwork}
          alt={song.track}
          loading="lazy"
        />
        <div className="discover-info">
          <strong>{song.track}</strong>
          <span>{song.artist}</span>
        </div>
      </div>
    );
  }

  function DiscoverView({}) {
    return (
      <section className="discover">
        <h2>Para ti</h2>
        <div className="discover-grid">
          {[...Array(8)].map((_, i) => (
            <DiscoverSlide
              key={i}
              song: {
                track: `Artista ${i + 1}`,
                artwork: `https://picsum.photos/seed/art${i + 1}/600/600`,
              }
            />
          ))}
        </div>
      </section>
    );
  }

  function ProfileCard({ profile, loading, error, onOpenArtist, onPlaySongs, currentId, playing, likeIds, onToggleLike, own }) {
    return (
      <article className="profile-card">
        <img
          className="profile-img"
          src={profile.image}
          alt={profile.name}
          loading="lazy"
        />
        <div className="profile-name">{profile.name}</div>
        <div className="profile-bio">{profile.bio}</div>
        <button className="btn" onClick={onOpenArtist}>Ver perfil</button>
      </article>
    );
  }

  function PlaylistCreate({ onCreate }) {
    return (
      <div>
        <h3>Crear playlist</h3>
        <input type="text" placeholder="Nombre de la playlist" />
        <button onClick={onCreate}>Crear</button>
      </div>
    );
  }

  function BottomBar({
    queue,
    idx,
    playing,
    closing,
    liked,
    onToggle,
    onStep,
    onToggleLike,
    onClose,
    prefsEnabled,
    onTrackStart,
    onExpand,
  }) {
    const track = (queue || [])[idx];
    const audioRef = useRef(null);
    const [progress, setProgress] = useState(0);
    const [curTime, setCurTime] = useState(0);
    const [dur, setDur] = useState(0);
    const [vol, setVol] = useState(0.9);
    const [muted, setMuted] = useState(false);
    const [open, setOpen] = useState(false);

    // Recuerda el volumen si las preferencias están aceptadas.
    useEffect(() => {
      if (!prefsEnabled) return;
      try {
        const v = Number(localStorage.getItem("aa_vol"));
        if (v > 0 && v <= 1) setVol(v);
      } catch (_) {}
    }, []);

    const saveVol = (v) => {
      setVol(v);
      setMuted(false);
      if (prefsEnabled) {
        try {
          localStorage.setItem("aa_vol", String(v));
        } catch (_) {}
      }
    };

    useEffect(() => {
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => setOpen(true))
      );
      return () => cancelAnimationFrame(r);
    }, []);

    useEffect(() => {
      const a = audioRef.current;
      if (a) a.volume = muted ? 0 : vol;
    }, [vol, muted]);

    useEffect(() => {
      const a = audioRef.current;
      if (!a) return undefined;
      if (playing && track) {
        if (a.src !== track.previewUrl) {
          a.src = track.previewUrl;
          setDur(0);
          setCurTime(0);
          setProgress(0);
          if (onTrackStart)
            onTrackStart({ trackId: track.trackId, track: track.track, artist: track.artist });
        }
        a.play().catch(() => {});
      } else {
        a.pause();
      }
      return () => a.pause();
    }, [playing, idx, queue]);

    if (!track) return null;

    return (
      <div className={"bottombar" + (open && !closing ? " open" : "")}>
        <audio
          ref={audioRef}
          preload="metadata"
          onEnded={() => onStep(1)}
          onError={() => onStep(1)}
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            setDur(a.duration || 0);
            setCurTime(0);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            setCurTime(a.currentTime || 0);
            setProgress(a.duration ? a.currentTime / a.duration : 0);
          }}
        />
        {track.artwork ? <img className="bar-art" src={track.artwork} alt="" /> : null}
        <div className="bar-info">
          <strong>{track.track}</strong>
          <span>{track.artist}</span>
        </div>
        <div className="bar-center">
          <div className="player-controls bar-controls">
            <button type="button" onClick={() => onStep(-1)} aria-label="Anterior">
              <PrevIcon />
            </button>
            <button type="button" className="play" onClick={onToggle} aria-label={playing ? "Pausar" : "Reproducir"}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" onClick={() => onStep(1)} aria-label="Siguiente">
              <NextIcon />
            </button>
          </div>
          <div className="bar-seek">
            <span>{fmtTime(curTime)}</span>
            <input
              className="player-seek"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={progress}
              onChange={(e) => {
                const a = audioRef.current;
                if (a && a.duration) a.currentTime = Number(e.target.value) * a.duration;
              }}
              aria-label="Progreso"
            />
            <span>{fmtTime(dur || 30)}</span>
          </div>
        </div>
        <div className="bar-right">
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
          >
            {muted ? <MuteIcon /> : <VolIcon />}
          </button>
          <input
            className="player-seek vol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : vol}
            onChange={(e) => saveVol(Number(e.target.value))}
            aria-label="Volumen"
          />
          <HeartButton liked={liked} onToggle={() => onToggleLike(track)} />
          <button type="button" className="icon-btn sm expand-btn" onClick={() => onExpand && onExpand()}
            aria-label="Reproductor completo">
            ⤴
          </button>
          <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Cerrar reproductor">
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Carril social: artistas y canciones de amigos con su motivo.
  function SocialRail({ title, subtitle, items, loading, onOpenArtist, onPlaySong }) {
    const trackRef = useRef(null);
    const scroll = (dir) => {
      const el = trackRef.current;
      if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
    };
    if (!loading && (!items || !items.length)) return null;
    return (
      <section className="rail">
        <div className="rail-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="rail-nav">
            <button type="button" onClick={() => scroll(-1)} aria-label="Anterior">‹</button>
            <button type="button" onClick={() => scroll(1)} aria-label="Siguiente">›</button>
          </div>
        </div>
        {loading ? (
          <div className="rail-track">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="rail-item" key={i}>
                <SkeletonCard />
              </div>
            ))}
          </div>
        ) : (
          <div className="rail-track" ref={trackRef}>
            {items.map((it, i) => (
              <div className="rail-item" key={`${it.kind}-${it.id || it.trackId}-${i}`}>
                {it.kind === "artist" ? (
                  <React.Fragment>
                    <ArtistCard artist={it} onSelect={onOpenArtist} />
                    <span className="rail-reason">{it.caption}</span>
                  </React.Fragment>
                ) : (
                  <div
                    className="song-mini"
                    onClick={() => onPlaySong(it)}
                    title="Reproducir"
                  >
                    {it.artwork ? <img src={it.artwork} alt="" loading="lazy" /> : null}
                  </div>
                )
              </div>
            ))}
          </div>
        )
      </section>
    );
  }

  function Loader() {
    return (
      <div className="loader">
        <svg viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
        </svg>
      </div>
    );
  }

  function Hero({ artists }) {
    return (
      <section className="hero">
        <h1>Descubre cantantes</h1>
        <p>Pais, género e imagen de cada artista, rankings y favoritos — sin esperas.</p>
        <button className="btn">Explorar catálogo</button>
        <div className="hero-grid">
          {[...artists].map((artist, i) => (
            <article key={artist.id} className="hero-article">
              <img
                src={artist.image}
                alt={artist.name}
                loading="lazy"
              />
              <h3>{artist.name}</h3>
              <p>{artist.genre}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function ResetPasswordView({ email, loading, error, done, onSubmit, onBack, onGoLogin }) {
    return (
      <div>
        <h3>Restablecer contraseña</h3>
        <p>{error || "Introduce tu email para restablecer la contraseña."}</p>
        <form onSubmit={onSubmit}>
          <input type="email" name="email" placeholder="email@ejemplo.com" required />
          <button type="submit">Enviar</button>
          <button onClick={onBack}>Volver</button>
        </form>
        {done && <p>Se ha enviado un email con instrucciones.</p>}
      </div>
    );
  }

  function SettingsView({}) {
    return (
      <div>
        <h3>Configuración</h3>
        <p>Aquí configurarías la aplicación.</p>
      </div>
    );
  }

  function PlanGate({ user, onLogin, onSettings }) {
    if (!user) {
      return (
        <div>
          <p>Inicia sesión para disfrutar de todas las funciones.</p>
          <button onClick={() => onLogin()}>Entrar</button>
        </div>
      );
    }
    return null;
  }

  function SupportView({}) {
    return (
      <section>
        <h2>Soporte</h2>
        <p>Contacta con nosotros para cualquier consulta.</p>
      </section>
    );
  }

  function SupportFab({ messages, loading, error, onAsk, raised }) {
    return (
      <div>
        <button className="fab" onClick={onAsk}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14l11-7z" /></svg>
        </button>
        {raised && <p>Has lanzado una pregunta.</p>}
      </div>
    );
  }

  function Footer({ onCookies }) {
    return (
      <footer>
        <button onClick={onCookies}>Aceptar cookies</button>
      </footer>
    );
  }

  return {
    SearchBar,
    SourcePill,
    ArtistCard,
    ArtistGrid,
    ArtistChart,
    ArtistDetail,
    ArtistPlayerScreen,
    Loader,
    Hero,
    SkeletonCard,
    SkeletonGrid,
    SkeletonChart,
    FilterDropdown,
    Footer,
    Rail,
    SideMenu,
    AuthModal,
    HeartButton,
    SongRow,
    SongList,
    BottomBar,
    PlaylistCreate,
    ResetPasswordView,
    CookieBanner,
    SettingsView,
    SocialRail,
    FriendProfile,
    ProfileCard,
    DiscoverView,
    PlanGate,
    SupportView,
    SupportFab,
  };
})();