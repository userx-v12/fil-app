import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// =========================================================================
// SUPABASE CLIENT
// =========================================================================

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const TMDB_IMG = "https://image.tmdb.org/t/p";

// =========================================================================
// CONSTANTES MÉTIER
// =========================================================================

const GENRES = {
  16:    "Animation",
  10751: "Familial",
  99:    "Documentaire",
  10402: "Musical",
  10770: "Téléfilm",
  27:    "Horreur",
  10749: "Romance",
};

const LANGUAGES = {
  en: "Anglais",
  fr: "Français",
  ja: "Japonais",
  zh: "Chinois",
  ko: "Coréen",
  es: "Espagnol",
  de: "Allemand",
  it: "Italien",
};

const DIFFICULTIES = {
  random: { label: "Aléatoire", sub: "Sans contrainte",   range: null },
  easy:   { label: "Facile",    sub: "2 à 3 étapes",      range: [2, 3] },
  medium: { label: "Moyen",     sub: "3 à 4 étapes",      range: [3, 4] },
  hard:   { label: "Dur",       sub: "5 étapes ou plus",  range: [5, 99] },
};

const DEFAULT_PREFS = {
  difficulty: "random",
  languages:  Object.keys(LANGUAGES),
  excludeGenres: [],
};

// =========================================================================
// API
// =========================================================================

async function getMovieCast(movieId, limit = 12) {
  const { data, error } = await supabase
    .from("credits")
    .select("ord, actors(id, name, profile_path)")
    .eq("movie_id", movieId)
    .order("ord", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data.map(r => ({ ...r.actors, ord: r.ord }));
}

async function getActorMovies(actorId, excludeMovieId = null, limit = 30) {
  let q = supabase
    .from("credits")
    .select("movies!inner(id, title, year, poster_path, popularity)")
    .eq("actor_id", actorId)
    .order("popularity", { foreignTable: "movies", ascending: false });
  const { data, error } = await q.limit(limit + 1);
  if (error) throw error;
  return data
    .map(r => r.movies)
    .filter(m => m && m.id !== excludeMovieId)
    .slice(0, limit);
}

async function searchMovies(query, limit = 20) {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from("movies")
    .select("id, title, year, poster_path, popularity")
    .ilike("title", `%${query.trim()}%`)
    .order("popularity", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function getCandidatePool(prefs, limit = 500) {
  let q = supabase
    .from("movies")
    .select("id, title, year, poster_path, popularity, original_language, genre_ids")
    .gte("popularity", 20)
    .order("popularity", { ascending: false })
    .limit(limit);

  if (prefs.languages && prefs.languages.length > 0
      && prefs.languages.length < Object.keys(LANGUAGES).length) {
    q = q.in("original_language", prefs.languages);
  }
  const { data, error } = await q;
  if (error) throw error;
  if (!data) return [];

  if (prefs.excludeGenres && prefs.excludeGenres.length > 0) {
    const excluded = new Set(prefs.excludeGenres.map(Number));
    return data.filter(m => {
      const genres = Array.isArray(m.genre_ids) ? m.genre_ids : [];
      return !genres.some(g => excluded.has(Number(g)));
    });
  }
  return data;
}

async function pickValidChallenge(prefs, onProgress = () => {}) {
  const pool = await getCandidatePool(prefs, 500);
  if (!pool || pool.length < 2) {
    throw new Error("Trop peu de films avec ces filtres. Élargis tes critères.");
  }

  const range = DIFFICULTIES[prefs.difficulty]?.range || null;
  const MAX_TRIES = range ? 6 : 1;
  let fallback = null;

  for (let i = 0; i < MAX_TRIES; i++) {
    onProgress(i + 1, MAX_TRIES);
    const a = pool[Math.floor(Math.random() * pool.length)];
    let b = pool[Math.floor(Math.random() * pool.length)];
    let safety = 10;
    while (b.id === a.id && safety-- > 0) {
      b = pool[Math.floor(Math.random() * pool.length)];
    }
    if (a.id === b.id) continue;

    const optimal = await findOptimalPath(a.id, b.id, 5);
    if (!optimal || optimal.length < 3) continue;

    const steps = Math.max(1, Math.floor((optimal.length - 1) / 2));

    if (!range) {
      return { start: a, end: b, optimal };
    }
    if (steps >= range[0] && steps <= range[1]) {
      return { start: a, end: b, optimal };
    }
    fallback = { start: a, end: b, optimal };
  }

  if (fallback) return fallback;
  throw new Error("Pas de paire connectée trouvée avec ces filtres. Essaie d'élargir.");
}

// =========================================================================
// BFS bidirectionnel (chemin optimal)
// =========================================================================

async function neighborsOfMovie(movieId) {
  const cast = await getMovieCast(movieId, 12);
  const lists = await Promise.all(
    cast.map(a =>
      getActorMovies(a.id, movieId, 20).then(ms =>
        ms.map(m => ({ actor: a, movie: m }))
      )
    )
  );
  return lists.flat();
}

async function findOptimalPath(startId, endId, maxDepth = 4) {
  if (startId === endId) return [{ type: "movie", id: startId }];

  const fromStart = new Map([[startId, { actor: null, parent: null }]]);
  const fromEnd   = new Map([[endId,   { actor: null, parent: null }]]);
  let frontierStart = [startId];
  let frontierEnd   = [endId];

  for (let depth = 0; depth < maxDepth; depth++) {
    const useStart = frontierStart.length <= frontierEnd.length;
    const frontier = useStart ? frontierStart : frontierEnd;
    const visited  = useStart ? fromStart : fromEnd;
    const other    = useStart ? fromEnd : fromStart;

    const nextFrontier = [];
    const expansions = await Promise.all(frontier.map(neighborsOfMovie));

    for (let i = 0; i < frontier.length; i++) {
      const fromMovie = frontier[i];
      for (const { actor, movie } of expansions[i]) {
        const mid = movie.id;
        if (visited.has(mid)) continue;
        visited.set(mid, { actor, parent: fromMovie });
        if (other.has(mid)) {
          return reconstruct(mid, fromStart, fromEnd);
        }
        nextFrontier.push(mid);
      }
    }
    if (useStart) frontierStart = nextFrontier;
    else          frontierEnd   = nextFrontier;
    if (!nextFrontier.length) return null;
  }
  return null;
}

function reconstruct(meetId, fromStart, fromEnd) {
  const left = [];
  let cur = meetId;
  while (cur != null) {
    const n = fromStart.get(cur);
    if (!n) break;
    left.unshift({ type: "movie", id: cur });
    if (n.actor) left.unshift({ type: "actor", data: n.actor });
    cur = n.parent;
  }
  const right = [];
  cur = meetId;
  const node = fromEnd.get(cur);
  if (node && node.parent != null) {
    let p = node.parent;
    let a = node.actor;
    while (p != null) {
      if (a) right.push({ type: "actor", data: a });
      right.push({ type: "movie", id: p });
      const next = fromEnd.get(p);
      if (!next) break;
      p = next.parent;
      a = next.actor;
    }
  }
  return [...left, ...right];
}

// =========================================================================
// PALETTE + GLASS
// =========================================================================

const C = {
  bg: "#fafafa",
  ink: "#0f1729",
  inkSoft: "rgba(15, 23, 41, 0.55)",
  inkMute: "rgba(15, 23, 41, 0.35)",
  hairline: "rgba(15, 23, 41, 0.08)",
  white: "#ffffff",
  green: "#16a34a",
  amber: "#a16207",
};

const glass = {
  background: "rgba(255, 255, 255, 0.65)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: `1px solid ${C.hairline}`,
  boxShadow: "0 1px 2px rgba(15,23,41,0.04), 0 8px 24px rgba(15,23,41,0.06)",
};

const glassDark = {
  background: C.ink,
  border: `1px solid ${C.ink}`,
  color: C.white,
  boxShadow: "0 4px 16px rgba(15,23,41,0.18)",
};

const GRADIENT_PALETTE = [
  ["#1e3a5f", "#0f1729"], ["#2d4a6f", "#1a2540"], ["#3d2b50", "#1a1029"],
  ["#4a3320", "#1f1610"], ["#1f3d3d", "#0d1f1f"], ["#4a2030", "#1f0d18"],
  ["#2a4030", "#101f18"], ["#3a3a60", "#1a1a30"],
];
const hashId = (id) => { let h = 0; const s = String(id); for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i); return Math.abs(h); };
const gradientFor = (id) => GRADIENT_PALETTE[hashId(id) % GRADIENT_PALETTE.length];

// =========================================================================
// IMAGES
// =========================================================================

function Poster({ movie, size = 60, rounded = 10 }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = movie.poster_path ? `${TMDB_IMG}/w342${movie.poster_path}` : null;
  const [g1, g2] = gradientFor(movie.id || movie.title);
  const words = (movie.title || "").split(" ").filter(w => w.length > 1);
  const initials = ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase();
  const showFallback = !url || errored;
  return (
    <div style={{
      width: size, height: size * 1.5, borderRadius: rounded,
      position: "relative", overflow: "hidden", flexShrink: 0,
      background: `linear-gradient(135deg, ${g1}, ${g2})`,
      boxShadow: "0 2px 8px rgba(15,23,41,0.12), 0 0 0 1px rgba(15,23,41,0.06) inset",
    }}>
      {showFallback && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.92)",
          fontFamily: "'Manrope', sans-serif", padding: "6%" }}>
          <div style={{ fontSize: size * 0.32, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>{initials}</div>
          {size >= 50 && movie.year && (
            <div style={{ fontSize: Math.max(8, size * 0.13), opacity: 0.55, marginTop: 6, fontWeight: 600 }}>{movie.year}</div>
          )}
        </div>
      )}
      {url && (
        <img src={url} alt={movie.title}
          onLoad={() => setLoaded(true)} onError={() => setErrored(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            opacity: loaded && !errored ? 1 : 0, transition: "opacity .3s" }} />
      )}
    </div>
  );
}

function ActorPhoto({ actor, size = 40 }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = actor.profile_path ? `${TMDB_IMG}/w185${actor.profile_path}` : null;
  const [g1, g2] = gradientFor(actor.id || actor.name);
  const parts = (actor.name || "").split(" ");
  const initials = ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase();
  const showFallback = !url || errored;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      position: "relative", overflow: "hidden", flexShrink: 0,
      background: `linear-gradient(135deg, ${g1}, ${g2})`,
      boxShadow: "0 0 0 1px rgba(15,23,41,0.08) inset",
    }}>
      {showFallback && (
        <div style={{ position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "rgba(255,255,255,0.92)", fontFamily: "'Manrope', sans-serif",
          fontWeight: 700, fontSize: size * 0.4 }}>{initials}</div>
      )}
      {url && (
        <img src={url} alt={actor.name}
          onLoad={() => setLoaded(true)} onError={() => setErrored(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            opacity: loaded && !errored ? 1 : 0, transition: "opacity .3s" }} />
      )}
    </div>
  );
}

// =========================================================================
// LOGO
// =========================================================================

function Logo({ size = 28, color = C.ink }) {
  return (
    <svg width={size * 1.8} height={size} viewBox="0 0 50 28" style={{ display: "block" }}>
      <circle cx="5" cy="14" r="3.5" fill={color}/>
      <path d="M 9 14 Q 25 0, 41 14" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="45" cy="14" r="3.5" fill={color}/>
    </svg>
  );
}

function LogoMark({ size = 24, color = C.ink }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block" }}>
      <circle cx="6" cy="16" r="3" fill={color}/>
      <path d="M 9 16 Q 16 6, 23 16" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
      <circle cx="26" cy="16" r="3" fill={color}/>
    </svg>
  );
}

// =========================================================================
// STYLES + SPINNER
// =========================================================================

const btnPrimary = {
  background: C.ink, color: C.white, border: "none",
  borderRadius: 999, padding: "11px 22px",
  fontSize: 12, letterSpacing: 1.3, textTransform: "uppercase",
  cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
  boxShadow: "0 4px 14px rgba(15,23,41,0.18)",
};
const btnSecondary = {
  ...glass, border: `1px solid ${C.hairline}`,
  borderRadius: 999, padding: "11px 22px",
  fontSize: 12, letterSpacing: 1.3, textTransform: "uppercase",
  cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.ink,
};
const iconBtn = {
  background: "rgba(255,255,255,0.6)",
  border: `1px solid ${C.hairline}`,
  borderRadius: "50%", width: 30, height: 30,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", fontFamily: "inherit", fontSize: 13,
  color: C.ink, fontWeight: 500,
};

function Spinner({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        border: `3px solid ${C.hairline}`, borderTopColor: C.ink,
        animation: "fil-spin 0.9s linear infinite",
      }} />
      {label && <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, textAlign: "center", maxWidth: 280 }}>{label}</div>}
      <style>{`@keyframes fil-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// =========================================================================
// APP
// =========================================================================

export default function App() {
  const [screen, setScreen] = useState("menu");
  const [challenge, setChallenge] = useState(null);
  const [gameKey, setGameKey] = useState(0);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Préparation du défi…");
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  async function startRandom() {
    setLoadingChallenge(true);
    setLoadingLabel("Préparation du défi…");
    setError(null);
    try {
      const ch = await pickValidChallenge(prefs, (tryNum, maxTries) => {
        if (maxTries > 1) setLoadingLabel(`Recherche d'une paire · essai ${tryNum}/${maxTries}`);
      });
      setChallenge(ch);
      setGameKey(k => k + 1);
      setScreen("game");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoadingChallenge(false);
    }
  }

  async function startCustom(startMovie, endMovie) {
    setLoadingChallenge(true);
    setLoadingLabel("Calcul du chemin optimal…");
    setError(null);
    try {
      const optimal = await findOptimalPath(startMovie.id, endMovie.id, 5);
      if (!optimal) throw new Error("Aucun chemin trouvé entre ces deux films.");
      setChallenge({ start: startMovie, end: endMovie, optimal });
      setGameKey(k => k + 1);
      setScreen("game");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingChallenge(false);
    }
  }

  function retrySame() { setGameKey(k => k + 1); }

  return (
    <Background>
      <Fonts />
      {loadingChallenge && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(250,250,250,0.7)", backdropFilter: "blur(8px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner label={loadingLabel} />
        </div>
      )}
      {error && (
        <div onClick={() => setError(null)}
          style={{ position: "fixed", top: 16, left: 16, right: 16, ...glassDark, borderRadius: 14,
          padding: "12px 18px", zIndex: 200, maxWidth: 480, margin: "0 auto", cursor: "pointer" }}>
          <span style={{ fontSize: 13 }}>Erreur : {error}</span>
        </div>
      )}
      {screen === "menu" && (
        <Menu onNavigate={setScreen} onPlay={startRandom}
              prefs={prefs} setPrefs={setPrefs} />
      )}
      {screen === "game" && challenge && (
        <Game key={gameKey} challenge={challenge}
              onExit={() => setScreen("menu")}
              onReplay={startRandom} onRetry={retrySame} />
      )}
      {screen === "custom" && <CustomScreen onBack={() => setScreen("menu")} onStart={startCustom} />}
      {screen === "multi" && <MultiScreen onBack={() => setScreen("menu")} />}
      {screen === "account" && <AccountScreen onBack={() => setScreen("menu")} />}
    </Background>
  );
}

function Background({ children }) {
  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden",
      background: C.bg, fontFamily: "'Manrope', system-ui, sans-serif", color: C.ink }}>
      <div style={{ position: "absolute", top: "-20%", left: "-10%", width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(15,23,41,0.06), transparent 70%)", filter: "blur(80px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-25%", right: "-15%", width: 700, height: 700, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(15,23,41,0.05), transparent 70%)", filter: "blur(90px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>{children}</div>
    </div>
  );
}

function Fonts() {
  return <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />;
}

// =========================================================================
// MENU
// =========================================================================

function Menu({ onNavigate, onPlay, prefs, setPrefs }) {
  const [showFilters, setShowFilters] = useState(false);

  const items = [
    { key: "play", label: "Jouer", sub: "Défi aléatoire", action: onPlay, primary: true },
    { key: "custom", label: "Sur Mesure", sub: "Choisis ton défi", action: () => onNavigate("custom") },
    { key: "multi", label: "Multijoueur", sub: "Affronte tes amis", action: () => onNavigate("multi") },
    { key: "account", label: "Compte", sub: "Profil et stats", action: () => onNavigate("account") },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "48px 24px", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
        .menu-item { animation: fadeUp .5s ease both; transition: transform .25s ease; }
        .menu-item:hover { transform: translateY(-2px); }
      `}</style>

      <div style={{ textAlign: "center", marginTop: 40, marginBottom: 40 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Logo size={32} /></div>
        <h1 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 56, lineHeight: .95,
          letterSpacing: -3, margin: 0, color: C.ink }}>Fil</h1>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginTop: 14, fontWeight: 500 }}>Relie les films</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, marginBottom: 8, paddingLeft: 4 }}>Difficulté</div>
        <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
          {Object.entries(DIFFICULTIES).map(([key, d]) => {
            const active = prefs.difficulty === key;
            return (
              <button key={key}
                onClick={() => setPrefs(p => ({ ...p, difficulty: key }))}
                style={{
                  flex: 1, padding: "9px 6px", borderRadius: 999, border: "none",
                  background: active ? C.ink : "transparent",
                  color: active ? C.white : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  letterSpacing: 0.4, textTransform: "uppercase",
                  cursor: "pointer", transition: "background .15s",
                }}>
                {d.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 6, paddingLeft: 4, fontWeight: 500 }}>
          {DIFFICULTIES[prefs.difficulty].sub}
        </div>
      </div>

      <button
        onClick={() => setShowFilters(s => !s)}
        style={{
          ...glass, borderRadius: 14, padding: "10px 14px", marginBottom: 16,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          color: C.ink, cursor: "pointer", letterSpacing: 0.3,
        }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚙</span>
          Filtres avancés
          {(prefs.excludeGenres.length > 0
            || prefs.languages.length < Object.keys(LANGUAGES).length) && (
            <span style={{ background: C.ink, color: C.white, fontSize: 9, padding: "2px 7px",
              borderRadius: 999, fontWeight: 700, letterSpacing: 0.5 }}>
              actifs
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, opacity: .5, transition: "transform .2s",
          transform: showFilters ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
      </button>

      {showFilters && <FiltersPanel prefs={prefs} setPrefs={setPrefs} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, marginTop: 4 }}>
        {items.map((it, i) => (
          <button key={it.key} className="menu-item" onClick={it.action}
            style={{ ...(it.primary ? glassDark : glass), borderRadius: 18, padding: "18px 22px",
              display: "flex", alignItems: "center", gap: 16, cursor: "pointer", fontFamily: "inherit",
              textAlign: "left", animationDelay: `${i * 0.05}s`, color: it.primary ? C.white : C.ink }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: -0.5, lineHeight: 1, marginBottom: 4 }}>{it.label}</div>
              <div style={{ fontSize: 11, opacity: .65, letterSpacing: .3, fontWeight: 400 }}>{it.sub}</div>
            </div>
            <div style={{ fontSize: 15, opacity: .5 }}>→</div>
          </button>
        ))}
      </div>

      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 3, color: C.inkMute, marginTop: 24, textTransform: "uppercase", fontWeight: 500 }}>v2.1 · Supabase</div>
    </div>
  );
}

function FiltersPanel({ prefs, setPrefs }) {
  const allLangs = Object.keys(LANGUAGES);
  const allGenres = Object.keys(GENRES);
  const allLangsChecked = prefs.languages.length === allLangs.length;
  const allGenresExcluded = prefs.excludeGenres.length === allGenres.length;

  function toggleAllLangs() {
    setPrefs(p => ({ ...p, languages: allLangsChecked ? ["en"] : allLangs }));
  }
  function toggleAllGenres() {
    setPrefs(p => ({ ...p, excludeGenres: allGenresExcluded ? [] : allGenres.map(Number) }));
  }
  function toggleLang(code) {
    setPrefs(p => {
      const has = p.languages.includes(code);
      const next = has ? p.languages.filter(l => l !== code) : [...p.languages, code];
      return { ...p, languages: next.length === 0 ? ["en"] : next };
    });
  }
  function toggleGenre(id) {
    setPrefs(p => {
      const n = Number(id);
      const has = p.excludeGenres.map(Number).includes(n);
      return { ...p, excludeGenres: has ? p.excludeGenres.filter(g => Number(g) !== n) : [...p.excludeGenres, n] };
    });
  }

  return (
    <div style={{ ...glass, borderRadius: 16, padding: 14, marginBottom: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>
            Langues acceptées
          </div>
          <button onClick={toggleAllLangs}
            style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer", opacity: 0.75 }}>
            {allLangsChecked ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {allLangs.map(code => {
            const active = prefs.languages.includes(code);
            return (
              <button key={code} onClick={() => toggleLang(code)}
                style={{
                  padding: "7px 12px", borderRadius: 999, border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : "rgba(255,255,255,0.5)",
                  color: active ? C.white : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s",
                }}>
                {LANGUAGES[code]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>
            Genres exclus du tirage
          </div>
          <button onClick={toggleAllGenres}
            style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer", opacity: 0.75 }}>
            {allGenresExcluded ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {allGenres.map(id => {
            const active = prefs.excludeGenres.map(Number).includes(Number(id));
            return (
              <button key={id} onClick={() => toggleGenre(id)}
                style={{
                  padding: "7px 12px", borderRadius: 999, border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : "rgba(255,255,255,0.5)",
                  color: active ? C.white : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s",
                  textDecoration: active ? "line-through" : "none",
                }}>
                {GENRES[id]}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: C.inkMute, marginTop: 8, fontWeight: 500, lineHeight: 1.4 }}>
          Les genres exclus ne seront pas tirés comme départ ou arrivée, mais restent disponibles dans la filmographie des acteurs.
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// GAME
// =========================================================================

function Game({ challenge, onExit, onReplay, onRetry }) {
  const [path, setPath] = useState([{ type: "movie", data: challenge.start }]);
  const [castOfCurrent, setCastOfCurrent] = useState(null);
  const [filmoOfActor, setFilmoOfActor] = useState(null);
  const [selectedActor, setSelectedActor] = useState(null);
  const [loadingCast, setLoadingCast] = useState(false);
  const [loadingFilmo, setLoadingFilmo] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [finished, setFinished] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  const currentMovie = path[path.length - 1].data;
  const isAtEnd = currentMovie.id === challenge.end.id;

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed(Date.now() - startTime), 100);
    return () => clearInterval(id);
  }, [startTime, finished]);

  useEffect(() => { if (isAtEnd && !finished) setFinished(true); }, [isAtEnd, finished]);

  // Auto-close de la confirmation d'abandon après 3 secondes
  useEffect(() => {
    if (!confirmingAbandon) return;
    const t = setTimeout(() => setConfirmingAbandon(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingAbandon]);

  useEffect(() => {
    if (selectedActor) return;
    let cancelled = false;
    setLoadingCast(true);
    setCastOfCurrent(null);
    getMovieCast(currentMovie.id, 12).then(cast => {
      if (!cancelled) { setCastOfCurrent(cast); setLoadingCast(false); }
    }).catch(e => { console.error(e); setLoadingCast(false); });
    return () => { cancelled = true; };
  }, [currentMovie.id, selectedActor]);

  useEffect(() => {
    if (!selectedActor) return;
    let cancelled = false;
    setLoadingFilmo(true);
    setFilmoOfActor(null);
    getActorMovies(selectedActor.id, currentMovie.id, 30).then(movies => {
      if (!cancelled) { setFilmoOfActor(movies); setLoadingFilmo(false); }
    }).catch(e => { console.error(e); setLoadingFilmo(false); });
    return () => { cancelled = true; };
  }, [selectedActor, currentMovie.id]);

  const playerSteps = Math.max(0, Math.floor((path.length - 1) / 2));
  const formatTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function pickActor(actor) { setClicks(c => c + 1); setSelectedActor(actor); }
  function pickMovie(movie) {
    setClicks(c => c + 1);
    setPath([...path, { type: "actor", data: selectedActor }, { type: "movie", data: movie }]);
    setSelectedActor(null);
    setFilmoOfActor(null);
  }
  function undo() {
    setClicks(c => c + 1);
    if (selectedActor) { setSelectedActor(null); setFilmoOfActor(null); return; }
    if (path.length <= 1) return;
    setPath(path.slice(0, -2));
  }

  function handleAbandonClick() {
    if (!confirmingAbandon) {
      setConfirmingAbandon(true);
      return;
    }
    setAbandoned(true);
    setFinished(true);
  }

  if (finished) {
    return (
      <GameShell elapsed={elapsed} clicks={clicks} formatTime={formatTime} onExit={onExit} muted>
        <EndScreen path={path} optimal={challenge.optimal} elapsed={elapsed} clicks={clicks}
          formatTime={formatTime} playerSteps={playerSteps} abandoned={abandoned}
          onReplay={onReplay} onRetry={onRetry} onMenu={onExit} />
      </GameShell>
    );
  }

  return (
    <GameShell elapsed={elapsed} clicks={clicks} formatTime={formatTime} onExit={onExit}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } .fadeUp { animation: fadeUp .35s ease both; }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 24 }}>
        <Goal label="Départ" movie={challenge.start} />
        <div style={{ flex: 1, height: 1, background: C.hairline, marginTop: 56 }} />
        <Goal label="Arrivée" movie={challenge.end} align="right" />
      </div>
      <Trail path={path} />
      <div className="fadeUp" key={path.length + (selectedActor?.id || "")} style={{ marginTop: 24 }}>
        {!selectedActor ? (
          loadingCast ? <Spinner label="Chargement du casting" /> :
          castOfCurrent && <ActorPicker title={`Casting · ${currentMovie.title}`} actors={castOfCurrent} onPick={pickActor} />
        ) : (
          loadingFilmo ? <Spinner label={`Filmographie de ${selectedActor.name}`} /> :
          filmoOfActor && <MoviePicker title={`Filmographie · ${selectedActor.name}`}
            movies={filmoOfActor} targetId={challenge.end.id} onPick={pickMovie}
            onClose={() => { setClicks(c => c + 1); setSelectedActor(null); setFilmoOfActor(null); }} />
        )}
      </div>

      {/* Barre du bas — avec bouton Abandonner */}
      <div style={{ position: "fixed", bottom: 16, left: 16, right: 16, ...glass, borderRadius: 999,
        padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, maxWidth: 480, margin: "0 auto" }}>
        <button onClick={undo} disabled={path.length <= 1 && !selectedActor} style={iconBtn}>←</button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500 }}>
            {playerSteps} {playerSteps > 1 ? "étapes" : "étape"}
          </div>
          <span style={{ color: C.inkMute, fontSize: 10 }}>·</span>
          <button onClick={handleAbandonClick}
            style={{
              background: confirmingAbandon ? C.amber : "transparent",
              color: confirmingAbandon ? C.white : C.inkSoft,
              border: confirmingAbandon ? `1px solid ${C.amber}` : "none",
              padding: confirmingAbandon ? "5px 12px" : "5px 4px",
              borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              transition: "all .15s",
            }}>
            {confirmingAbandon ? "Confirmer ?" : "Abandonner"}
          </button>
        </div>

        <button onClick={() => { setClicks(c => c + 1); onRetry && onRetry(); }} style={iconBtn} title="Réessayer">↻</button>
      </div>
    </GameShell>
  );
}

function GameShell({ children, elapsed, clicks, formatTime, onExit, muted }) {
  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100 }}>
      <header style={{ padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 720, margin: "0 auto", gap: 8 }}>
        <button onClick={onExit} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600 }}>← Menu</button>
        {!muted && (
          <div style={{ display: "flex", gap: 8 }}>
            <Stat icon="⏱" value={formatTime(elapsed)} />
            <Stat icon="✦" value={clicks} label="clics" />
          </div>
        )}
      </header>
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "8px 20px" }}>{children}</main>
    </div>
  );
}

function Stat({ icon, value, label, valueColor }) {
  return (
    <div style={{ ...glass, borderRadius: 999, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6,
      fontFamily: "'Manrope', sans-serif", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: C.ink }}>
      <span style={{ fontSize: 11, opacity: .55 }}>{icon}</span>
      <span style={{ color: valueColor || C.ink }}>{value}</span>
      {label && <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500, marginLeft: 2 }}>{label}</span>}
    </div>
  );
}

function Goal({ label, movie, align = "left" }) {
  return (
    <div style={{ textAlign: align, maxWidth: 130, display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <Poster movie={movie} size={80} rounded={10} />
      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.15, letterSpacing: -0.4, color: C.ink, marginTop: 8 }}>{movie.title}</div>
      <div style={{ fontSize: 11, color: C.inkMute, marginTop: 2, fontWeight: 500 }}>{movie.year}</div>
    </div>
  );
}

function Trail({ path }) {
  return (
    <div style={{ ...glass, borderRadius: 18, padding: "12px 14px",
      display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
      {path.map((node, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: C.inkMute, fontSize: 10 }}>—</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {node.type === "movie" ? <Poster movie={node.data} size={28} rounded={5} /> : <ActorPhoto actor={node.data} size={28} />}
            <span style={{ fontWeight: node.type === "movie" ? 700 : 500,
              fontSize: node.type === "movie" ? 13 : 11,
              letterSpacing: node.type === "movie" ? -0.2 : 0,
              color: node.type === "movie" ? C.ink : C.inkSoft,
              maxWidth: 110, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {node.type === "movie" ? node.data.title : node.data.name}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function ActorPicker({ title, actors, onPick }) {
  return (
    <div style={{ ...glass, borderRadius: 20, padding: 12 }}>
      <div style={{ padding: "4px 6px 12px" }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {actors.map(a => (
          <button key={a.id} onClick={() => onPick(a)}
            style={{ background: "rgba(255,255,255,0.5)", border: `1px solid ${C.hairline}`,
              padding: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              fontFamily: "inherit", borderRadius: 14, transition: "background .15s, transform .15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(15,23,41,0.04)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.5)"; e.currentTarget.style.transform = "translateY(0)"; }}>
            <ActorPhoto actor={a} size={56} />
            <span style={{ fontSize: 11, fontWeight: 600, color: C.ink, textAlign: "center", lineHeight: 1.2 }}>{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MoviePicker({ title, movies, targetId, onPick, onClose }) {
  return (
    <div style={{ ...glass, borderRadius: 20, padding: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px 6px" }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600 }}>{title}</div>
        <button onClick={onClose} style={{ ...iconBtn, fontSize: 14 }}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" }}>
        {movies.length === 0 && (
          <div style={{ padding: 24, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucun autre film trouvé.</div>
        )}
        {movies.map(m => {
          const isTarget = m.id === targetId;
          return (
            <button key={m.id} onClick={() => onPick(m)}
              style={{ background: "rgba(255,255,255,0.4)", border: "none",
                padding: "8px 10px", textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit", borderRadius: 14, transition: "background .15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(15,23,41,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.4)")}>
              <Poster movie={m} size={42} rounded={7} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.3, color: C.ink,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 11, color: C.inkMute, fontWeight: 500 }}>{m.year}</div>
              </div>
              {isTarget && <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                color: C.white, background: C.ink, padding: "4px 9px", borderRadius: 999, fontWeight: 600, flexShrink: 0 }}>Objectif</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EndScreen({ path, optimal, elapsed, clicks, formatTime, playerSteps, abandoned, onReplay, onRetry, onMenu }) {
  const optimalSteps = optimal && optimal.length > 0
    ? Math.max(0, Math.floor((optimal.length - 1) / 2))
    : null;

  const isOptimal = !abandoned && optimalSteps !== null && playerSteps <= optimalSteps;
  let verdict, verdictColor;

  if (abandoned) {
    verdict = "Abandonné";
    verdictColor = C.inkSoft;
  } else if (optimalSteps === null) {
    verdict = "Bravo !";
    verdictColor = C.ink;
  } else {
    const diff = playerSteps - optimalSteps;
    if (diff <= 0) { verdict = "Chemin optimal"; verdictColor = C.green; }
    else if (diff === 1) { verdict = "Une étape de plus"; verdictColor = C.ink; }
    else { verdict = `${diff} étapes de plus`; verdictColor = C.ink; }
  }

  return (
    <div style={{ textAlign: "center", paddingTop: 8 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>Résultat</div>
      <div style={{ fontWeight: 800, fontSize: 36, lineHeight: 1.05, color: verdictColor, marginBottom: 14, letterSpacing: -1.4 }}>{verdict}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
        <Stat icon="✦" value={`${playerSteps}${optimalSteps !== null ? ` / ${optimalSteps}` : ""}`} label="étapes"
              valueColor={isOptimal ? C.green : undefined} />
        <Stat icon="⏱" value={formatTime(elapsed)} />
        <Stat icon="◯" value={clicks} label="clics" />
      </div>

      <div style={{ ...glass, borderRadius: 18, padding: 14, marginBottom: 10, textAlign: "left" }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.ink, marginBottom: 10, fontWeight: 700 }}>
          {abandoned ? "Ton parcours (incomplet)" : "Ton parcours"}
        </div>
        <PathStrip path={path} />
      </div>

      {optimal && optimal.length > 0 && (
        <div style={{ ...glass, borderRadius: 18, padding: 14, textAlign: "left", opacity: 0.95 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 700 }}>
            Chemin optimal · {optimalSteps} étape{optimalSteps > 1 ? "s" : ""}
          </div>
          <OptimalPathStrip path={optimal} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={onMenu} style={btnSecondary}>Menu</button>
        {onRetry && <button onClick={onRetry} style={btnSecondary}>Réessayer</button>}
        <button onClick={onReplay} style={btnPrimary}>Nouvelle partie</button>
      </div>
    </div>
  );
}

function PathStrip({ path }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {path.map((node, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: C.inkMute, fontSize: 10 }}>—</span>}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            {node.type === "movie" ? <Poster movie={node.data} size={42} rounded={7} /> : <ActorPhoto actor={node.data} size={42} />}
            <span style={{ fontWeight: node.type === "movie" ? 700 : 500, fontSize: 10,
              color: node.type === "movie" ? C.ink : C.inkSoft,
              maxWidth: 70, textAlign: "center", lineHeight: 1.2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {node.type === "movie" ? node.data.title : node.data.name.split(" ")[0]}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function OptimalPathStrip({ path }) {
  const [hydrated, setHydrated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const movieIds = path.filter(n => n.type === "movie").map(n => n.id);
    if (movieIds.length === 0) { setHydrated([]); return; }
    supabase.from("movies").select("id, title, year, poster_path").in("id", movieIds).then(({ data }) => {
      if (cancelled || !data) return;
      const map = new Map(data.map(m => [m.id, m]));
      setHydrated(path.map(n => n.type === "movie" ? { type: "movie", data: map.get(n.id) || { id: n.id, title: "…" } } : n));
    });
    return () => { cancelled = true; };
  }, [path]);

  if (!hydrated) return <div style={{ padding: 8, fontSize: 12, color: C.inkSoft }}>Chargement…</div>;
  return <PathStrip path={hydrated} />;
}

// =========================================================================
// SUR MESURE
// =========================================================================

function CustomScreen({ onBack, onStart }) {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pickingFor, setPickingFor] = useState("start");

  useEffect(() => {
    if (!search || search.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchMovies(search, 20)); }
      catch (e) { console.error(e); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  function tryStart() {
    if (!start || !end) return;
    if (start.id === end.id) return;
    onStart(start, end);
  }

  return (
    <div style={{ minHeight: "100vh", padding: "20px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600 }}>← Menu</button>
      </header>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Sur Mesure</div>
        <h2 style={{ fontWeight: 800, fontSize: 36, margin: 0, letterSpacing: -1.5, lineHeight: 1 }}>Compose ton défi</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <Slot label="Film de départ" movie={start} active={pickingFor === "start"}
          onClick={() => setPickingFor("start")} onClear={() => setStart(null)} />
        <div style={{ textAlign: "center", color: C.inkMute, fontSize: 18 }}>↓</div>
        <Slot label="Film d'arrivée" movie={end} active={pickingFor === "end"}
          onClick={() => setPickingFor("end")} onClear={() => setEnd(null)} />
      </div>
      <div style={{ ...glass, borderRadius: 16, padding: 6, marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={`Rechercher un film pour ${pickingFor === "start" ? "le départ" : "l'arrivée"}…`}
          style={{ width: "100%", background: "transparent", border: "none", outline: "none",
            padding: "10px 12px", fontSize: 14, fontFamily: "inherit", color: C.ink, fontWeight: 500 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 320, overflowY: "auto", ...glass, borderRadius: 16, padding: 6 }}>
        {searching && <Spinner label="Recherche" />}
        {!searching && results.length === 0 && search.length >= 2 && (
          <div style={{ padding: 24, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucun film trouvé.</div>
        )}
        {!searching && results.map(m => {
          const isSelected = pickingFor === "start" ? m.id === start?.id : m.id === end?.id;
          return (
            <button key={m.id} onClick={() => {
              if (pickingFor === "start") { setStart(m); setPickingFor("end"); }
              else { setEnd(m); }
              setSearch("");
            }}
              style={{ background: isSelected ? C.ink : "rgba(255,255,255,0.4)",
                color: isSelected ? C.white : C.ink, border: "none",
                padding: "8px 10px", textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit", borderRadius: 12 }}>
              <Poster movie={m} size={36} rounded={6} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.3,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 11, opacity: .6, fontWeight: 500 }}>{m.year}</div>
              </div>
            </button>
          );
        })}
      </div>
      <button onClick={tryStart} disabled={!start || !end}
        style={{ ...btnPrimary, marginTop: 20, width: "100%",
          opacity: (!start || !end) ? 0.3 : 1, cursor: (!start || !end) ? "not-allowed" : "pointer" }}>
        Lancer le défi
      </button>
    </div>
  );
}

function Slot({ label, movie, active, onClick, onClear }) {
  return (
    <div onClick={onClick} style={{ ...glass, borderRadius: 18, padding: "12px 14px",
      border: active ? `1.5px solid ${C.ink}` : `1px solid ${C.hairline}`,
      cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
      {movie ? <Poster movie={movie} size={50} rounded={8} /> :
        <div style={{ width: 50, height: 75, borderRadius: 8, background: "rgba(15,23,41,0.05)",
          border: `1px dashed ${C.hairline}`, flexShrink: 0 }} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
          color: active ? C.ink : C.inkMute, marginBottom: 4, fontWeight: 600 }}>{label}</div>
        {movie ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.5, color: C.ink, lineHeight: 1.15 }}>{movie.title}</div>
            <div style={{ fontSize: 11, color: C.inkMute, fontWeight: 500, marginTop: 2 }}>{movie.year}</div>
          </div>
        ) : (
          <div style={{ fontWeight: 500, fontSize: 15, color: C.inkMute }}>À choisir…</div>
        )}
      </div>
      {movie && <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={iconBtn}>✕</button>}
    </div>
  );
}

// =========================================================================
// MULTIJOUEUR / COMPTE (placeholders)
// =========================================================================

function MultiScreen({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", padding: "20px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 48 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600 }}>← Menu</button>
      </header>
      <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, opacity: .25 }}><LogoMark size={40} /></div>
        <div style={{ fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: -1, color: C.ink }}>Bientôt disponible</div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, fontWeight: 500 }}>
          Le multijoueur arrive dans la prochaine étape :<br />invitations, défis en temps réel, classements.
        </div>
      </div>
    </div>
  );
}

function AccountScreen({ onBack }) {
  return (
    <div style={{ minHeight: "100vh", padding: "20px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 48 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600 }}>← Menu</button>
      </header>
      <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, opacity: .25 }}><LogoMark size={40} /></div>
        <div style={{ fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: -1, color: C.ink }}>À venir</div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, fontWeight: 500 }}>Profil, stats, historique.</div>
      </div>
    </div>
  );
}