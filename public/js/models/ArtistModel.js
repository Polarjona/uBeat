/**
 * MVC — MODELO (frontend)
 * -----------------------
 * Única capa que habla con el backend (/api/*).
 * La Vista nunca hace fetch directamente: pasa por aquí.
 * El backend a su vez busca en Firestore y, si falta,
 * importa desde TheAudioDB y lo guarda automáticamente.
 */
(function (global) {
  const FALLBACK_IMG =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#161b22"/><g transform="translate(158,93) scale(3.5)" fill="#8b949e"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></g></svg>`
    );

  async function handle(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Error HTTP ${res.status}`);
    }
    return data;
  }

  function clean(list) {
    return (list || []).map((a) => ({
      id: String(a.id ?? a.name ?? Math.random()),
      name: a.name || "Desconocido",
      genre: a.genre || "Desconocido",
      country: a.country || "Desconocido",
      image: a.image || FALLBACK_IMG,
    }));
  }

  function authErrorEs(e) {
    const code = (e && e.code) || "";
    if (code === "auth/email-already-in-use") return "Ese email ya está registrado.";
    if (code === "auth/invalid-email") return "Email no válido.";
    if (code === "auth/weak-password") return "La contraseña debe tener 6+ caracteres.";
    if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential")
      return "Credenciales no válidas.";
    if (code === "auth/too-many-requests") return "Demasiados intentos. Espera unos minutos.";
    if (code === "auth/network-request-failed") return "Sin conexión. Revisa tu red.";
    return (e && e.message) || "Error de autenticación.";
  }

  function mapUser(u) {
    if (!u) return null;
    return {
      id: u.uid,
      name: u.displayName || String(u.email || "").split("@")[0],
      email: u.email || "",
    };
  }

  // reCAPTCHA v3 (invisible, solo pestaña de login).
  const RECAPTCHA_SITE_KEY = "6Ld3R74tAAAAAIjxWxZcYB93w2dVvSPzUoZ0H4H-";
  let recaptchaLoading = null;

  function loadRecaptcha() {
    if (window.grecaptcha) return Promise.resolve();
    if (recaptchaLoading) return recaptchaLoading;
    recaptchaLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar el captcha."));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("No se pudo cargar el captcha.")), 10000);
    });
    return recaptchaLoading;
  }

  async function captchaToken() {
    await loadRecaptcha();
    if (!window.grecaptcha || typeof window.grecaptcha.execute !== "function") {
      throw new Error("La clave de reCAPTCHA no es válida para v3.");
    }
    return await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: "login" });
  }

  const ArtistModel = {
    fallbackImg: FALLBACK_IMG,

    // Verifica el token v3 en nuestro backend antes del login.
    async verifyCaptcha(token) {
      const res = await fetch("/api/auth/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      await handle(res);
    },

    // ---- Sesión (Firebase Authentication) ----
    async idToken() {
      const u = window.fbAuth && window.fbAuth.currentUser;
      return u ? await u.getIdToken() : "";
    },
    async authHeaders() {
      const t = await this.idToken();
      return t ? { Authorization: `Bearer ${t}` } : {};
    },

    async register(name, email, password) {
      try {
        const cred = await window.fbAuth.createUserWithEmailAndPassword(email, password);
        if (name) await cred.user.updateProfile({ displayName: name });
        return mapUser(cred.user);
      } catch (e) {
        throw new Error(authErrorEs(e));
      }
    },

    async login(email, password) {
      try {
        const cred = await window.fbAuth.signInWithEmailAndPassword(email, password);
        return mapUser(cred.user);
      } catch (e) {
        throw new Error(authErrorEs(e));
      }
    },

    // Puerta v3: solo la pestaña de login la usa.
    async captchaCheck() {
      const token = await captchaToken();
      await this.verifyCaptcha(token);
    },

    async logout() {
      try {
        await window.fbAuth.signOut();
      } catch (_) {}
    },

    async me() {
      const u = window.fbAuth && window.fbAuth.currentUser;
      return mapUser(u);
    },

    // Recupera la sesión al arrancar (también tras recargar la página).
    onSession(restore) {
      if (!window.fbAuth) return;
      window.fbAuth.onAuthStateChanged(async (u) => {
        restore(mapUser(u));
        if (u) {
          try {
            const [ids, songIds] = await Promise.all([
              this.myLikeIds(),
              this.mySongLikeIds(),
            ]);
            restore(mapUser(u), ids, songIds);
          } catch (_) {}
        }
      });
    },

    // ---- Me gusta ----
    async toggleLike(artistId) {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({ artistId }),
      });
      const data = await handle(res);
      return data.liked;
    },

    async myLikeIds() {
      if (!(window.fbAuth && window.fbAuth.currentUser)) return [];
      try {
        const res = await fetch("/api/likes/ids", { headers: (await this.authHeaders()) });
        const data = await handle(res);
        return data.ids || [];
      } catch (_) {
        return [];
      }
    },

    async myFavorites() {
      const res = await fetch("/api/likes", { headers: (await this.authHeaders()) });
      const data = await handle(res);
      return clean(data.artists);
    },

    // ---- Me gusta en canciones ----
    async toggleSongLike(song) {
      const res = await fetch("/api/song-likes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({
          trackId: song.trackId,
          track: song.track,
          artist: song.artist,
          album: song.album,
          artwork: song.artwork,
          previewUrl: song.previewUrl,
          durationMs: song.durationMs,
        }),
      });
      const data = await handle(res);
      return data.liked;
    },

    async mySongLikeIds() {
      if (!(window.fbAuth && window.fbAuth.currentUser)) return [];
      try {
        const res = await fetch("/api/song-likes/ids", { headers: (await this.authHeaders()) });
        const data = await handle(res);
        return data.ids || [];
      } catch (_) {
        return [];
      }
    },

    async mySongFavorites() {
      const res = await fetch("/api/song-likes", { headers: (await this.authHeaders()) });
      const data = await handle(res);
      return data.songs || [];
    },

    // ---- Notas de artistas (0-10) ----
    async setRating(artistId, score) {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({ artistId, score }),
      });
      const data = await handle(res);
      return data.score;
    },

    async myRatings() {
      if (!(window.fbAuth && window.fbAuth.currentUser)) return {};
      try {
        const res = await fetch("/api/ratings/ids", { headers: (await this.authHeaders()) });
        const data = await handle(res);
        return data.ratings || {};
      } catch (_) {
        return {};
      }
    },

    // ---- Descubrir (feed infinito de canciones) ----
    async discover(offset) {
      const res = await fetch(`/api/discover?offset=${Number(offset) || 0}`, {
        headers: (await this.authHeaders()),
      });
      const data = await handle(res);
      return {
        songs: data.songs || [],
        hasMore: !!data.hasMore,
        offset: Number(data.offset) || 0,
      };
    },

  // El email con el enlace lo envía Firebase; el enlace vuelve a esta app.
    async forgot(email) {
      try {
        await window.fbAuth.sendPasswordResetEmail(email, {
          url: `${window.location.origin}/?mode=resetPassword`,
          handleCodeInApp: false,
        });
      } catch (e) {
        throw new Error(authErrorEs(e));
      }
    },

    // ---- Playlists ----
    async playlists() {
      const res = await fetch("/api/playlists", { headers: (await this.authHeaders()) });
      const data = await handle(res);
      return data.playlists || [];
    },

    async createPlaylist(name) {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({ name }),
      });
      const data = await handle(res);
      return data.playlist;
    },

    async deletePlaylist(id) {
      const res = await fetch(`/api/playlists/${id}`, {
        method: "DELETE",
        headers: (await this.authHeaders()),
      });
      await handle(res);
    },

    async playlistSongs(id) {
      const res = await fetch(`/api/playlists/${id}/songs`, {
        headers: (await this.authHeaders()),
      });
      const data = await handle(res);
      return data.songs || [];
    },

    async addSongToPlaylist(id, song) {
      const res = await fetch(`/api/playlists/${id}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({
          trackId: song.trackId,
          track: song.track,
          artist: song.artist,
          album: song.album,
          artwork: song.artwork,
          previewUrl: song.previewUrl,
          durationMs: song.durationMs,
        }),
      });
      const data = await handle(res);
      return data.added;
    },

    async removeSongFromPlaylist(id, trackId) {
      const res = await fetch(`/api/playlists/${id}/songs/${trackId}`, {
        method: "DELETE",
        headers: (await this.authHeaders()),
      });
      await handle(res);
    },

    // ---- Tracking y Para ti (solo con sesión) ----
    async logPlay(info) {
      const res = await fetch("/api/plays", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify(info || {}),
      });
      await handle(res);
    },

    async forYou() {
      const res = await fetch("/api/for-you", { headers: (await this.authHeaders()) });
      const data = await handle(res);
      return data.artists || [];
    },

    // ---- Social ----
    async friends() {
      const res = await fetch("/api/friends", { headers: (await this.authHeaders()) });
      const data = await handle(res);
      return { friends: data.friends || [], pendingIn: data.pendingIn || [], pendingOut: data.pendingOut || [] };
    },

    async sendFriendRequest(email) {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({ email }),
      });
      await handle(res);
    },

    async respondFriend(from, accept) {
      const res = await fetch("/api/friends/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await this.authHeaders()) },
        body: JSON.stringify({ from, accept }),
      });
      await handle(res);
    },

    async removeFriend(uid) {
      const res = await fetch(`/api/friends/${uid}`, {
        method: "DELETE",
        headers: (await this.authHeaders()),
      });
      await handle(res);
    },

    async friendProfile(uid) {
      const res = await fetch(`/api/friends/${uid}/profile`, {
        headers: (await this.authHeaders()),
      });
      const data = await handle(res);
      return data;
    },

    async friendsActivity() {
      const res = await fetch("/api/friends/activity", {
        headers: (await this.authHeaders()),
      });
      const data = await handle(res);
      return data.items || [];
    },

    // ---- Rankings ----
    async charts(storefront) {
      const res = await fetch(`/api/charts?storefront=${storefront}`);
      const data = await handle(res);
      return clean(data.artists);
    },

    // ---- Catálogo (paginado para el scroll infinito) ----
    async all({ country = "", genre = "", limit = 0, offset = 0 } = {}) {
      const p = new URLSearchParams();
      if (country) p.set("country", country);
      if (genre) p.set("genre", genre);
      if (limit > 0) p.set("limit", String(limit));
      if (offset > 0) p.set("offset", String(offset));
      const q = p.toString();
      const res = await fetch("/api/artists" + (q ? `?${q}` : ""));
      const data = await handle(res);
      return {
        artists: clean(data.artists),
        total: data.total ?? data.artists.length,
        filters: data.filters || { country, genre },
        source: data.source || "",
      };
    },

    async search(name, { country = "", genre = "" } = {}) {
      const q = (name || "").trim();
      if (!q) throw new Error("Escribe el nombre de un artista.");
      const p = new URLSearchParams({ search: q });
      if (country) p.set("country", country);
      if (genre) p.set("genre", genre);
      const res = await fetch(`/api/artists?${p.toString()}`);
      const data = await handle(res);
      return {
        artists: clean(data.artists),
        source: data.source || "",
        query: data.query || q,
      };
    },

    // Vistas previas de audio (top canciones, iTunes, 30 s).
    async preview(name) {
      const res = await fetch(`/api/artists/preview?artist=${encodeURIComponent(name)}`);
      const data = await handle(res);
      return data.tracks || [];
    },

    // Países y géneros únicos para el desplegable de filtros.
    async filters() {
      const res = await fetch("/api/artists/filters");
      const data = await handle(res);
      return {
        countries: data.countries || [],
        genres: data.genres || [],
      };
    },

    async health() {
      try {
        const res = await fetch("/api/health");
        return await res.json();
      } catch (_) {
        return { ok: false, firestore: false };
      }
    },
  };

  global.ArtistModel = ArtistModel;
})(window);
