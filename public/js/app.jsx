/**
 * Arranque — conecta MVC + React
 * Modelo: window.ArtistModel
 * Vista: window.ArtistaViews (React)
 * Controlador: window.createArtistController
 */
const { useState, useEffect, useRef } = React;
const { SearchBar, SourcePill, ArtistGrid, ArtistDetail, Loader, Landing, FilterDropdown, Footer, Rail, SideMenu, AuthModal, SongList, BottomBar, PlaylistCreate, ResetPasswordView, CookieBanner } = window.ArtistaViews;

function App() {
  const [state, setState] = useState({
    query: "",
    artists: [],
    total: 0,
    hasMore: false,
    countries: [],
    genres: [],
    country: "",
    genre: "",
    showFilters: false,
    showUser: false,
    view: "home",
    drawer: false,
    authModal: false,
    authMode: "login",
    authLoading: false,
    authError: "",
    authNotice: "",
    resetOob: null,
    resetEmail: "",
    resetLoading: false,
    resetError: "",
    resetDone: false,
    cookies: null,
    user: null,
    likeIds: [],
    favorites: [],
    loadingFav: false,
    favError: "",
    songLikeIds: [],
    songFavorites: [],
    loadingSongs: false,
    songsError: "",
    playlists: [],
    loadingPl: false,
    openPlaylist: null,
    loadingPlSongs: false,
    barQueue: [],
    barIdx: 0,
    barPlaying: false,
    barClosing: false,
    chartsGlobal: [],
    chartsSpain: [],
    loadingCharts: true,
    chartsError: "",
    entered: false,
    leaving: false,
    detail: null,
    detailClosing: false,
    previewTracks: [],
    trackIdx: 0,
    playing: false,
    loadingPreview: false,
    previewError: "",
    showTop: false,
    theme: "dark",
    source: "",
    loading: true,
    error: "",
    health: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const ctrlRef = useRef(null);
  if (!ctrlRef.current) {
    ctrlRef.current = window.createArtistController({
      model: window.ArtistModel,
      setState,
      getState: () => stateRef.current,
    });
  }

  useEffect(() => {
    window.ArtistModel.health().then((h) =>
      setState((s) => ({ ...s, health: h }))
    );
    ctrlRef.current.loadAll();
    ctrlRef.current.loadFilters();
    ctrlRef.current.loadCharts();
    ctrlRef.current.restoreSession();
    ctrlRef.current.initPasswordReset();
    setState((s) => ({ ...s, cookies: ctrlRef.current.readCookieChoice() }));
  }, []);

  // Scroll infinito: carga más tarjetas al acercarse al final.
  // El observador usa como raíz el panel de "Todos" (scroll interno).
  const sentinelRef = useRef(null);
  const todosRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) ctrlRef.current.loadMore();
      },
      { root: todosRef.current, rootMargin: "600px" }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [state.view, state.entered, state.country, state.genre, state.query]);

  const setQuery = (v) => setState((s) => ({ ...s, query: v }));

  // Botón volver-arriba: aparece tras una distancia considerable de scroll.
  useEffect(() => {
    const onScroll = () => {
      const v = window.scrollY > 600;
      setState((s) => (s.showTop === v ? s : { ...s, showTop: v }));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Tema claro / oscuro con persistencia.
  useEffect(() => {
    let t = "dark";
    try {
      t = localStorage.getItem("aa_theme") || "dark";
    } catch (_) {}
    if (t !== "light") t = "dark";
    document.documentElement.dataset.theme = t;
    setState((s) => ({ ...s, theme: t }));
  }, []);

  const toggleTheme = () =>
    setState((s) => {
      const t = s.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("aa_theme", t);
      } catch (_) {}
      document.documentElement.dataset.theme = t;
      return { ...s, theme: t };
    });
  const toggleFilters = () =>
    setState((s) => ({ ...s, showFilters: !s.showFilters, showUser: false }));

  const showRails =
    state.view === "home" &&
    !(state.query || "").trim() &&
    !state.country &&
    !state.genre;

  const openDetail = (artist, r) => {
    setState((s) => ({
      ...s,
      detail: {
        artist,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      },
      detailClosing: false,
    }));
    ctrlRef.current.loadPreview(artist.name);
  };

  const closeDetail = () => {
    setState((s) => (s.detail ? { ...s, detailClosing: true, playing: false } : s));
    setTimeout(
      () =>
        setState((s) => ({
          ...s,
          detail: null,
          detailClosing: false,
          previewTracks: [],
          playing: false,
        })),
      480
    );
  };

  useEffect(() => {
    if (!state.detail) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.detail]);

  return (
    <React.Fragment>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="icon-btn"
            type="button"
            aria-label="Abrir menú"
            onClick={() => setState((s) => ({ ...s, drawer: true }))}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z" /></svg>
          </button>
          <div className="logo">
            <span className="disc">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            </span>
            <span>
              Artistas App
              <small>{state.total > 0 ? `${state.total} artistas` : "Catálogo de artistas"}</small>
            </span>
          </div>
          <SearchBar
            value={state.query}
            onChange={setQuery}
            onSearch={() => ctrlRef.current.search()}
            loading={state.loading}
          />
          {state.user ? (
            <div className="filters-wrap">
              <button
                className="btn ghost filters-btn user-btn"
                type="button"
                onClick={() => setState((s) => ({ ...s, showUser: !s.showUser, showFilters: false }))}
              >
                <span className="avatar">{state.user.name.charAt(0).toUpperCase()}</span>
                <span className="uname">{state.user.name}</span>
              </button>
              {state.showUser ? (
                <div className="filters-panel">
                  <p className="user-info">
                    <strong>{state.user.name}</strong>
                    <br />
                    {state.user.email}
                  </p>
                  <button
                    className="btn ghost clear-btn"
                    type="button"
                    onClick={() => {
                      ctrlRef.current.logout();
                      setState((s) => ({ ...s, showUser: false }));
                    }}
                  >
                    Salir
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              className="btn ghost"
              type="button"
              onClick={() => setState((s) => ({ ...s, authModal: true, authError: "" }))}
            >
              Usuarios
            </button>
          )}
          <FilterDropdown
            countries={state.countries}
            genres={state.genres}
            country={state.country}
            genre={state.genre}
            open={state.showFilters}
            onToggle={toggleFilters}
            onChange={(k, v) => ctrlRef.current.setFilter(k, v)}
            onClear={() => ctrlRef.current.clearFilters()}
          />
          <button
            className="icon-btn"
            type="button"
            aria-label={state.theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            title={state.theme === "dark" ? "Modo claro" : "Modo oscuro"}
            onClick={toggleTheme}
          >
            {state.theme === "dark" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.5 5.5 0 0 1-7.54-7.54A8.99 8.99 0 0 0 12 3z" /></svg>
            )}
          </button>
        </div>
      </header>

      <main>
        {state.resetOob ? (
          <ResetPasswordView
            email={state.resetEmail}
            loading={state.resetLoading}
            error={state.resetError}
            done={state.resetDone}
            onSubmit={(pw) => ctrlRef.current.confirmReset(pw)}
            onBack={() => ctrlRef.current.closeReset()}
            onGoLogin={() => {
              ctrlRef.current.closeReset();
              setState((s) => ({ ...s, authModal: true, authMode: "login" }));
            }}
          />
        ) : state.view === "playlists" ? (
          <section>
            <h2 className="section-title">Playlists</h2>
            {!state.user ? (
              <div className="notice">
                <p>Inicia sesión para crear y ver tus playlists.</p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, authModal: true, authError: "" }))}
                >
                  Iniciar sesión
                </button>
              </div>
            ) : state.openPlaylist ? (
              <React.Fragment>
                <button
                  type="button"
                  className="link back"
                  onClick={() => ctrlRef.current.closePlaylist()}
                >
                  ← Volver a mis playlists
                </button>
                <h3 className="pl-title">
                  {state.openPlaylist.name} ({state.openPlaylist.songs.length})
                </h3>
                {state.loadingPlSongs ? (
                  <Loader />
                ) : (
                  <SongList
                    songs={state.openPlaylist.songs}
                    currentId={state.barQueue[state.barIdx] && state.barQueue[state.barIdx].trackId}
                    playing={state.barPlaying}
                    likeIds={state.songLikeIds}
                    onPlay={(i) => ctrlRef.current.playSongs(state.openPlaylist.songs, i)}
                    onToggleLike={(sg) => ctrlRef.current.toggleSongLike(sg)}
                    onRemove={(sg) =>
                      ctrlRef.current.removeSongFromPlaylist(state.openPlaylist.id, sg.trackId)
                    }
                  />
                )}
              </React.Fragment>
            ) : (
              <React.Fragment>
                <PlaylistCreate onCreate={(n) => ctrlRef.current.createPlaylist(n)} />
                {state.loadingPl ? (
                  <Loader />
                ) : state.playlists.length > 0 ? (
                  <div className="pl-grid">
                    {state.playlists.map((p) => (
                      <article
                        key={String(p.id)}
                        className="pl-card"
                        onClick={() => ctrlRef.current.openPlaylist(p.id)}
                        title="Abrir playlist"
                      >
                        {p.cover ? (
                          <img src={p.cover} alt="" loading="lazy" />
                        ) : (
                          <div className="pl-cover-empty" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
                          </div>
                        )}
                        <button
                          type="button"
                          className="icon-btn sm danger pl-del"
                          aria-label="Eliminar playlist"
                          title="Eliminar playlist"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`¿Eliminar "${p.name}"?`))
                              ctrlRef.current.deletePlaylist(p.id);
                          }}
                        >
                          ✕
                        </button>
                        <div className="pl-card-body">
                          <strong>{p.name}</strong>
                          <span>{p.count} canción(es)</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Aún no tienes playlists. Crea la primera arriba.</p>
                )}
              </React.Fragment>
            )}
          </section>
        ) : state.view === "favSongs" ? (
          <section>
            <h2 className="section-title">Mis canciones favoritas</h2>
            {!state.user ? (
              <div className="notice">
                <p>Inicia sesión para ver tus canciones favoritas.</p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, authModal: true, authError: "" }))}
                >
                  Iniciar sesión
                </button>
              </div>
            ) : state.loadingSongs ? (
              <Loader />
            ) : state.songsError ? (
              <div className="error">
                {state.songsError}{" "}
                <button type="button" className="link" onClick={() => ctrlRef.current.loadSongFavorites()}>
                  Reintentar
                </button>
              </div>
            ) : (
              <SongList
                songs={state.songFavorites}
                currentId={state.barQueue[state.barIdx] && state.barQueue[state.barIdx].trackId}
                playing={state.barPlaying}
                likeIds={state.songLikeIds}
                onPlay={(i) => ctrlRef.current.playSongs(state.songFavorites, i)}
                onToggleLike={(sg) => ctrlRef.current.toggleSongLike(sg)}
                playlists={state.playlists}
                onAddToPlaylist={(pid, sg) => ctrlRef.current.addSongToPlaylist(pid, sg)}
                onGoPlaylists={() => ctrlRef.current.go("playlists")}
              />
            )}
          </section>
        ) : state.view === "favorites" ? (
          <section>
            <h2 className="section-title">Mis artistas favoritos</h2>
            {!state.user ? (
              <div className="notice">
                <p>Inicia sesión para ver tus artistas favoritos.</p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, authModal: true, authError: "" }))}
                >
                  Iniciar sesión
                </button>
              </div>
            ) : state.loadingFav ? (
              <Loader />
            ) : state.favError ? (
              <div className="error">
                {state.favError}{" "}
                <button type="button" className="link" onClick={() => ctrlRef.current.loadFavorites()}>
                  Reintentar
                </button>
              </div>
            ) : state.favorites.length > 0 ? (
              <ArtistGrid artists={state.favorites} onSelect={openDetail} />
            ) : (
              <p className="muted">Aún no tienes favoritos. Abre la ficha de un artista y pulsa el corazón.</p>
            )}
          </section>
        ) : (
          <React.Fragment>
            {showRails ? (
              <React.Fragment>
                <Rail
                  title="Populares ahora"
                  subtitle="Tendencias globales · iTunes"
                  artists={state.chartsGlobal}
                  loading={state.loadingCharts}
                  onSelect={openDetail}
                />
                <Rail
                  title="Populares en España"
                  subtitle="Lo más oído por oyentes españoles · iTunes"
                  artists={state.chartsSpain}
                  loading={state.loadingCharts}
                  onSelect={openDetail}
                />
              </React.Fragment>
            ) : null}
            <div className="status">
              <SourcePill source={state.source} health={state.health} />
              <span>
                {state.total > 0
                  ? `${state.total} artista(s)${state.country || state.genre ? " con los filtros" : " en la base de datos"}`
                  : "Escribe un nombre y pulsa Buscar"}
              </span>
              {state.country ? (
                <span className="pill active-filter">
                  País: {state.country}
                  <button type="button" onClick={() => ctrlRef.current.setFilter("country", "")}>✕</button>
                </span>
              ) : null}
              {state.genre ? (
                <span className="pill active-filter">
                  Género: {state.genre}
                  <button type="button" onClick={() => ctrlRef.current.setFilter("genre", "")}>✕</button>
                </span>
              ) : null}
            </div>

            {showRails ? <h2 className="section-title">Todos los artistas</h2> : null}

            {state.error ? <div className="error">{state.error}</div> : null}
            <div className="todos-scroll" ref={todosRef}>
              {state.loading && state.artists.length === 0 ? (
                <Loader />
              ) : (
                <ArtistGrid artists={state.artists} onSelect={openDetail} />
              )}
              {state.loading && state.artists.length > 0 ? <Loader /> : null}
              <div ref={sentinelRef} className="sentinel" />
              {!state.hasMore && state.artists.length > 0 && !(state.query || "").trim() ? (
                <p className="muted center">Has llegado al final del catálogo.</p>
              ) : null}
            </div>
          </React.Fragment>
        )}
      </main>

      <Footer onCookies={() => ctrlRef.current.reopenCookies()} />

      {state.entered && !state.cookies ? (
        <CookieBanner
          onAcceptAll={() => ctrlRef.current.acceptCookies()}
          onSave={(d) => ctrlRef.current.saveCookiePrefs(d)}
          onReject={() => ctrlRef.current.rejectCookies()}
        />
      ) : null}

      {state.entered ? (
        <button
          className={"to-top" + (state.showTop ? " visible" : "")}
          type="button"
          aria-label="Volver arriba"
          title="Volver arriba"
          onClick={scrollTop}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8l-6 6 1.4 1.4L12 11l4.6 4.4L18 14z" /></svg>
        </button>
      ) : null}

      <SideMenu
        open={state.drawer}
        view={state.view}
        user={state.user}
        favCount={state.likeIds.length}
        songFavCount={state.songLikeIds.length}
        plCount={state.playlists.length}
        onGo={(v) => ctrlRef.current.go(v)}
        onClose={() => setState((s) => ({ ...s, drawer: false }))}
        onUsers={() => setState((s) => ({ ...s, drawer: false, authModal: true, authError: "" }))}
      />

      {state.authModal ? (
        <AuthModal
          mode={state.authMode}
          loading={state.authLoading}
          error={state.authError}
          notice={state.authNotice}
          onMode={(m) => setState((s) => ({ ...s, authMode: m, authError: "", authNotice: "" }))}
          onLogin={(e, p) => ctrlRef.current.login(e, p)}
          onRegister={(n, e, p) => ctrlRef.current.register(n, e, p)}
          onForgot={(e) => ctrlRef.current.forgot(e)}
          onClose={() => setState((s) => ({ ...s, authModal: false }))}
        />
      ) : null}

      {state.detail ? (
        <ArtistDetail
          artist={state.detail.artist}
          rect={state.detail.rect}
          closing={state.detailClosing}
          onClose={closeDetail}
          tracks={state.previewTracks}
          trackIdx={state.trackIdx}
          playing={state.playing}
          loadingPreview={state.loadingPreview}
          previewError={state.previewError}
          onToggle={() => ctrlRef.current.togglePlay()}
          onStep={(d) => ctrlRef.current.step(d)}
          onSelectTrack={(i) => ctrlRef.current.setTrack(i)}
          liked={state.likeIds.some((id) => String(id) === String(state.detail.artist.id))}
          onToggleLike={() => ctrlRef.current.toggleLike(state.detail.artist.id)}
          songLikeIds={state.songLikeIds}
          onToggleSong={(t) => ctrlRef.current.toggleSongLike(t)}
        />
      ) : null}

      {state.barQueue.length > 0 ? (
        <BottomBar
          queue={state.barQueue}
          idx={state.barIdx}
          playing={state.barPlaying}
          closing={state.barClosing}
          liked={state.songLikeIds.some(
            (id) => String(id) === String(state.barQueue[state.barIdx].trackId)
          )}
          onToggle={() => ctrlRef.current.barToggle()}
          onStep={(d) => ctrlRef.current.barStep(d)}
          onToggleLike={(t) => ctrlRef.current.toggleSongLike(t)}
          onClose={() => ctrlRef.current.closeBar()}
          prefsEnabled={!!(state.cookies && state.cookies.preferences)}
        />
      ) : null}

      {!state.entered ? (
        <Landing
          artists={state.artists}
          leaving={state.leaving}
          onEnter={() => ctrlRef.current.enter()}
        />
      ) : null}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
