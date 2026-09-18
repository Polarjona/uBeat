/**
 * MVC — CONTROLADOR (frontend)
 * ----------------------------
 * Orquesta el flujo: recibe acciones de la Vista, usa el Modelo
 * y actualiza el estado que la Vista pinta.
 */
(function (global) {
  const PAGE_SIZE = 24;

  function createArtistController({ model, setState, getState }) {
    // ---- Catálogo paginado (scroll infinito) ----
    async function fetchPage({ append = false, over = {} } = {}) {
      const st = { ...getState(), ...over };
      // Nota: sin bloqueo por `loading` aquí (loadMore ya lo comprueba);
      // bloquearlo dejaba el catálogo cargando para siempre al arrancar.
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const offset = append ? st.artists.length : 0;
        const { artists, total, source } = await model.all({
          country: st.country,
          genre: st.genre,
          limit: PAGE_SIZE,
          offset,
        });
        setState((s) => {
          const list = append ? [...s.artists, ...artists] : artists;
          return {
            ...s,
            artists: list,
            total,
            source,
            loading: false,
            hasMore: list.length < total,
          };
        });
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: err.message }));
      }
    }

    async function loadAll() {
      return fetchPage({});
    }

    async function loadMore() {
      const st = getState();
      if (st.loading || !st.hasMore) return;
      if (st.view !== "home" || (st.query || "").trim()) return;
      return fetchPage({ append: true });
    }

    async function loadFilters() {
      try {
        const f = await model.filters();
        setState((s) => ({ ...s, ...f }));
      } catch (_) {
        // sin filtros disponibles: el desplegable queda vacío
      }
    }

    // Fija un filtro (país o género) y recarga con AND.
    async function setFilter(key, value) {
      setState((s) => ({ ...s, [key]: value }));
      return fetchPage({ over: { [key]: value } });
    }

    async function clearFilters() {
      setState((s) => ({ ...s, query: "", country: "", genre: "" }));
      return fetchPage({ over: { country: "", genre: "" } });
    }

    async function search() {
      const { query, country, genre } = getState();
      if (!(query || "").trim()) {
        return loadAll();
      }
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const { artists, source } = await model.search(query, { country, genre });
        setState((s) => ({
          ...s,
          artists,
          total: artists.length,
          hasMore: false,
          source,
          loading: false,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          artists: [],
          total: 0,
          hasMore: false,
          loading: false,
          error: err.message,
        }));
      }
    }

    // ---- Rankings ----
    async function loadCharts() {
      setState((s) => ({ ...s, loadingCharts: true, chartsError: "" }));
      try {
        const [global, spain] = await Promise.all([
          model.charts("US"),
          model.charts("ES"),
        ]);
        setState((s) => ({
          ...s,
          chartsGlobal: global,
          chartsSpain: spain,
          loadingCharts: false,
        }));
      } catch (err) {
        setState((s) => ({ ...s, loadingCharts: false, chartsError: err.message }));
      }
    }

    // ---- Navegación ----
    function go(view) {
      setState((s) => ({ ...s, view, drawer: false }));
      if (view === "favorites") loadFavorites();
      if (view === "favSongs") {
        loadSongFavorites();
        loadPlaylists();
      }
      if (view === "playlists") loadPlaylists();
    }

    // ---- Usuarios ----
    async function restoreSession() {
      // Firebase avisa solo de los cambios (incluido el arranque).
      model.onSession(async (user, likeIds, songLikeIds) => {
        if (!user) {
          setState((s) => ({ ...s, user: null, likeIds: [], songLikeIds: [], forYou: [] }));
          return;
        }
        setState((s) => ({ ...s, user }));
        if (likeIds && songLikeIds) {
          setState((s) => ({ ...s, likeIds, songLikeIds }));
        }
        loadForYou();
      });
    }

    async function login(email, password) {
      setState((s) => ({ ...s, authLoading: true, authError: "" }));
      try {
        await model.captchaCheck();
        const user = await model.login(email, password);
        const [ids, songIds] = await Promise.all([
          model.myLikeIds(),
          model.mySongLikeIds(),
        ]);
        setState((s) => ({
          ...s,
          user,
          likeIds: ids,
          songLikeIds: songIds,
          authLoading: false,
          authModal: false,
          authMode: "login",
        }));
        loadForYou();
      } catch (err) {
        setState((s) => ({ ...s, authLoading: false, authError: err.message }));
      }
    }

    async function register(name, email, password) {
      setState((s) => ({ ...s, authLoading: true, authError: "" }));
      try {
        const user = await model.register(name, email, password);
        const [ids, songIds] = await Promise.all([
          model.myLikeIds(),
          model.mySongLikeIds(),
        ]);
        setState((s) => ({
          ...s,
          user,
          likeIds: ids,
          songLikeIds: songIds,
          authLoading: false,
          authModal: false,
          authMode: "login",
        }));
        loadForYou();
      } catch (err) {
        setState((s) => ({ ...s, authLoading: false, authError: err.message }));
      }
    }

    async function logout() {
      await model.logout();
      setState((s) => ({
        ...s,
        user: null,
        likeIds: [],
        favorites: [],
        songLikeIds: [],
        songFavorites: [],
        playlists: [],
        openPlaylist: null,
        barQueue: [],
        barIdx: 0,
        barPlaying: false,
        forYou: [],
        view: "home",
      }));
    }

    // ---- Me gusta ----
    async function toggleLike(artistId) {
      const { user } = getState();
      if (!user) {
        setState((s) => ({
          ...s,
          authModal: true,
          authError: "Inicia sesión para dar Me gusta.",
        }));
        return false;
      }
      try {
        const liked = await model.toggleLike(artistId);
        setState((s) => ({
          ...s,
          likeIds: liked
            ? [...s.likeIds, artistId]
            : s.likeIds.filter((id) => String(id) !== String(artistId)),
        }));
        loadForYou();
        return liked;
      } catch (err) {
        setState((s) => ({ ...s, error: err.message }));
        return false;
      }
    }

    async function loadFavorites() {
      setState((s) => ({ ...s, loadingFav: true, favError: "" }));
      try {
        const favs = await model.myFavorites();
        setState((s) => ({ ...s, favorites: favs, loadingFav: false }));
      } catch (err) {
        setState((s) => ({ ...s, loadingFav: false, favError: err.message }));
      }
    }

    // ---- Me gusta en canciones ----
    async function toggleSongLike(song) {
      const { user } = getState();
      if (!user) {
        setState((s) => ({
          ...s,
          authModal: true,
          authError: "Inicia sesión para dar Me gusta.",
        }));
        return false;
      }
      try {
        const liked = await model.toggleSongLike(song);
        const tid = String(song.trackId);
        setState((s) => ({
          ...s,
          songLikeIds: liked
            ? [...s.songLikeIds, song.trackId]
            : s.songLikeIds.filter((id) => String(id) !== tid),
          songFavorites:
            s.view === "favSongs" && !liked
              ? s.songFavorites.filter((t) => String(t.trackId) !== tid)
              : s.songFavorites,
        }));
        loadForYou();
        return liked;
      } catch (err) {
        setState((s) => ({ ...s, error: err.message }));
        return false;
      }
    }

    async function loadSongFavorites() {
      setState((s) => ({ ...s, loadingSongs: true, songsError: "" }));
      try {
        const songs = await model.mySongFavorites();
        setState((s) => ({ ...s, songFavorites: songs, loadingSongs: false }));
      } catch (err) {
        setState((s) => ({ ...s, loadingSongs: false, songsError: err.message }));
      }
    }

    // ---- Recuperación de contraseña (enlace que vuelve a la app) ----
    async function forgot(email) {
      setState((s) => ({ ...s, authLoading: true, authError: "", authNotice: "" }));
      try {
        await model.forgot((email || "").trim());
        setState((s) => ({
          ...s,
          authLoading: false,
          authNotice: "Revisa tu email: el enlace te traerá de vuelta a esta aplicación.",
        }));
      } catch (err) {
        setState((s) => ({ ...s, authLoading: false, authError: err.message }));
      }
    }

    // Al abrir la app con ?mode=resetPassword&oobCode=... valida el código.
    async function initPasswordReset() {
      try {
        const q = new URLSearchParams(window.location.search);
        const code = q.get("oobCode") || "";
        if (q.get("mode") !== "resetPassword" || !code) return;
        window.history.replaceState({}, "", window.location.pathname);
        setState((s) => ({ ...s, entered: true, resetOob: code, resetLoading: true }));
        const email = await window.fbAuth.verifyPasswordResetCode(code);
        setState((s) => ({ ...s, resetEmail: email || "", resetLoading: false }));
      } catch (err) {
        setState((s) => ({
          ...s,
          resetLoading: false,
          resetError: "El enlace no es válido o ha caducado. Pide otro desde “He olvidado mi contraseña”.",
        }));
      }
    }

    async function confirmReset(newPass) {
      const { resetOob } = getState();
      setState((s) => ({ ...s, resetLoading: true, resetError: "" }));
      try {
        await window.fbAuth.confirmPasswordReset(resetOob, newPass);
        setState((s) => ({ ...s, resetLoading: false, resetDone: true }));
      } catch (err) {
        setState((s) => ({
          ...s,
          resetLoading: false,
          resetError: "No se pudo cambiar la contraseña. Pide un enlace nuevo.",
        }));
      }
    }

    function closeReset() {
      setState((s) => ({
        ...s,
        resetOob: null,
        resetEmail: "",
        resetDone: false,
        resetError: "",
      }));
    }

    // ---- Playlists ----
    async function loadPlaylists() {
      const { user } = getState();
      if (!user) return;
      setState((s) => ({ ...s, loadingPl: true }));
      try {
        const playlists = await model.playlists();
        setState((s) => ({ ...s, playlists, loadingPl: false }));
      } catch (err) {
        setState((s) => ({ ...s, loadingPl: false, error: err.message }));
      }
    }

    async function createPlaylist(name) {
      const n = (name || "").trim();
      if (!n) return null;
      const pl = await model.createPlaylist(n);
      setState((s) => ({ ...s, playlists: [pl, ...s.playlists] }));
      return pl;
    }

    async function deletePlaylist(id) {
      await model.deletePlaylist(id);
      setState((s) => ({
        ...s,
        playlists: s.playlists.filter((p) => String(p.id) !== String(id)),
        openPlaylist:
          s.openPlaylist && String(s.openPlaylist.id) === String(id) ? null : s.openPlaylist,
      }));
    }

    async function openPlaylist(id) {
      setState((s) => ({ ...s, loadingPlSongs: true }));
      try {
        const songs = await model.playlistSongs(id);
        const pl = getState().playlists.find((p) => String(p.id) === String(id));
        setState((s) => ({
          ...s,
          openPlaylist: { id, name: pl ? pl.name : "Playlist", songs },
          loadingPlSongs: false,
        }));
      } catch (err) {
        setState((s) => ({ ...s, loadingPlSongs: false, error: err.message }));
      }
    }

    function closePlaylist() {
      setState((s) => ({ ...s, openPlaylist: null }));
    }

    async function addSongToPlaylist(pid, song) {
      await model.addSongToPlaylist(pid, song);
      // refresca el contador de la playlist
      const playlists = await model.playlists();
      setState((s) => ({ ...s, playlists }));
    }

    async function removeSongFromPlaylist(pid, trackId) {
      await model.removeSongFromPlaylist(pid, trackId);
      const tid = String(trackId);
      setState((s) => ({
        ...s,
        openPlaylist: s.openPlaylist
          ? {
              ...s.openPlaylist,
              songs: s.openPlaylist.songs.filter((t) => String(t.trackId) !== tid),
            }
          : s.openPlaylist,
        playlists: s.playlists.map((p) =>
          String(p.id) === String(pid) ? { ...p, count: Math.max(0, (p.count || 1) - 1) } : p
        ),
        barQueue: s.barQueue.filter((t) => String(t.trackId) !== tid),
      }));
    }

    // ---- Barra inferior de reproducción ----
    function playSongs(list, idx) {
      if (!list || !list.length) return;
      setState((s) => ({
        ...s,
        barQueue: list,
        barIdx: idx || 0,
        barPlaying: true,
        barClosing: false,
      }));
    }

    function barToggle() {
      const { barQueue } = getState();
      if (!barQueue.length) return;
      setState((s) => ({ ...s, barPlaying: !s.barPlaying }));
    }

    function barStep(dir) {
      const { barQueue, barIdx } = getState();
      if (!barQueue.length) return;
      setState((s) => ({
        ...s,
        barIdx: (barIdx + dir + barQueue.length) % barQueue.length,
        barPlaying: true,
      }));
    }

    function barSelect(i) {
      setState((s) => ({ ...s, barIdx: i, barPlaying: true }));
    }

    function closeBar() {
      setState((s) => (s.barQueue.length ? { ...s, barClosing: true } : s));
      setTimeout(
        () =>
          setState((s) => ({
            ...s,
            barQueue: [],
            barIdx: 0,
            barPlaying: false,
            barClosing: false,
          })),
        380
      );
    }

    // ---- Cookies (3 booleanos: necesarias, sesión, preferencias) ----
    function readCookieChoice() {
      try {
        const raw = localStorage.getItem("aa_cookies");
        if (!raw) return null;
        if (raw === "accepted") return { necessary: true, session: true, preferences: true };
        const o = JSON.parse(raw);
        if (!o || typeof o !== "object") return null;
        return { necessary: true, session: !!o.session, preferences: !!o.preferences };
      } catch (_) {
        return null;
      }
    }

    function storeCookies(o) {
      try {
        localStorage.setItem("aa_cookies", JSON.stringify(o));
      } catch (_) {}
    }

    async function applySessionPref(on) {
      try {
        await window.fbAuth.setPersistence(
          on
            ? window.firebase.auth.Auth.Persistence.LOCAL
            : window.firebase.auth.Auth.Persistence.NONE
        );
        if (!on) await window.fbAuth.signOut();
      } catch (_) {}
    }

    async function acceptCookies() {
      const o = { necessary: true, session: true, preferences: true };
      storeCookies(o);
      await applySessionPref(true);
      setState((s) => ({ ...s, cookies: o }));
    }

    async function saveCookiePrefs(draft) {
      const o = {
        necessary: true,
        session: !!draft.session,
        preferences: !!draft.preferences,
      };
      storeCookies(o);
      await applySessionPref(o.session);
      setState((s) => ({
        ...s,
        cookies: o,
        user: o.session ? s.user : null,
        likeIds: o.session ? s.likeIds : [],
        songLikeIds: o.session ? s.songLikeIds : [],
      }));
    }

    async function rejectCookies() {
      // El rechazo NO se guarda: el banner volverá a salir en la próxima visita.
      await applySessionPref(false);
      setState((s) => ({ ...s, cookies: null, user: null, likeIds: [], songLikeIds: [] }));
    }

    // Reabre el banner (desde el pie de página) para cambiar la elección.
    function reopenCookies() {
      try {
        localStorage.removeItem("aa_cookies");
      } catch (_) {}
      setState((s) => ({ ...s, cookies: null }));
    }

    // ---- Para ti (ponderado) ----
    async function loadForYou() {
      const { user } = getState();
      if (!user) {
        setState((s) => ({ ...s, forYou: [] }));
        return;
      }
      setState((s) => ({ ...s, loadingForYou: true }));
      try {
        const list = await model.forYou();
        setState((s) => ({ ...s, forYou: list, loadingForYou: false }));
      } catch (_) {
        setState((s) => ({ ...s, loadingForYou: false, forYou: [] }));
      }
    }

    // Se llama al empezar cada tema (una vez por pista, no por pausa).
    async function trackStarted(info) {
      const { user } = getState();
      if (!user) return;
      try {
        await model.logPlay(info);
        const list = await model.forYou();
        setState((s) => ({ ...s, forYou: list }));
      } catch (_) {}
    }

    // ---- Transición de la portada ----
    function enter() {
      const { entered, leaving } = getState();
      if (entered || leaving) return;
      setState((s) => ({ ...s, leaving: true }));
      setTimeout(() => setState((s) => ({ ...s, entered: true })), 750);
    }

    // ---- Reproductor ----
    async function loadPreview(name) {
      setState((s) => ({
        ...s,
        loadingPreview: true,
        previewError: "",
        previewTracks: [],
        trackIdx: 0,
        playing: false,
      }));
      try {
        const tracks = await model.preview(name);
        setState((s) => ({
          ...s,
          previewTracks: tracks,
          loadingPreview: false,
          previewError: tracks.length ? "" : "Sin vistas previas disponibles.",
        }));
      } catch (err) {
        setState((s) => ({ ...s, loadingPreview: false, previewError: err.message }));
      }
    }

    function setTrack(i) {
      setState((s) => ({ ...s, trackIdx: i, playing: true }));
    }

    function togglePlay() {
      const { previewTracks } = getState();
      if (!previewTracks.length) return;
      setState((s) => ({ ...s, playing: !s.playing }));
    }

    function step(dir) {
      const { previewTracks, trackIdx } = getState();
      if (!previewTracks.length) return;
      const n = (trackIdx + dir + previewTracks.length) % previewTracks.length;
      setState((s) => ({ ...s, trackIdx: n, playing: true }));
    }

    return {
      loadAll,
      loadMore,
      loadFilters,
      loadCharts,
      setFilter,
      clearFilters,
      search,
      enter,
      go,
      restoreSession,
      login,
      register,
      logout,
      forgot,
      initPasswordReset,
      confirmReset,
      closeReset,
      readCookieChoice,
      acceptCookies,
      saveCookiePrefs,
      rejectCookies,
      reopenCookies,
      toggleLike,
      loadFavorites,
      toggleSongLike,
      loadSongFavorites,
      loadForYou,
      trackStarted,
      loadPlaylists,
      createPlaylist,
      deletePlaylist,
      openPlaylist,
      closePlaylist,
      addSongToPlaylist,
      removeSongFromPlaylist,
      playSongs,
      barToggle,
      barStep,
      barSelect,
      closeBar,
      loadPreview,
      setTrack,
      togglePlay,
      step,
    };
  }

  global.createArtistController = createArtistController;
})(window);
