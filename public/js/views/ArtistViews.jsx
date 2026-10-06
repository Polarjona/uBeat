/**
 * MVC — VISTAS (React)
 * --------------------
 * Componentes "tontos": solo pintan lo que el Controlador les pasa.
 * No llaman al Modelo directamente.
 */
const { useState, useEffect, useRef } = React;

window.ArtistaViews = (function () {
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
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "…" : "Buscar"}
        </button>
        {show ? (
          <div className="search-sug" role="listbox">
            {sugs.map((a) => (
              <button
                type="button"
                key={String(a.id) + a.name}
                className="sug-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(a)}
              >
                {a.image ? (
                  <img src={a.image} alt="" loading="lazy" />
                ) : (
                  <span className="sug-ph">♪</span>
                )}
                <span className="sug-name">
                  <strong>{a.name}</strong>
                  <small>
                    {a.country}
                    {a.genre ? ` · ${a.genre}` : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </form>
    );
  }

  // Desplegable "Filtros": país y género se combinan con AND
  // (el artista debe cumplir ambos a la vez).
  function FilterDropdown({
    countries,
    genres,
    country,
    genre,
    open,
    onToggle,
    onChange,
    onClear,
  }) {
    const active = (country ? 1 : 0) + (genre ? 1 : 0);
    return (
      <div className="filters-wrap">
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
        <div className="card-media">
          <img
            src={img}
            alt={artist.name}
            loading="lazy"
            onError={() => setImg(window.ArtistModel.fallbackImg)}
          />
          <span className="card-cta" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
        <div className="card-body">
          <h3>{artist.name}</h3>
          <div className="chips">
            <span className="chip chip-accent">{artist.genre}</span>
            <span className="chip">{artist.country}</span>
          </div>
        </div>
      </article>
    );
  }

  function ArtistGrid({ artists, onSelect }) {
    if (!artists || artists.length === 0) {
      return (
        <div className="center" style={{ padding: "30px 0", color: "#9aa3b5" }}>
          <p><strong>Sin resultados.</strong></p>
          <p>Prueba con otro nombre o ajusta los filtros.</p>
        </div>
      );
    }
    return (
      <section className="grid">
        {artists.map((a) => (
          <ArtistCard key={String(a.id) + a.name} artist={a} onSelect={onSelect} />
        ))}
      </section>
    );
  }

  // Catálogo "Todos los artistas": filas tipo chart (posición + avatar + chips).
  function ArtistChart({ artists, onSelect }) {
    if (!artists || artists.length === 0) {
      return (
        <div className="center" style={{ padding: "30px 0", color: "#9aa3b5" }}>
          <p><strong>Sin resultados.</strong></p>
          <p>Prueba con otro nombre o ajusta los filtros.</p>
        </div>
      );
    }
    return (
      <section className="chart-list">
        {artists.map((a, i) => (
          <button
            key={String(a.id) + a.name}
            type="button"
            className={"chart-row" + (i < 3 ? " top" : "")}
            onClick={(e) => onSelect && onSelect(a, e.currentTarget.getBoundingClientRect())}
            title="Ver detalle"
          >
            <span className="chart-pos">{i + 1}</span>
            <img
              src={a.image}
              alt=""
              loading="lazy"
              onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = window.ArtistModel.fallbackImg; }}
            />
            <span className="chart-body">
              <strong>{a.name}</strong>
              <span className="chips">
                <span className="chip chip-accent">{a.genre}</span>
                <span className="chip">{a.country}</span>
              </span>
            </span>
            <span className="chart-cta" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </button>
        ))}
      </section>
    );
  }

  // Carrusel horizontal de una fila con flechas de desplazamiento.
  function Rail({ title, subtitle, artists, loading, onSelect, showReason }) {
    const trackRef = useRef(null);
    const scroll = (dir) => {
      const el = trackRef.current;
      if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
    };
    if (!loading && (!artists || !artists.length)) return null;
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
            {artists.map((a, i) => (
              <div className="rail-item" key={String(a.id) + i}>
                <span className="rail-pos">{a.chartPos || i + 1}</span>
                <ArtistCard artist={a} onSelect={onSelect} />
                {showReason && a.reason ? (
                  <span className="rail-reason">{a.reason}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  // Skeleton de tarjeta (carga percepción más rápida que el spinner).
  function SkeletonCard() {
    return (
      <div className="sk sk-card">
        <div className="sk-media" />
        <div className="sk-body">
          <span className="sk-line w70" />
          <span className="sk-line w45" />
        </div>
      </div>
    );
  }

  function SkeletonGrid({ n = 8 }) {
    return (
      <section className="grid">
        {Array.from({ length: n }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </section>
    );
  }

  function SkeletonChart({ n = 8 }) {
    return (
      <section className="chart-list">
        {Array.from({ length: n }, (_, i) => (
          <div className="sk sk-row" key={i}>
            <span className="sk-line sk-num" />
            <span className="sk-avatar" />
            <span className="sk-body" style={{ flex: 1, padding: 0 }}>
              <span className="sk-line w70" />
              <span className="sk-line w45" />
            </span>
          </div>
        ))}
      </section>
    );
  }

  // Sidebar fijo con iconos: navegación principal + social + usuario.
  const SIDE_ICONS = {
    home: "M12 3.2 3 11h2.5v9h5v-6h3v6h5v-9H21z",
    discover: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z",
    favorites:
      "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
    favSongs: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
    playlists: "M3 6h12v2H3V6zm0 4h12v2H3v-2zm0 4h8v2H3v-2zm14-1v7.2l5-3.1z",
    support:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41a2 2 0 1 0-4 0H8a4 4 0 1 1 8 0c0 .88-.36 1.68-.93 2.25z",
    social:
      "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    settings:
      "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  };
  const SideIcon = ({ name }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={SIDE_ICONS[name]} />
    </svg>
  );

  function SideMenu({ open, view, user, plan, favCount, songFavCount, plCount, onGo, onClose, onUsers, onLogout, onOpenMyProfile, onGoSettings, social, onAddFriend, onRespondFriend, onRemoveFriend, onOpenFriend }) {
    const [socialOpen, setSocialOpen] = useState(true);
    const [friendEmail, setFriendEmail] = useState("");
    const sendInvite = (e) => {
      e.preventDefault();
      if (friendEmail.trim()) {
        onAddFriend(friendEmail.trim());
        setFriendEmail("");
      }
    };
    const initials = (n) => String(n || "?").charAt(0).toUpperCase();
    const nav = [
      { key: "home", label: "Inicio", icon: "home" },
      { key: "discover", label: "Descubrir", icon: "discover" },
      { key: "favorites", label: "Favoritos", icon: "favorites", count: favCount, full: "Mis artistas favoritos" },
      { key: "favSongs", label: "Canciones", icon: "favSongs", count: songFavCount, full: "Mis canciones favoritas" },
      { key: "playlists", label: "Playlists", icon: "playlists", count: plCount, full: "Playlists" },
      { key: "support", label: "Soporte", icon: "support", full: "Soporte" },
    ];
    return (
      <React.Fragment>
        <div className={"drawer-scrim" + (open ? " open" : "")} onClick={onClose} />
        <aside className={"drawer" + (open ? " open" : "")} aria-label="Menú">
          <div className="drawer-head">
            <button
              type="button"
              className="side-logo"
              onClick={() => {
                onGo("home");
                onClose();
              }}
              title="Ir al inicio"
            >
              <span className="disc">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
              </span>
              <span className="side-logo-txt">
                uBeat
                <small>Descubre cantantes</small>
              </span>
            </button>
            <button type="button" className="side-close" onClick={onClose} aria-label="Cerrar menú">✕</button>
          </div>
          <div className="drawer-nav">
            {nav.map((n) => (
              <button
                key={n.key}
                type="button"
                title={n.full || n.label}
                className={view === n.key ? "drawer-item active" : "drawer-item"}
                onClick={() => {
                  onGo(n.key);
                  onClose();
                }}
              >
                <SideIcon name={n.icon} />
                <span className="side-label">{n.label}</span>
                {user && n.count > 0 ? <span className="side-count">{n.count}</span> : null}
              </button>
            ))}
          </div>
          {plan === "pro" ? (
          <div className="drawer-social">
            <button
              type="button"
              className="drawer-item social-head"
              onClick={() => setSocialOpen((o) => !o)}
            >
              <SideIcon name="social" />
              <span className="side-label">Social{social && social.friends.length > 0 ? ` (${social.friends.length})` : ""}</span>
              <span>{socialOpen ? "▾" : "▸"}</span>
            </button>
            <div className={"social-body" + (socialOpen ? " open" : "")}>
                {!user ? (
                  <p className="muted">Inicia sesión para añadir amigos.</p>
                ) : (
                  <React.Fragment>
                    <form className="social-add" onSubmit={sendInvite}>
                      <input
                        type="email"
                        value={friendEmail}
                        onChange={(e) => setFriendEmail(e.target.value)}
                        placeholder="Email de tu amigo"
                        required
                      />
                      <button className="btn" type="submit">Añadir</button>
                    </form>
                    {social && social.error ? <div className="error sm">{social.error}</div> : null}
                    {social && social.pendingIn.length > 0 ? (
                      <React.Fragment>
                        <p className="social-title">Solicitudes</p>
                        {social.pendingIn.map((p) => (
                          <div className="friend-row" key={p.uid}>
                            <span className="avatar sm">{initials(p.name)}</span>
                            <span className="fname">{p.name}</span>
                            <button type="button" className="mini-ok" onClick={() => onRespondFriend(p.uid, true)} aria-label="Aceptar">✓</button>
                            <button type="button" className="mini-no" onClick={() => onRespondFriend(p.uid, false)} aria-label="Rechazar">✕</button>
                          </div>
                        ))}
                      </React.Fragment>
                    ) : null}
                    {social && social.friends.length > 0 ? (
                      <React.Fragment>
                        <p className="social-title">Amigos</p>
                        {social.friends.map((f) => (
                          <div className="friend-row" key={f.uid}>
                            <button type="button" className="friend-open" onClick={() => onOpenFriend(f.uid)}>
                              <span className="avatar sm">{initials(f.name)}</span>
                              <span className="fname">{f.name}</span>
                            </button>
                            <button type="button" className="mini-no" onClick={() => onRemoveFriend(f.uid)} aria-label="Eliminar">✕</button>
                          </div>
                        ))}
                      </React.Fragment>
                    ) : (
                      <p className="muted">Aún no tienes amigos. Invita por email.</p>
                    )}
                    {social && social.pendingOut.length > 0 ? (
                      <p className="muted">Pendientes: {social.pendingOut.map((p) => p.name).join(", ")}</p>
                    ) : null}
                  </React.Fragment>
                )}
              </div>
          </div>
          ) : (
          <div className="drawer-social drawer-social-locked">
            <button type="button" className="drawer-item social-head" onClick={onGoSettings}>
              <SideIcon name="social" />
              <span className="side-label">Social</span>
              <span className="pill-pro">PRO</span>
            </button>
            <div className="social-body open">
              <p className="muted">Añadir amigos y ver su actividad es una función del plan PRO.</p>
              <button type="button" className="btn" onClick={onGoSettings}>Ver plan</button>
            </div>
          </div>
          )}
          <div className="drawer-foot">
            <button
              type="button"
              className={view === "settings" ? "drawer-item active" : "drawer-item"}
              onClick={() => {
                onGoSettings();
                onClose();
              }}
            >
              <SideIcon name="settings" />
              <span className="side-label">Ajustes</span>
            </button>
            {user ? (
              <button type="button" className="user-open" onClick={onOpenMyProfile} title="Mi perfil">
                <span className="avatar sm">{initials(user.name)}</span>
                <span className="fname">{user.name}</span>
                {plan === "pro" ? <span className="pill-pro">PRO</span> : null}
              </button>
            ) : (
              <button type="button" className="user-open" onClick={onUsers} title="Iniciar sesión">
                <span className="avatar sm">?</span>
                <span className="fname">Inicia sesión</span>
              </button>
            )}
          </div>
        </aside>
      </React.Fragment>
    );
  }

  // Modal de registro / inicio de sesión / recuperación.
  function AuthModal({ mode, loading, error, notice, onMode, onLogin, onRegister, onForgot, onClose }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const submit = (e) => {
      e.preventDefault();
      if (mode === "register") onRegister(name, email, password);
      else if (mode === "forgot") onForgot(email);
      else onLogin(email, password);
    };
    return (
      <div className="modal-scrim" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Usuarios">
          <div className="modal-head">
            <strong>Usuarios</strong>
            <button type="button" onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
          {mode === "login" || mode === "register" ? (
            <div className="tabs">
              <button
                type="button"
                className={mode === "login" ? "tab active" : "tab"}
                onClick={() => onMode("login")}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                className={mode === "register" ? "tab active" : "tab"}
                onClick={() => onMode("register")}
              >
                Registrarse
              </button>
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}
          {notice ? <div className="notice-ok">{notice}</div> : null}
          {mode === "forgot" ? (
            <form onSubmit={submit}>
              <p className="muted">Escribe tu correo y recibirás un enlace para crear una nueva contraseña.</p>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <button className="btn full" type="submit" disabled={loading}>
                {loading ? "…" : "Enviar enlace"}
              </button>
              <button type="button" className="link back auth-back" onClick={() => onMode("login")}>
                ← Volver a iniciar sesión
              </button>
            </form>
          ) : (
            <form onSubmit={submit}>
              {mode === "register" ? (
                <label>
                  Nombre
                  <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
              ) : null}
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                Contraseña
                <input
                  type="password"
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <button className="btn full" type="submit" disabled={loading}>
                {loading ? "…" : mode === "register" ? "Crear cuenta" : "Entrar"}
              </button>
              {mode === "login" ? (
                <React.Fragment>
                  <button type="button" className="link auth-back" onClick={() => onMode("forgot")}>
                    He olvidado mi contraseña
                  </button>
                  <p className="recaptcha-note">
                    Protegido por reCAPTCHA. Se aplican la{" "}
                    <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacidad</a>{" "}
                    y las{" "}
                    <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Condiciones</a>{" "}
                    de Google.
                  </p>
                </React.Fragment>
              ) : null}
            </form>
          )}
        </div>
      </div>
    );
  }

  // Corazón de Me gusta: incoloro que se tiñe con animación.
  function HeartButton({ liked, onToggle }) {
    const [pop, setPop] = useState(false);
    const click = () => {
      if (!liked) {
        setPop(true);
        setTimeout(() => setPop(false), 450);
      }
      onToggle();
    };
    return (
      <button
        type="button"
        className={"heart" + (liked ? " liked" : "") + (pop ? " pop" : "")}
        onClick={click}
        aria-label="Me gusta"
        title="Me gusta"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
      </button>
    );
  }
  const PlayIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  );
  const PauseIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
  );
  const PrevIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zM18 6l-8.5 6L18 18z" /></svg>
  );
  const NextIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" /></svg>
  );

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
  }) {
    const targetRect = () => {
      const content = document.querySelector(".content");
      const off = content ? parseFloat(getComputedStyle(content).marginLeft) || 0 : 0;
      const availW = Math.max(360, window.innerWidth - off);
      const w = Math.min(880, availW * 0.94);
      const h = Math.min(700, window.innerHeight * 0.86);
      return {
        left: off + (availW - w) / 2,
        top: (window.innerHeight - h) / 2,
        width: w,
        height: h,
      };
    };

    const [style, setStyle] = useState({ position: "fixed", margin: 0, ...rect });

    useEffect(() => {
      document.body.style.overflow = "hidden";
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setStyle((s) => ({ ...s, ...targetRect() })))
      );
      return () => {
        document.body.style.overflow = "";
        cancelAnimationFrame(raf);
      };
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
                <span className={"rate-score" + (rating === null || rating === undefined ? " empty" : "")}>
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
                      (rating !== null && rating !== undefined && n <= rating ? " filled" : "") +
                      (rating === n ? " active" : "")
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
                  <div className="player-main">
                    {current.artwork ? (
                      <img src={current.artwork} alt="" loading="lazy" />
                    ) : null}
                    <div className="player-info">
                      <strong>{current.track}</strong>
                      <span>{current.album}</span>
                    </div>
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
                  <input
                    className="player-seek"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={progress}
                    style={{
                      background: `linear-gradient(90deg, var(--accent) ${Math.round(progress * 100)}%, var(--surface-3) ${Math.round(progress * 100)}%)`,
                    }}
                    onChange={(e) => seek(Number(e.target.value))}
                    aria-label="Progreso"
                  />
                  <div className="player-controls">
                    <button type="button" onClick={() => onStep(-1)} aria-label="Anterior">
                      <PrevIcon />
                    </button>
                    <button type="button" className="play" onClick={onToggle} aria-label={playing ? "Pausar" : "Reproducir"}>
                      {playing ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button type="button" onClick={() => onStep(1)} aria-label="Siguiente">
                      <NextIcon />
                    </button>
                    <span className="player-time">
                      {fmtTime(curTime)} / {fmtTime(dur || 30)}
                    </span>
                  </div>
                  <ol className="track-list">
                    {tracks.map((t, i) => {
                      const sLiked = (songLikeIds || []).some(
                        (id) => String(id) === String(t.trackId)
                      );
                      return (
                        <li key={t.previewUrl + i} className={i === trackIdx ? "active" : ""}>
                          <button type="button" className="row-play" onClick={() => onSelectTrack(i)}>
                            <span className="n">{i + 1}</span>
                            <span className="t">{t.track}</span>
                            {i === trackIdx && playing ? <span className="eq" /> : null}
                          </button>
                          <button
                            type="button"
                            className={"heart sm" + (sLiked ? " liked" : "")}
                            onClick={() => onToggleSong && onToggleSong(t)}
                            aria-label="Me gusta en esta canción"
                            title="Me gusta"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </React.Fragment>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fila de canción favorita: imagen a la izquierda + reproducir.
  // Con menú ⋮ para añadirla a una playlist, o botón quitar en playlists.
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
        {onRemove ? (
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => onRemove(song)}
            aria-label="Quitar de la playlist"
            title="Quitar de la playlist"
          >
            ✕
          </button>
        ) : (
          <HeartButton liked={liked} onToggle={onToggleLike} />
        )}
        <button
          type="button"
          className="song-play"
          onClick={onPlay}
          aria-label={active && playing ? "Pausar" : "Reproducir"}
        >
          {active && playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        {!onRemove && playlists ? (
          <div className="song-menu-wrap">
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => setMenu((m) => !m)}
              aria-label="Añadir a playlist"
              title="Añadir a playlist"
            >
              ⋮
            </button>
            {menu ? (
              <div className="song-menu">
                <p className="song-menu-title">Añadir a playlist</p>
                {playlists.length === 0 ? (
                  <div className="song-menu-empty">
                    <p>No tienes playlists.</p>
                    <button type="button" className="link" onClick={onGoPlaylists}>
                      Crear una
                    </button>
                  </div>
                ) : (
                  playlists.map((p) => (
                    <button
                      key={String(p.id)}
                      type="button"
                      onClick={() => choose(p.id)}
                    >
                      <span>{p.name}</span>
                      {String(addedId) === String(p.id) ? <span className="check">✓</span> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  function SongList({ songs, currentId, playing, likeIds, onPlay, onToggleLike, onRemove, playlists, onAddToPlaylist, onGoPlaylists }) {
    if (!songs || !songs.length) {
      return (
        <p className="muted">
          Aún no tienes canciones favoritas. Reproduce una vista previa y pulsa el corazón.
        </p>
      );
    }
    return (
      <ol className="song-list">
        {songs.map((sg, i) => (
          <SongRow
            key={String(sg.trackId)}
            song={sg}
            active={String(currentId) === String(sg.trackId)}
            playing={playing}
            liked={(likeIds || []).some((id) => String(id) === String(sg.trackId))}
            onPlay={() => onPlay(i)}
            onToggleLike={() => onToggleLike(sg)}
            onRemove={onRemove ? () => onRemove(sg) : null}
            playlists={playlists}
            onAddToPlaylist={onAddToPlaylist}
            onGoPlaylists={onGoPlaylists}
          />
        ))}
      </ol>
    );
  }

  // Vista Descubrir: feed infinito de canciones del algoritmo.
  // Auto-scroll al tema actual solo si el usuario lo activa (por defecto off).
  // Slide individual del feed Descubrir (estilo TikTok/Shorts):
  // una canción a pantalla completa, se reproduce sola al entrar en pantalla.
  function DiscoverSlide({ song, index, active, paused, liked, onToggleLike, onOpenArtist, onTrackStart }) {
    const audioRef = useRef(null);
    const [playing, setPlaying] = useState(true);
    const [blocked, setBlocked] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
      const a = audioRef.current;
      if (!a) return undefined;
      if (active && playing && !paused) {
        const p = a.play();
        if (p && p.catch) {
          p.then(() => {
            setBlocked(false);
            if (onTrackStart)
              onTrackStart({
                artistId: song.artistId,
                trackId: song.trackId,
                track: song.track,
                artist: song.artist,
              });
          }).catch(() => setBlocked(true));
        }
      } else {
        a.pause();
      }
      return undefined;
    }, [active, playing, paused]);

    const toggle = () => {
      // Si el navegador bloqueó el autoplay, el primer toque lo reanuda.
      if (blocked) {
        setBlocked(false);
        const a = audioRef.current;
        if (a) {
          const p = a.play();
          if (p && p.catch) {
            p.then(() => {
              if (onTrackStart)
                onTrackStart({
                  artistId: song.artistId,
                  trackId: song.trackId,
                  track: song.track,
                  artist: song.artist,
                });
            }).catch(() => setBlocked(true));
          }
        }
        return;
      }
      setPlaying((p) => !p);
    };

    const seek = (e) => {
      e.stopPropagation();
      const a = audioRef.current;
      if (!a || !a.duration) return;
      const r = e.currentTarget.getBoundingClientRect();
      a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
    };

    const openArtist = (e) => {
      e.stopPropagation();
      if (!song.artistId) return;
      onOpenArtist(
        {
          id: song.artistId,
          name: song.artistName || song.artist,
          image: song.artistImage || song.artwork,
          country: song.artistCountry || "—",
          genre: song.artistGenre || "—",
        },
        e.currentTarget.getBoundingClientRect()
      );
    };

    const showHint = blocked || !playing;

    return (
      <article className="disc-slide" data-i={index} data-song={String(song.trackId)} onClick={toggle}>
        <div
          className="disc-bg"
          style={song.artwork ? { backgroundImage: `url("${song.artwork}")` } : undefined}
        />
        <div className="disc-shade" />
        {song.artwork ? (
          <img className={"disc-art" + (showHint ? " dim" : "")} src={song.artwork} alt="" />
        ) : (
          <div className="disc-art disc-art-empty" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
          </div>
        )}

        {showHint ? (
          <div className="disc-playhint" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        ) : null}

        <div className="disc-rail" onClick={(e) => e.stopPropagation()}>
          <HeartButton liked={liked} onToggle={() => onToggleLike(song)} />
          {song.artistId ? (
            <button
              type="button"
              className="disc-artist-btn"
              onClick={openArtist}
              title="Ver artista"
              aria-label="Ver artista"
            >
              {song.artistImage ? (
                <img src={song.artistImage} alt="" loading="lazy" />
              ) : (
                <span>{String(song.artist || "?").charAt(0).toUpperCase()}</span>
              )}
              <em>Artista</em>
            </button>
          ) : null}
        </div>

        <div className="disc-info" onClick={toggle}>
          <strong>{song.track}</strong>
          <span>{song.artist}</span>
        </div>

        <div className="disc-progress" onClick={seek} title="Ir a…">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>

        <audio
          ref={audioRef}
          src={song.previewUrl}
          preload="metadata"
          loop
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            setProgress(a.duration ? a.currentTime / a.duration : 0);
          }}
          onEnded={() => setPlaying(false)}
        />
      </article>
    );
  }

  // Vista Descubrir: feed vertical tipo TikTok/Shorts con snap-scroll.
  // Una canción por pantalla, autoplay al entrar, scroll para la siguiente
  // e infinito con el algoritmo del backend.
  function DiscoverView({
    songs,
    loading,
    error,
    hasMore,
    onLoadMore,
    onRetry,
    likeIds,
    onToggleLike,
    onOpenArtist,
    onTrackStart,
    paused,
  }) {
    const feedRef = useRef(null);
    const sentinelRef = useRef(null);
    const [activeIdx, setActiveIdx] = useState(0);

    // El feed cubre la pantalla: bloquea el scroll del documento.
    useEffect(() => {
      document.body.style.overflow = "hidden";
      // Mide el topbar real (en móvil su altura es variable) y fija el borde
      // superior del feed para que no se solape.
      const setTop = () => {
        const tb = document.querySelector(".topbar");
        const h = tb ? tb.getBoundingClientRect().bottom : 64;
        document.documentElement.style.setProperty("--feed-top", `${Math.max(h, 0)}px`);
      };
      setTop();
      window.addEventListener("resize", setTop);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("resize", setTop);
        document.documentElement.style.removeProperty("--feed-top");
      };
    }, []);

    // Determina la diapositiva visible (la que debe sonar).
    useEffect(() => {
      const root = feedRef.current;
      if (!root || !songs.length) return undefined;
      const ob = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting && en.intersectionRatio >= 0.6) {
              const i = Number(en.target.getAttribute("data-i"));
              if (!Number.isNaN(i)) setActiveIdx(i);
            }
          });
        },
        { root, threshold: [0.6] }
      );
      root.querySelectorAll(".disc-slide").forEach((el) => ob.observe(el));
      return () => ob.disconnect();
    }, [songs.length]);

    // Scroll infinito dentro del propio feed.
    useEffect(() => {
      const el = sentinelRef.current;
      if (!el || !hasMore) return undefined;
      const ob = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) onLoadMore();
        },
        { root: feedRef.current, rootMargin: "800px" }
      );
      ob.observe(el);
      return () => ob.disconnect();
    }, [hasMore, onLoadMore, songs.length]);

    if (error && !songs.length) {
      return (
        <div className="disc-feed disc-state">
          <div className="error">
            {error}{" "}
            <button type="button" className="link" onClick={onRetry}>
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    if (loading && !songs.length) {
      return (
        <div className="disc-feed disc-state">
          <Loader />
        </div>
      );
    }
    if (!songs.length) {
      return (
        <div className="disc-feed disc-state">
          <p className="muted">No hay canciones ahora mismo. Prueba más tarde.</p>
        </div>
      );
    }

    return (
      <div className="disc-feed" ref={feedRef}>
        <div className="disc-hint">Descubrir · desliza para la siguiente</div>
        {songs.map((sg, i) => (
          <DiscoverSlide
            key={String(sg.trackId) + "-" + i}
            song={sg}
            index={i}
            active={i === activeIdx}
            paused={paused}
            liked={(likeIds || []).some((id) => String(id) === String(sg.trackId))}
            onToggleLike={onToggleLike}
            onOpenArtist={onOpenArtist}
            onTrackStart={onTrackStart}
          />
        ))}
        <div className="disc-tail">
          {hasMore ? (
            <div ref={sentinelRef} className="loader">
              <span className="spinner" /> Cargando más…
            </div>
          ) : (
            <p className="muted">Has llegado al final de Descubrir.</p>
          )}
        </div>
      </div>
    );
  }

  // Perfil de usuario abierto como card/modal (tipo escaparate de artista).
  function ProfileCard({
    loading,
    error,
    profile,
    onClose,
    onOpenArtist,
    onPlaySongs,
    currentId,
    playing,
    likeIds,
    onToggleLike,
    own,
    onGoSettings,
  }) {
    useEffect(() => {
      document.body.style.overflow = "hidden";
      const onKey = (e) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", onKey);
      };
    }, []);

    return (
      <div className="detail-backdrop profile-backdrop" onClick={onClose}>
        <div
          className="detail-panel profile-panel"
          style={{ position: "fixed", margin: 0 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Perfil"
        >
          <div className="detail-body profile-body">
            <div className="detail-top">
              <p className="detail-eyebrow">Perfil</p>
              <button className="btn ghost detail-close" type="button" onClick={onClose}>
                Cerrar ✕
              </button>
            </div>
            <FriendProfile
              profile={profile}
              loading={loading}
              error={error}
              onOpenArtist={onOpenArtist}
              onPlaySongs={onPlaySongs}
              currentId={currentId}
              playing={playing}
              likeIds={likeIds}
              onToggleLike={onToggleLike}
              own={own}
              onGoSettings={onGoSettings}
            />
          </div>
        </div>
      </div>
    );
  }

  // Formulario para crear una playlist.
  function PlaylistCreate({ onCreate }) {
    const [name, setName] = useState("");
    const submit = async (e) => {
      e.preventDefault();
      const pl = await onCreate(name);
      if (pl) setName("");
    };
    return (
      <form className="pl-create" onSubmit={submit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la playlist (p. ej., Rock español)"
          maxLength={60}
          required
        />
        <button className="btn" type="submit">Crear playlist</button>
      </form>
    );
  }

  const VolIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
  );
  const MuteIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" /></svg>
  );

  // Barra inferior: aparece del centro hacia los lados con imagen,
  // título, controles, volumen y Me gusta. Suena dentro de la app.
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
                    <strong>{it.track}</strong>
                    <span>{it.artist}</span>
                    <span className="rail-reason">{it.caption}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  // Perfil público de un amigo: favoritos y top escuchas.
  function FriendProfile({ profile, loading, error, onOpenArtist, onPlaySongs, currentId, playing, likeIds, onToggleLike, own, onGoSettings }) {
    if (loading) return <div className="loader"><span className="spinner" /> Cargando…</div>;
    if (error) return <div className="error">{error}</div>;
    if (!profile) return null;
    return (
      <section>
        <div className="profile-head">
          <span className="avatar lg">{String(profile.user.name || "?").charAt(0).toUpperCase()}</span>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>{profile.user.name}</h2>
            <p className="muted">{profile.artists.length} artistas · {profile.songs.length} canciones favoritas</p>
          </div>
          {own ? (
            <button type="button" className="icon-btn" onClick={onGoSettings} aria-label="Ajustes" title="Ajustes" style={{ marginLeft: "auto" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.08-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>
            </button>
          ) : null}
        </div>
        {profile.top && profile.top.length > 0 ? (
          <React.Fragment>
            <h3 className="section-title">Lo que más escucha</h3>
            <div className="rail-track static">
              {profile.top.map((a) => (
                <div className="rail-item" key={`top-${a.id}`}>
                  <ArtistCard artist={a} onSelect={onOpenArtist} />
                  <span className="rail-reason">{a.plays} escuchas</span>
                </div>
              ))}
            </div>
          </React.Fragment>
        ) : null}
        {profile.artists.length > 0 ? (
          <React.Fragment>
            <h3 className="section-title">Artistas que le gustan</h3>
            <ArtistGrid artists={profile.artists} onSelect={onOpenArtist} />
          </React.Fragment>
        ) : null}
        {profile.songs.length > 0 ? (
          <React.Fragment>
            <h3 className="section-title">Canciones que le gustan</h3>
            <SongList
              songs={profile.songs}
              currentId={currentId}
              playing={playing}
              likeIds={likeIds}
              onPlay={(i) => onPlaySongs(profile.songs, i)}
              onToggleLike={onToggleLike}
            />
          </React.Fragment>
        ) : null}
        {profile.artists.length === 0 && profile.songs.length === 0 ? (
          <p className="muted">Aún no tiene favoritos.</p>
        ) : null}
      </section>
    );
  }

  function Loader() {
    return (
      <div className="loader">
        <span className="spinner" /> Cargando…
      </div>
    );
  }

  // Hero de Inicio: carrusel de fotos con titular y acceso al catálogo.
  // La app ya entra directo (sin pantalla de bienvenida con botón).
  function Hero({ artists }) {
    const photos = (artists || []).filter((a) => a.image).slice(0, 8);
    const [idx, setIdx] = useState(0);

    useEffect(() => {
      if (photos.length < 2) return undefined;
      const t = setInterval(() => setIdx((i) => (i + 1) % photos.length), 3800);
      return () => clearInterval(t);
    }, [photos.length]);

    if (!photos.length) return null;
    const scrollToCatalog = () => {
      const el = document.querySelector(".todos-scroll");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    };
    return (
      <section className="hero" aria-label="Destacados">
        <div className="hero-slides">
          {photos.map((p, i) => (
            <div
              key={String(p.id) + i}
              className={"hero-slide" + (i === idx ? " active" : "")}
              style={{ backgroundImage: `url("${p.image}")` }}
            />
          ))}
        </div>
        <div className="hero-shade" />
        <div className="hero-content">
          <span className="hero-eyebrow">Catálogo de artistas</span>
          <h1>
            Descubre cantantes <em>uBeat</em>
          </h1>
          <p>País, género e imagen de cada artista, rankings y favoritos — sin esperas.</p>
          <div className="hero-actions">
            <button className="btn" type="button" onClick={scrollToCatalog}>
              Explorar catálogo
            </button>
          </div>
          {photos.length > 1 ? (
            <div className="dots">
              {photos.map((p, i) => (
                <span
                  key={String(p.id) + i}
                  className={i === idx ? "dot active" : "dot"}
                  onClick={() => setIdx(i)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // Vista de nueva contraseña (al volver desde el enlace del email).
  function ResetPasswordView({ email, loading, error, done, onSubmit, onBack, onGoLogin }) {
    const [pw1, setPw1] = useState("");
    const [pw2, setPw2] = useState("");
    const [mismatch, setMismatch] = useState("");
    const submit = (e) => {
      e.preventDefault();
      if (pw1 !== pw2) {
        setMismatch("Las contraseñas no coinciden.");
        return;
      }
      setMismatch("");
      onSubmit(pw1);
    };
    return (
      <section className="reset-wrap">
        <div className="reset-card">
          <p className="detail-eyebrow">Recuperar contraseña</p>
          <h2>Crear nueva contraseña</h2>
          {loading ? (
            <div className="loader"><span className="spinner" /> Verificando enlace…</div>
          ) : error ? (
            <React.Fragment>
              <div className="error">{error}</div>
              <button className="btn ghost" type="button" onClick={onBack}>Volver al inicio</button>
            </React.Fragment>
          ) : done ? (
            <React.Fragment>
              <div className="notice-ok">Contraseña actualizada. Ya puedes iniciar sesión.</div>
              <button className="btn" type="button" onClick={onGoLogin}>Iniciar sesión</button>
            </React.Fragment>
          ) : (
            <form onSubmit={submit}>
              <p className="muted">Cuenta: <b>{email}</b></p>
              <label>
                Nueva contraseña
                <input
                  type="password"
                  minLength={6}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  required
                />
              </label>
              <label>
                Repetir contraseña
                <input
                  type="password"
                  minLength={6}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  required
                />
              </label>
              {mismatch ? <div className="error">{mismatch}</div> : null}
              <button className="btn full" type="submit" disabled={loading}>
                {loading ? "…" : "Guardar contraseña"}
              </button>
            </form>
          )}
        </div>
      </section>
    );
  }

  // Banner de cookies con 3 booleanos: necesarias (siempre),
  // sesión (recordar login) y preferencias (p. ej., volumen).
  function CookieBanner({ onAcceptAll, onSave, onReject }) {
    const [draft, setDraft] = useState({ necessary: true, session: true, preferences: true });
    const flip = (k) => {
      if (k === "necessary") return;
      setDraft((d) => ({ ...d, [k]: !d[k] }));
    };
    const rows = [
      { k: "necessary", t: "Necesarias", d: "Imprescindibles para que la app funcione." },
      { k: "session", t: "Sesión", d: "Recordar tu sesión entre visitas." },
      { k: "preferences", t: "Preferencias", d: "Recordar ajustes como el volumen." },
    ];
    return (
      <div className="cookie-banner" role="dialog" aria-label="Cookies">
        <strong>Cookies y almacenamiento local</strong>
        <p>Elige qué aceptas. Con sesión iniciada registramos tus reproducciones para recomendarte música similar.</p>
        {rows.map((r) => (
          <div className="cookie-row" key={r.k}>
            <div>
              <strong>{r.t}</strong>
              <span>{r.d}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft[r.k]}
              aria-label={r.t}
              disabled={r.k === "necessary"}
              className={"switch" + (draft[r.k] ? " on" : "")}
              onClick={() => flip(r.k)}
            >
              <span className="knob" />
            </button>
          </div>
        ))}
        <div className="cookie-actions">
          <button className="btn ghost" type="button" onClick={onReject}>
            Rechazar
          </button>
          <button className="btn ghost" type="button" onClick={() => onSave(draft)}>
            Guardar
          </button>
          <button className="btn" type="button" onClick={onAcceptAll}>
            Aceptar todas
          </button>
        </div>
      </div>
    );
  }

  // Vista de Ajustes: apariencia, cuenta y cookies.
  const ACCENT_PRESETS = ["#7c6cf0", "#3fb950", "#d9a441", "#e5635c", "#2aa8a0", "#d66fb0"];
  const PAGE_PRESETS = ["#0e1116", "#141b26", "#1a1030", "#10231c", "#2b1a12", "#f4f5f7"];

  function SettingsView({
    theme,
    accent,
    onTheme,
    onAccent,
    onResetAccent,
    cookies,
    onOpenCookies,
    user,
    onLogin,
    onLogout,
    pageColor,
    onPageColor,
    onPageColorReset,
    plan,
    planModal,
    savingPlan,
    planError,
    onShowCheckout,
    onHideCheckout,
    onUpgrade,
    onCancel,
  }) {
    const isPro = plan === "pro";
    return (
      <section>
        <h2 className="section-title">Ajustes</h2>

        <div className="settings-card">
          <div className="plan-head">
            <div>
              <h3>Suscripción</h3>
              <p>Tu plan actual: <span className={"pill-pro" + (isPro ? "" : " free")}>{isPro ? "PRO" : "Gratuito"}</span></p>
            </div>
          </div>
          <div className="plan-compare">
            <div className={"plan-box" + (isPro ? "" : " active")}>
              <strong>Gratuito</strong>
              <span className="plan-price">0 €</span>
              <ul>
                <li>Catálogo, búsqueda y filtros</li>
                <li>Favoritos, playlists y valoraciones</li>
                <li>Gráficos y listas populares</li>
                <li className="no">Sin Social (amigos)</li>
                <li className="no">Sin algoritmo (Para ti / Descubrir)</li>
              </ul>
            </div>
            <div className={"plan-box pro" + (isPro ? " active" : "")}>
              <strong>PRO <span className="pill-pro">Recomendado</span></strong>
              <span className="plan-price">3,99 €<small>/mes</small></span>
              <ul>
                <li>Todo lo del plan gratuito</li>
                <li>Social: amigos y su actividad</li>
                <li>Algoritmo: Para ti y Descubrir</li>
                <li>Seguimiento de escuchas</li>
                <li>Nuevas funciones primero</li>
              </ul>
            </div>
          </div>
          {planError ? <div className="error sm">{planError}</div> : null}
          {isPro ? (
            <div className="row-actions">
              <button type="button" className="btn ghost" onClick={onCancel} disabled={savingPlan}>
                {savingPlan ? "Procesando…" : "Cancelar suscripción"}
              </button>
            </div>
          ) : user ? (
            <div className="row-actions">
              <button type="button" className="btn" onClick={onShowCheckout}>Hazte PRO — 3,99 €/mes</button>
            </div>
          ) : (
            <div className="row-actions">
              <button type="button" className="btn" onClick={onLogin}>Inicia sesión para hacerte PRO</button>
            </div>
          )}
        </div>

        <div className="settings-card">
          <h3>Color de la página</h3>
          <p>
            Cambia el fondo de toda la página. No afecta al color de acento. Al cambiar de tema
            (Claro/Oscuro) se restablece, porque el tema también cambia el fondo.
          </p>
          <div className="swatches">
            {PAGE_PRESETS.map((c) => (
              <button
                key={"p" + c}
                type="button"
                className={"swatch" + ((pageColor || "").toLowerCase() === c.toLowerCase() ? " active" : "")}
                style={{ background: c, borderColor: "var(--line)" }}
                aria-label={`Color de página ${c}`}
                title={c}
                onClick={() => onPageColor(c)}
              />
            ))}
          </div>
          <div className="custom-color">
            <input
              type="color"
              value={pageColor || "#0e1116"}
              onChange={(e) => onPageColor(e.target.value)}
              aria-label="Color de página personalizado"
            />
            <span>Personalizado ({pageColor || "por defecto"})</span>
            <button type="button" className="link" onClick={onPageColorReset}>
              Restablecer
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h3>Color de acento</h3>
          <p>Personaliza el color principal de la página.</p>
          <div className="swatches">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={"swatch" + (accent.toLowerCase() === c ? " active" : "")}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                title={c}
                onClick={() => onAccent(c)}
              />
            ))}
          </div>
          <div className="custom-color">
            <input
              type="color"
              value={accent}
              onChange={(e) => onAccent(e.target.value)}
              aria-label="Color personalizado"
            />
            <span>Personalizado ({accent})</span>
            <button type="button" className="link" onClick={onResetAccent}>
              Restablecer
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h3>Apariencia</h3>
          <p>Tema claro u oscuro.</p>
          <div className="theme-row">
            <button
              type="button"
              className={"btn ghost" + (theme === "light" ? " active" : "")}
              onClick={() => onTheme("light")}
            >
              Claro
            </button>
            <button
              type="button"
              className={"btn ghost" + (theme === "dark" ? " active" : "")}
              onClick={() => onTheme("dark")}
            >
              Oscuro
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h3>Cuenta</h3>
          {user ? (
            <div className="settings-user">
              <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <button type="button" className="btn ghost" onClick={onLogout}>
                Salir
              </button>
            </div>
          ) : (
            <React.Fragment>
              <p>Sin sesión iniciada.</p>
              <button type="button" className="btn" onClick={onLogin}>
                Iniciar sesión
              </button>
            </React.Fragment>
          )}
        </div>

        <div className="settings-card">
          <h3>Cookies</h3>
          <p>
            {cookies
              ? `Sesión: ${cookies.session ? "sí" : "no"} · Preferencias: ${cookies.preferences ? "sí" : "no"}`
              : "Aún no has elegido."}
          </p>
          <button type="button" className="btn ghost" onClick={onOpenCookies}>
            Configurar cookies
          </button>
        </div>

        {planModal ? (
          <div className="modal-scrim" onClick={onHideCheckout}>
            <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Hacerse PRO">
              <div className="modal-head">
                <strong>Hazte PRO</strong>
                <button type="button" onClick={onHideCheckout} aria-label="Cerrar">✕</button>
              </div>
              <p className="muted">Demo de pago simulado: no se cobra nada de verdad.</p>
              <div className="checkout-summary">
                <span>Plan PRO · suscripción mensual</span>
                <strong>3,99 €/mes</strong>
              </div>
              <label className="field">
                <span>Número de tarjeta</span>
                <input type="text" inputMode="numeric" placeholder="4242 4242 4242 4242" disabled={savingPlan} />
              </label>
              <div className="row-actions">
                <button type="button" className="btn ghost" onClick={onHideCheckout} disabled={savingPlan}>
                  Volver
                </button>
                <button type="button" className="btn" onClick={onUpgrade} disabled={savingPlan}>
                  {savingPlan ? "Procesando…" : "Pagar 3,99 €"}
                </button>
              </div>
              {planError ? <div className="error sm">{planError}</div> : null}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  // Paywall de Descubrir (y cualquier vista PRO) para plan gratuito/invitado.
  function PlanGate({ user, onLogin, onSettings }) {
    return (
      <section className="plan-gate">
        <span className="pill-pro big">PLAN PRO</span>
        <h2>Desbloquea Descubrir y Social</h2>
        <p className="muted">
          Con el plan gratuito tienes el catálogo completo, favoritos, playlists y gráficos.
          El feed <strong>Descubrir</strong>, la recomendación <strong>Para ti</strong> y el
          <strong> Social</strong> (amigos) son funciones del plan PRO.
        </p>
        <ul className="gate-list">
          <li>Feed vertical de canciones (estilo Shorts)</li>
          <li>Recomendaciones “Para ti” con motivos</li>
          <li>Amigos, solicitudes y su actividad</li>
          <li>Seguimiento de escuchas</li>
        </ul>
        <div className="row-actions center">
          {user ? (
            <button type="button" className="btn big" onClick={onSettings}>Hazte PRO — 3,99 €/mes</button>
          ) : (
            <React.Fragment>
              <button type="button" className="btn big" onClick={onLogin}>Iniciar sesión</button>
              <button type="button" className="btn ghost" onClick={onSettings}>Ver planes</button>
            </React.Fragment>
          )}
        </div>
      </section>
    );
  }

  // Vista de Soporte: asistente de datos + envío de tiquets.
  const SUPPORT_CHIPS = [
    "¿Cuál es el artista mejor valorado de la app?",
    "¿Cuáles son los artistas más gustados?",
    "¿Cuántos artistas hay?",
    "¿Quién lidera el ranking de España?",
    "¿Qué canciones me gustan?",
    "¿Qué planes hay?",
  ];

  function SupportView({
    user,
    aiMessages,
    aiLoading,
    aiError,
    tickets,
    loadingTickets,
    ticketsError,
    sendingTicket,
    ticketSent,
    ticketError,
    onAsk,
    onSendTicket,
    onLogin,
  }) {
    const [question, setQuestion] = useState("");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [email, setEmail] = useState("");
    const chatRef = useRef(null);

    useEffect(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [aiMessages, aiLoading]);

    const ask = (e) => {
      e.preventDefault();
      const q = question.trim();
      if (!q || aiLoading) return;
      setQuestion("");
      onAsk(q);
    };
    const last = aiMessages[aiMessages.length - 1];
    const chips = last && last.role === "bot" && last.suggestions && last.suggestions.length
      ? last.suggestions
      : SUPPORT_CHIPS;

    const submitTicket = async (e) => {
      e.preventDefault();
      const ok = await onSendTicket({
        subject: subject.trim(),
        message: message.trim(),
        email: email.trim(),
      });
      if (ok) {
        setSubject("");
        setMessage("");
      }
    };

    return (
      <section className="support-view">
        <h2 className="section-title">Soporte</h2>

        <div className="settings-card">
          <h3>Asistente de soporte</h3>
          <p>Pregunta sobre los datos de la app: valoraciones, likes, artistas, planes o tu cuenta.</p>
          <div className="ai-chat" ref={chatRef}>
            {aiMessages.length === 0 ? (
              <div className="ai-msg bot">
                ¡Hola! Pregúntame, por ejemplo, «¿Cuál es el artista mejor valorado de la app?».
              </div>
            ) : (
              aiMessages.map((m, i) => (
                <div key={i} className={"ai-msg " + m.role}>
                  {m.text}
                </div>
              ))
            )}
            {aiLoading ? <div className="ai-msg bot">Pensando…</div> : null}
          </div>
          {aiError ? <div className="error sm">{aiError}</div> : null}
          <div className="ai-suggestions">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                className="ai-chip"
                onClick={() => onAsk(c)}
                disabled={aiLoading}
              >
                {c}
              </button>
            ))}
          </div>
          <form className="ai-form" onSubmit={ask}>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Escribe tu pregunta…"
              maxLength={400}
              aria-label="Pregunta para el asistente"
            />
            <button className="btn" type="submit" disabled={aiLoading || !question.trim()}>
              {aiLoading ? "…" : "Preguntar"}
            </button>
          </form>
        </div>

        <div className="settings-card">
          <h3>Enviar un tiquet</h3>
          <p>
            Describe tu problema o sugerencia. El equipo de soporte lo verá reflejado en el panel de
            administración y te responderá.
          </p>
          <form className="ticket-form" onSubmit={submitTicket}>
            <input
              type="text"
              placeholder="Asunto"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={3}
              maxLength={150}
            />
            {!user ? (
              <input
                type="email"
                placeholder="Tu email (para recibir la respuesta)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            ) : null}
            <textarea
              placeholder="Cuéntanos los detalles…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={10}
              maxLength={5000}
              rows={5}
            />
            <button className="btn" type="submit" disabled={sendingTicket}>
              {sendingTicket ? "Enviando…" : "Enviar tiquet"}
            </button>
          </form>
          {ticketError ? <div className="error sm">{ticketError}</div> : null}
          {ticketSent ? (
            <div className="notice-ok">Tiquet enviado. Aparecerá como abierto en el panel de soporte.</div>
          ) : null}
        </div>

        <div className="settings-card">
          <h3>Mis tiquets</h3>
          {!user ? (
            <p className="muted">
              Inicia sesión para ver los tiquets que hayas enviado.{" "}
              <button type="button" className="link" onClick={onLogin}>
                Log in
              </button>
            </p>
          ) : loadingTickets ? (
            <Loader />
          ) : ticketsError ? (
            <div className="error sm">{ticketsError}</div>
          ) : tickets.length === 0 ? (
            <p className="muted">Todavía no has enviado tiquets.</p>
          ) : (
            tickets.map((t) => (
              <div className="ticket-row" key={String(t.id)}>
                <div className="tr-head">
                  <strong>{t.subject}</strong>
                  <span className={"ticket-status " + (t.status === "resolved" ? "resolved" : "open")}>
                    {t.status === "resolved" ? "Resuelto" : "Abierto"}
                  </span>
                </div>
                <div className="muted sm">{String(t.createdAt || "").slice(0, 10)}</div>
                <p>{t.message}</p>
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  // Botón flotante con chat rápido del asistente de soporte. Comparte la
  // conversación con la vista Soporte (estado en el controlador).
  function SupportFab({ messages, loading, error, onAsk, raised }) {
    const [open, setOpen] = useState(false);
    const [question, setQuestion] = useState("");
    const logRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [messages, loading, open]);

    useEffect(() => {
      if (!open) return undefined;
      if (inputRef.current) inputRef.current.focus();
      const onKey = (e) => {
        if (e.key === "Escape") setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const ask = (e) => {
      e.preventDefault();
      const q = question.trim();
      if (!q || loading) return;
      setQuestion("");
      onAsk(q);
    };
    const last = messages[messages.length - 1];
    const chips = last && last.role === "bot" && last.suggestions && last.suggestions.length
      ? last.suggestions
      : SUPPORT_CHIPS;

    return (
      <div className={"chat-wrap" + (raised ? " raised" : "")}>
        {open ? (
          <div className="chat-panel" role="dialog" aria-label="Asistente de soporte">
            <div className="chat-head">
              <span className="chat-dot" aria-hidden="true" />
              <strong>Asistente IA</strong>
              <button type="button" className="icon-btn" aria-label="Cerrar chat" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="chat-log" ref={logRef}>
              {messages.length === 0 ? (
                <div className="ai-msg bot">
                  ¡Hola! Pregúntame, por ejemplo, «¿Cuál es el artista mejor valorado de la app?».
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={"ai-msg " + m.role}>
                    {m.text}
                  </div>
                ))
              )}
              {loading ? <div className="ai-msg bot">Pensando…</div> : null}
            </div>
            {error ? <div className="error sm">{error}</div> : null}
            <div className="ai-suggestions">
              {chips.map((c) => (
                <button key={c} type="button" className="ai-chip" onClick={() => onAsk(c)} disabled={loading}>
                  {c}
                </button>
              ))}
            </div>
            <form className="ai-form" onSubmit={ask}>
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pregunta rápida…"
                maxLength={400}
                aria-label="Pregunta para el asistente"
              />
              <button className="btn" type="submit" disabled={loading || !question.trim()}>
                {loading ? "…" : "Enviar"}
              </button>
            </form>
          </div>
        ) : null}
        <button
          type="button"
          className="fab-chat"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar chat de soporte" : "Abrir chat de soporte"}
          aria-expanded={open}
          title="Pregunta rápida al asistente"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      </div>
    );
  }

  function Footer({ onCookies }) {
    return (
      <footer className="footer">
        <div className="footer-inner">
          <div>
            <strong>uBeat</strong>
            <p>Catálogo de artistas: país, género e imagen.</p>
          </div>
          <div>
            <strong>Contacto</strong>
            <p>
              {/* ✏️ Edita aquí tus datos de contacto */}
              <a className="link" href="mailto:tu-correo@ejemplo.com">tu-correo@ejemplo.com</a>
              <br />
              <a className="link" href="https://github.com/tu-usuario" target="_blank" rel="noreferrer">github.com/tu-usuario</a>
              <br />
              <a className="link" href="https://tusitio.com" target="_blank" rel="noreferrer">tusitio.com</a>
            </p>
          </div>
          <div>
            <strong>Fuentes</strong>
            <p>Firestore · TheAudioDB</p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>uBeat · React + MVC · 2026</span>
          <button type="button" className="link" onClick={onCookies}>
            Cookies
          </button>
        </div>
      </footer>
    );
  }

  return { SearchBar, SourcePill, ArtistCard, ArtistGrid, ArtistChart, ArtistDetail, Loader, Hero, SkeletonCard, SkeletonGrid, SkeletonChart, FilterDropdown, Footer, Rail, SideMenu, AuthModal, HeartButton, SongRow, SongList, BottomBar, PlaylistCreate, ResetPasswordView, CookieBanner, SettingsView, SocialRail, FriendProfile, ProfileCard, DiscoverView, PlanGate, SupportView, SupportFab };
})();
