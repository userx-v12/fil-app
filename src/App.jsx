import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// =========================================================================
// SUPABASE
// =========================================================================

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const TMDB_IMG = "https://image.tmdb.org/t/p";

// =========================================================================
// CONSTANTES MÉTIER
// =========================================================================

const GENRES = {
  28: "Action",
  12: "Aventure",
  16: "Animation",
  35: "Comédie",
  80: "Crime",
  99: "Documentaire",
  18: "Drame",
  10751: "Familial",
  14: "Fantastique",
  36: "Histoire",
  27: "Horreur",
  10402: "Musical",
  9648: "Mystère",
  10749: "Romance",
  878: "Science-Fiction",
  10770: "Téléfilm",
  53: "Thriller",
  10752: "Guerre",
  37: "Western",
};

const LANGUAGES = {
  en: "Anglais", fr: "Français", ja: "Japonais", zh: "Chinois",
  ko: "Coréen",  es: "Espagnol", de: "Allemand", it: "Italien",
};

const DIFFICULTIES = {
  random: { label: "Aléatoire", sub: "Niveau au hasard",  range: null },
  easy:   { label: "Facile",    sub: "1 à 2 étapes",      range: [1, 2] },
  medium: { label: "Moyen",     sub: "3 à 4 étapes",      range: [3, 4] },
  hard:   { label: "Difficile", sub: "5 étapes ou plus",  range: [5, 99] },
};

const MODES = {
  movie: { label: "Films",  sub: "Cinéma uniquement", types: ["movie"] },
  mix:   { label: "Mix",    sub: "Films + Séries",    types: ["movie", "tv"] },
  tv:    { label: "Séries", sub: "TV uniquement",     types: ["tv"] },
};

const ERAS = {
  e2020:      { label: "2020s",      minYear: 2020, maxYear: 2029 },
  e2010:      { label: "2010s",      minYear: 2010, maxYear: 2019 },
  e2000:      { label: "2000s",      minYear: 2000, maxYear: 2009 },
  e1990:      { label: "1990s",      minYear: 1990, maxYear: 1999 },
  e1980:      { label: "1980s",      minYear: 1980, maxYear: 1989 },
  before1980: { label: "Avant 1980", minYear: 0,    maxYear: 1979 },
};

const DEFAULT_PREFS = {
  mode: "movie",
  difficulty: "random",
  languages: ["en", "fr"],
  filterMode: "exclude",
  includeGenres: [],
  excludeGenres: [16, 99],
  eras: [],
  minRating: 7,
};

const RED = "#dc2626";

const ACTOR_FILMO_LIMIT = 200;
const CAST_LIMIT = 50;            // Cast stocké en cache et utilisé par le BFS (plus = plus de chances de trouver des liens)
const CAST_DISPLAY_DEFAULT = 30;  // Cast affiché par défaut dans le picker, le bouton "Voir plus" expose les autres

function categorizeDifficulty(optimalSteps) {
  if (optimalSteps === null || optimalSteps === undefined) return null;
  if (optimalSteps <= 2) return "easy";
  if (optimalSteps <= 4) return "medium";
  return "hard";
}

// Pondération aléatoire : Facile et Moyen plus probables que Difficile (qui galère à trouver)
function pickWeightedDifficulty() {
  const r = Math.random();
  if (r < 0.40) return "easy";    // 40%
  if (r < 0.80) return "medium";  // 40%
  return "hard";                  // 20%
}

// Helper : clé composite "id:type" pour identifier une œuvre de façon unique
const workKey = (w) => `${w.id}:${w.type}`;
const parseWorkKey = (k) => {
  const [id, type] = k.split(":");
  return { id: parseInt(id, 10), type };
};

// =========================================================================
// CACHE
// =========================================================================

// castCache : clé = "workId:workType"
const castCache = new Map();
const filmoCache = new Map();
const getCachedCast = (id, type) => castCache.get(`${id}:${type}`);
const setCachedCast = (id, type, c) => castCache.set(`${id}:${type}`, c);
const getCachedFilmo = (aid) => filmoCache.get(aid);
const setCachedFilmo = (aid, m) => filmoCache.set(aid, m);

// =========================================================================
// LOCAL STORAGE
// =========================================================================

const LS_PREFS = "fil-prefs-v6";
const LS_THEME = "fil-theme";
const LS_GAMES_PLAYED = "fil-games-played";
const LS_INFO_SEEN = "fil-info-seen";
const LS_USER_PRESET = "fil-user-preset";  // Snapshot des prefs sauvegardé par le user

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return DEFAULT_PREFS; }
}
function savePrefs(p) { try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch {} }
function loadTheme() {
  try { return localStorage.getItem(LS_THEME) || "dark"; }
  catch { return "dark"; }
}
function saveTheme(t) { try { localStorage.setItem(LS_THEME, t); } catch {} }
function loadGamesPlayed() { try { return parseInt(localStorage.getItem(LS_GAMES_PLAYED) || "0", 10); } catch { return 0; } }
function incrementGamesPlayed() {
  try {
    const c = loadGamesPlayed();
    localStorage.setItem(LS_GAMES_PLAYED, String(c + 1));
    return c + 1;
  } catch { return 0; }
}
function loadInfoSeen() { try { return localStorage.getItem(LS_INFO_SEEN) === "1"; } catch { return false; } }
function markInfoSeen() { try { localStorage.setItem(LS_INFO_SEEN, "1"); } catch {} }

function saveUserPreset(prefs) {
  try { localStorage.setItem(LS_USER_PRESET, JSON.stringify(prefs)); return true; }
  catch { return false; }
}
function loadUserPreset() {
  try {
    const raw = localStorage.getItem(LS_USER_PRESET);
    if (!raw) return null;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return null; }
}
function hasUserPreset() {
  try { return !!localStorage.getItem(LS_USER_PRESET); }
  catch { return false; }
}

// =========================================================================
// URL SHARING
// Nouveau format : ?challenge=550m-1399t  (suffixe m ou t pour le type)
// Ancien format  : ?challenge=550-1399    (rétro-compat, assumé en movies)
// =========================================================================

function getChallengeFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("challenge");
    if (!c) return null;
    // Nouveau format avec type
    const m = c.match(/^(\d+)([mt])-(\d+)([mt])$/);
    if (m) {
      return {
        startId: parseInt(m[1], 10),
        startType: m[2] === "m" ? "movie" : "tv",
        endId: parseInt(m[3], 10),
        endType: m[4] === "m" ? "movie" : "tv",
      };
    }
    // Ancien format : on assume movie pour les deux
    const [a, b] = c.split("-").map(Number);
    if (!a || !b || isNaN(a) || isNaN(b)) return null;
    return { startId: a, startType: "movie", endId: b, endType: "movie" };
  } catch { return null; }
}

function setChallengeInURL(startWork, endWork) {
  try {
    const sT = startWork.type === "tv" ? "t" : "m";
    const eT = endWork.type === "tv" ? "t" : "m";
    const url = new URL(window.location.href);
    url.searchParams.set("challenge", `${startWork.id}${sT}-${endWork.id}${eT}`);
    window.history.replaceState({}, "", url);
  } catch {}
}
function clearChallengeFromURL() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("challenge");
    window.history.replaceState({}, "", url);
  } catch {}
}

// =========================================================================
// API
// =========================================================================

/**
 * Récupère des œuvres par paires (id, type).
 * pairs : [{ id, type }, ...]
 * Retour : tableau de works, dans le même ordre que les paires (ou undefined si absent).
 */
async function getWorksByPairs(pairs) {
  if (!pairs?.length) return [];
  const ids = [...new Set(pairs.map(p => p.id))];
  const { data, error } = await supabase
    .from("works")
    .select("id, type, title, year, poster_path, popularity")
    .in("id", ids);
  if (error) throw error;
  const map = new Map((data || []).map(w => [`${w.id}:${w.type}`, w]));
  return pairs.map(p => map.get(`${p.id}:${p.type}`));
}

async function getMovieCast(workId, workType, limit = CAST_LIMIT) {
  const cached = getCachedCast(workId, workType);
  if (cached) return cached.slice(0, limit);
  const { data, error } = await supabase
    .from("credits")
    .select("ord, actors(id, name, profile_path, popularity)")
    .eq("work_id", workId)
    .eq("work_type", workType)
    .order("ord", { ascending: true, nullsFirst: false })
    .limit(CAST_LIMIT);
  if (error) throw error;
  const cast = data.map(r => ({ ...r.actors, ord: r.ord }));
  setCachedCast(workId, workType, cast);
  return cast.slice(0, limit);
}

async function getActorMovies(actorId, excludeWorkId = null, excludeWorkType = null, limit = ACTOR_FILMO_LIMIT) {
  const cached = getCachedFilmo(actorId);
  if (cached) return cached.filter(m => m && !(m.id === excludeWorkId && m.type === excludeWorkType)).slice(0, limit);
  const { data, error } = await supabase
    .from("credits")
    .select("works!inner(id, type, title, year, poster_path, popularity)")
    .eq("actor_id", actorId)
    .order("popularity", { foreignTable: "works", ascending: false })
    .limit(ACTOR_FILMO_LIMIT);
  if (error) throw error;
  const all = data.map(r => r.works).filter(Boolean);
  setCachedFilmo(actorId, all);
  return all.filter(m => !(m.id === excludeWorkId && m.type === excludeWorkType)).slice(0, limit);
}

/**
 * Récupère les castings de plusieurs œuvres en un appel.
 * workPairs : [{ id, type }, ...]
 * Retour : [{ workId, workType, cast }]
 */
async function getMovieCastsBatch(workPairs) {
  const missing = workPairs.filter(p => !getCachedCast(p.id, p.type));
  if (missing.length > 0) {
    const ids = [...new Set(missing.map(p => p.id))];
    const { data, error } = await supabase
      .from("credits")
      .select("work_id, work_type, ord, actors(id, name, profile_path, popularity)")
      .in("work_id", ids)
      .order("ord", { ascending: true, nullsFirst: false })
      .limit(50000);
    if (error) throw error;
    const neededKeys = new Set(missing.map(p => `${p.id}:${p.type}`));
    const grouped = new Map();
    for (const r of (data || [])) {
      const key = `${r.work_id}:${r.work_type}`;
      if (!neededKeys.has(key)) continue; // évite les collisions cross-type sur même id
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...r.actors, ord: r.ord });
    }
    for (const p of missing) {
      const key = `${p.id}:${p.type}`;
      setCachedCast(p.id, p.type, (grouped.get(key) || []).slice(0, CAST_LIMIT));
    }
  }
  return workPairs.map(p => ({
    workId: p.id,
    workType: p.type,
    cast: getCachedCast(p.id, p.type) || [],
  }));
}

async function getActorMoviesBatch(actorIds) {
  const missing = actorIds.filter(id => !getCachedFilmo(id));
  if (missing.length > 0) {
    const { data, error } = await supabase
      .from("credits")
      .select("actor_id, works!inner(id, type, title, year, poster_path, popularity)")
      .in("actor_id", missing)
      .order("popularity", { foreignTable: "works", ascending: false })
      .limit(50000);
    if (error) throw error;
    const grouped = new Map();
    for (const r of (data || [])) {
      if (!grouped.has(r.actor_id)) grouped.set(r.actor_id, []);
      grouped.get(r.actor_id).push(r.works);
    }
    for (const id of missing) {
      setCachedFilmo(id, (grouped.get(id) || []).filter(Boolean).slice(0, ACTOR_FILMO_LIMIT));
    }
  }
  return actorIds.map(id => ({ actorId: id, movies: getCachedFilmo(id) || [] }));
}

async function searchMovies(query, limit = 20) {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from("works")
    .select("id, type, title, year, poster_path, popularity")
    .ilike("title", `%${query.trim()}%`)
    .order("popularity", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function getCandidatePool(prefs, limit = 500, forHard = false) {
  // Mode Difficile : pool élargi (popularity ≥ 10 au lieu de 20, jusqu'à 1500 résultats)
  // pour augmenter les chances de trouver des paires éloignées (5+ étapes)
  const minPop = forHard ? 10 : 20;
  // Quand les filtres genres sont actifs, on élargit le pool SQL pour préserver la variété
  // (le filtrage genres se fait côté JS car les genres sont en JSONB sans index)
  const filterMode = prefs.filterMode || "exclude";
  const includeActive = filterMode === "include" && (prefs.includeGenres?.length || 0) > 0;
  const heavyExclude = filterMode === "exclude" && (prefs.excludeGenres?.length || 0) > 3;
  let sqlLimit;
  if (forHard) sqlLimit = 1500;
  else if (includeActive || heavyExclude) sqlLimit = 2000;
  else sqlLimit = limit;

  let q = supabase
    .from("works")
    .select("id, type, title, year, poster_path, popularity, original_language, genre_ids")
    .gte("popularity", minPop)
    .order("popularity", { ascending: false })
    .limit(sqlLimit);

  const modeTypes = MODES[prefs.mode]?.types || MODES.mix.types;
  if (modeTypes.length === 1) q = q.eq("type", modeTypes[0]);
  if (prefs.languages?.length && prefs.languages.length < Object.keys(LANGUAGES).length) {
    q = q.in("original_language", prefs.languages);
  }
  if (prefs.minRating && prefs.minRating > 0) {
    q = q.gte("vote_average", prefs.minRating);
  }

  if (prefs.eras?.length > 0) {
    const orConditions = prefs.eras
      .map(eraKey => ERAS[eraKey])
      .filter(Boolean)
      .map(e => `and(year.gte.${e.minYear},year.lte.${e.maxYear})`)
      .join(",");
    if (orConditions) q = q.or(orConditions);
  }

  const { data, error } = await q;
  if (error) throw error;
  if (!data) return [];

  // Filtrage genres côté JS
  if (filterMode === "include") {
    if (prefs.includeGenres?.length > 0) {
      const included = new Set(prefs.includeGenres.map(Number));
      return data.filter(m => {
        const genres = Array.isArray(m.genre_ids) ? m.genre_ids : [];
        return genres.some(g => included.has(Number(g)));
      });
    }
    return data; // include mode + liste vide = aucun filtre genre
  } else {
    if (prefs.excludeGenres?.length > 0) {
      const excluded = new Set(prefs.excludeGenres.map(Number));
      return data.filter(m => {
        const genres = Array.isArray(m.genre_ids) ? m.genre_ids : [];
        return !genres.some(g => excluded.has(Number(g)));
      });
    }
    return data;
  }
}

async function pickRandomPair(prefs, forHard = false) {
  const pool = await getCandidatePool(prefs, 500, forHard);
  if (!pool || pool.length < 2) {
    throw new Error("Trop peu d'œuvres avec ces filtres. Élargis tes critères.");
  }
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  let safety = 10;
  while ((b.id === a.id && b.type === a.type) && safety-- > 0) {
    b = pool[Math.floor(Math.random() * pool.length)];
  }
  return { start: a, end: b };
}

// Pour le refresh sélectif : tire UN nouveau partenaire pour un film déjà fixé.
async function pickPartnerFor(fixed, prefs, forHard = false) {
  const pool = await getCandidatePool(prefs, 500, forHard);
  if (!pool || pool.length < 1) {
    throw new Error("Trop peu d'œuvres avec ces filtres.");
  }
  const candidates = pool.filter(p => !(p.id === fixed.id && p.type === fixed.type));
  if (candidates.length < 1) throw new Error("Aucun partenaire possible.");
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// =========================================================================
// BFS
// On identifie chaque œuvre par sa clé composite "id:type".
// =========================================================================

async function neighborsOfMoviesBatch(works) {
  const castsResult = await getMovieCastsBatch(works);
  const allActorIds = new Set();
  for (const { cast } of castsResult) {
    for (const a of cast) allActorIds.add(a.id);
  }
  await getActorMoviesBatch(Array.from(allActorIds));
  const result = new Map();
  for (const { workId, workType, cast } of castsResult) {
    const neighbors = [];
    for (const a of cast) {
      const filmo = getCachedFilmo(a.id) || [];
      for (const m of filmo) {
        if (m.id === workId && m.type === workType) continue; // pas soi-même
        neighbors.push({ actor: a, movie: m });
      }
    }
    result.set(`${workId}:${workType}`, neighbors);
  }
  return result;
}

async function findOptimalPath(start, end, maxDepth = 4) {
  const sKey = workKey(start);
  const eKey = workKey(end);
  if (sKey === eKey) return [{ type: "movie", data: { id: start.id, type: start.type } }];

  const fromStart = new Map([[sKey, { actor: null, parent: null }]]);
  const fromEnd   = new Map([[eKey, { actor: null, parent: null }]]);
  let frontierStart = [start];
  let frontierEnd   = [end];

  for (let depth = 0; depth < maxDepth; depth++) {
    const useStart = frontierStart.length <= frontierEnd.length;
    const frontier = useStart ? frontierStart : frontierEnd;
    const visited  = useStart ? fromStart : fromEnd;
    const other    = useStart ? fromEnd : fromStart;
    const neighborsMap = await neighborsOfMoviesBatch(frontier);
    const nextFrontier = [];
    for (const fromWork of frontier) {
      const fromKey = workKey(fromWork);
      const neighbors = neighborsMap.get(fromKey) || [];
      for (const { actor, movie } of neighbors) {
        const mKey = workKey(movie);
        if (visited.has(mKey)) continue;
        visited.set(mKey, { actor, parent: fromKey });
        if (other.has(mKey)) return reconstruct(mKey, fromStart, fromEnd);
        nextFrontier.push(movie);
      }
    }
    if (useStart) frontierStart = nextFrontier; else frontierEnd = nextFrontier;
    if (!nextFrontier.length) return null;
  }
  return null;
}

function reconstruct(meetKey, fromStart, fromEnd) {
  const left = [];
  let curKey = meetKey;
  while (curKey != null) {
    const n = fromStart.get(curKey);
    if (!n) break;
    left.unshift({ type: "movie", data: parseWorkKey(curKey) });
    if (n.actor) left.unshift({ type: "actor", data: n.actor });
    curKey = n.parent;
  }
  const right = [];
  curKey = meetKey;
  const node = fromEnd.get(curKey);
  if (node && node.parent != null) {
    let pKey = node.parent;
    let a = node.actor;
    while (pKey != null) {
      if (a) right.push({ type: "actor", data: a });
      right.push({ type: "movie", data: parseWorkKey(pKey) });
      const next = fromEnd.get(pKey);
      if (!next) break;
      pKey = next.parent;
      a = next.actor;
    }
  }
  return [...left, ...right];
}

// =========================================================================
// THÈMES
// =========================================================================

const THEMES = {
  light: {
    name: "light", bg: "#fafafa", ink: "#0f1729",
    inkSoft: "rgba(15, 23, 41, 0.55)", inkMute: "rgba(15, 23, 41, 0.35)",
    hairline: "rgba(15, 23, 41, 0.08)", white: "#ffffff",
    green: "#16a34a", greenSoft: "#84cc16",
    amber: "#a16207", orange: "#ea580c",
    yellow: "#eab308",
    glassBg: "rgba(255, 255, 255, 0.65)", glassDarkBg: "#0f1729", glassDarkInk: "#ffffff",
    radialA: "rgba(15,23,41,0.06)", radialB: "rgba(15,23,41,0.05)",
    cardHover: "rgba(15,23,41,0.04)", cardBg: "rgba(255,255,255,0.5)",
    cardBg2: "rgba(255,255,255,0.4)", iconBtnBg: "rgba(255,255,255,0.6)",
    modalOverlay: "rgba(15,23,41,0.5)",
  },
  dark: {
    name: "dark", bg: "#0a0e18", ink: "#fafafa",
    inkSoft: "rgba(250, 250, 250, 0.65)", inkMute: "rgba(250, 250, 250, 0.40)",
    hairline: "rgba(250, 250, 250, 0.10)", white: "#0f1729",
    green: "#22c55e", greenSoft: "#a3e635",
    amber: "#d97706", orange: "#f97316",
    yellow: "#facc15",
    glassBg: "rgba(30, 38, 58, 0.55)", glassDarkBg: "#fafafa", glassDarkInk: "#0f1729",
    radialA: "rgba(99, 102, 241, 0.08)", radialB: "rgba(244, 114, 182, 0.06)",
    cardHover: "rgba(250,250,250,0.06)", cardBg: "rgba(255,255,255,0.04)",
    cardBg2: "rgba(255,255,255,0.03)", iconBtnBg: "rgba(255,255,255,0.06)",
    modalOverlay: "rgba(0,0,0,0.7)",
  },
};

const buildGlass = (C) => ({
  background: C.glassBg,
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: `1px solid ${C.hairline}`,
  boxShadow: C.name === "light"
    ? "0 1px 2px rgba(15,23,41,0.04), 0 8px 24px rgba(15,23,41,0.06)"
    : "0 1px 2px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.3)",
});
const buildGlassDark = (C) => ({
  background: C.glassDarkBg, border: `1px solid ${C.glassDarkBg}`,
  color: C.glassDarkInk,
  boxShadow: C.name === "light" ? "0 4px 16px rgba(15,23,41,0.18)" : "0 4px 16px rgba(0,0,0,0.5)",
});

const GRADIENT_PALETTE = [
  ["#1e3a5f", "#0f1729"], ["#2d4a6f", "#1a2540"], ["#3d2b50", "#1a1029"],
  ["#4a3320", "#1f1610"], ["#1f3d3d", "#0d1f1f"], ["#4a2030", "#1f0d18"],
  ["#2a4030", "#101f18"], ["#3a3a60", "#1a1a30"],
];
const hashId = (id) => { let h = 0; const s = String(id); for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i); return Math.abs(h); };
const gradientFor = (id) => GRADIENT_PALETTE[hashId(id) % GRADIENT_PALETTE.length];

const isTv = (m) => m && m.type === "tv";

// =========================================================================
// IMAGES
// =========================================================================

function Poster({ movie, size = 60, rounded = 10, highlight = false, highlightColor, themeColors }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = movie.poster_path ? `${TMDB_IMG}/w342${movie.poster_path}` : null;
  const [g1, g2] = gradientFor(movie.id || movie.title);
  const words = (movie.title || "").split(" ").filter(w => w.length > 1);
  const initials = ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase();
  const showFallback = !url || errored;
  const C = themeColors;
  const hColor = highlightColor || (C ? C.green : "#16a34a");
  return (
    <div style={{
      width: size, height: size * 1.5, borderRadius: rounded,
      position: "relative", overflow: "hidden", flexShrink: 0,
      background: `linear-gradient(135deg, ${g1}, ${g2})`,
      boxShadow: highlight && C ? `0 0 0 3px ${hColor}, 0 0 20px ${hColor}80`
                                : "0 2px 8px rgba(15,23,41,0.12), 0 0 0 1px rgba(15,23,41,0.06) inset",
      transition: "box-shadow .25s",
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

function ActorPhoto({ actor, size = 40, highlight = false, highlightColor, themeColors }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = actor.profile_path ? `${TMDB_IMG}/w185${actor.profile_path}` : null;
  const [g1, g2] = gradientFor(actor.id || actor.name);
  const parts = (actor.name || "").split(" ");
  const initials = ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase();
  const showFallback = !url || errored;
  const C = themeColors;
  const hColor = highlightColor || (C ? C.green : "#16a34a");
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      position: "relative", overflow: "hidden", flexShrink: 0,
      background: `linear-gradient(135deg, ${g1}, ${g2})`,
      boxShadow: highlight && C ? `0 0 0 3px ${hColor}, 0 0 16px ${hColor}80`
                                : "0 0 0 1px rgba(15,23,41,0.08) inset",
      transition: "box-shadow .25s",
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

function TvLabel({ size = "small", themeColors }) {
  const fontSize = size === "tiny" ? 8 : size === "small" ? 9 : 10;
  const C = themeColors;
  return (
    <span style={{ fontSize, letterSpacing: 1.5, textTransform: "uppercase",
      color: C.inkMute, fontWeight: 600, marginTop: 1, display: "block" }}>série</span>
  );
}

function Logo({ size = 28, color }) {
  return (
    <svg width={size * 1.8} height={size} viewBox="0 0 50 28" style={{ display: "block" }}>
      <circle cx="5" cy="14" r="3.5" fill={color}/>
      <path d="M 9 14 Q 25 0, 41 14" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="45" cy="14" r="3.5" fill={color}/>
    </svg>
  );
}
function LogoMark({ size = 24, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block" }}>
      <circle cx="6" cy="16" r="3" fill={color}/>
      <path d="M 9 16 Q 16 6, 23 16" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
      <circle cx="26" cy="16" r="3" fill={color}/>
    </svg>
  );
}

function Spinner({ label, themeColors }) {
  const C = themeColors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%",
        border: `3px solid ${C.hairline}`, borderTopColor: C.ink,
        animation: "fil-spin 0.9s linear infinite" }} />
      {label && <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, textAlign: "center", maxWidth: 280 }}>{label}</div>}
      <style>{`@keyframes fil-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// =========================================================================
// BOUTONS RONDS EN HAUT
// =========================================================================

function TopRoundButton({ position, onClick, children, title, themeColors, zIndex = 50 }) {
  const C = themeColors;
  const positionStyle = position === "left"
    ? { left: "max(16px, calc(50% - 240px + 16px))" }
    : { right: "max(16px, calc(50% - 240px + 16px))" };
  return (
    <button onClick={onClick} title={title}
      style={{
        ...buildGlass(C),
        borderRadius: "50%", width: 38, height: 38,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontFamily: "inherit", color: C.ink,
        transition: "transform .2s",
        position: "fixed", top: 16, ...positionStyle, zIndex,
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
      onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}>
      {children}
    </button>
  );
}

function ThemeIcon({ isLight, color }) {
  return isLight ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  );
}

function AccountIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

// =========================================================================
// INFO MODAL (Comment jouer)
// =========================================================================

function InfoModal({ onClose, themeColors, glass, glassDark }) {
  const C = themeColors;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: C.modalOverlay,
        backdropFilter: "blur(8px)", zIndex: 500,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, animation: "fadeIn .25s ease both" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{ ...glass, borderRadius: 24, padding: "28px 24px",
          maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto",
          animation: "slideUp .35s cubic-bezier(.34,1.56,.64,1) both",
          position: "relative" }}>
        <button onClick={onClose}
          style={{ position: "absolute", top: 14, right: 14,
            background: C.iconBtnBg, border: `1px solid ${C.hairline}`,
            borderRadius: "50%", width: 30, height: 30,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: C.ink, fontFamily: "inherit", fontSize: 14 }}>✕</button>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo size={26} color={C.ink} />
        </div>
        <h2 style={{ fontWeight: 800, fontSize: 28, letterSpacing: -1.2,
          textAlign: "center", margin: "0 0 6px", color: C.ink }}>Comment jouer</h2>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase",
          color: C.inkSoft, textAlign: "center", marginBottom: 20, fontWeight: 600 }}>Le concept</div>

        <p style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, margin: "0 0 8px", fontWeight: 500 }}>
          Tu reçois <strong>deux films</strong> : un de départ, un d'arrivée.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: C.ink, margin: "0 0 22px", fontWeight: 500 }}>
          Ton but : aller de l'un à l'autre en passant par <strong>les acteurs qu'ils ont en commun</strong> avec d'autres films.
        </p>

        <div style={{ background: C.cardBg, borderRadius: 16, padding: "16px 12px", marginBottom: 22,
          border: `1px solid ${C.hairline}` }}>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
            color: C.inkMute, marginBottom: 12, textAlign: "center", fontWeight: 600 }}>Exemple</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
            gap: 3, flexWrap: "nowrap" }}>
            <ExampleNode label="Titanic" type="movie" color="#6366f1" highlight="start" />
            <ExampleArrow color={C.inkMute} />
            <ExampleNode label="DiCaprio" type="actor" color={C.inkSoft} />
            <ExampleArrow color={C.inkMute} />
            <ExampleNode label="Inception" type="movie" color={C.ink} />
            <ExampleArrow color={C.inkMute} />
            <ExampleNode label="Hardy" type="actor" color={C.inkSoft} />
            <ExampleArrow color={C.inkMute} />
            <ExampleNode label="Mad Max" type="movie" color={C.green} highlight="end" />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Rule num="1" text="Clique sur un acteur du film de départ" C={C} />
          <Rule num="2" text="Choisis un de ses films, qui devient ton nouveau point" C={C} />
          <Rule num="3" text="Recommence jusqu'à atteindre le film d'arrivée" C={C} />
          <Rule num="4" text="Moins d'étapes = meilleur score" C={C} />
        </div>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.hairline}` }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 12, fontWeight: 600 }}>Infos pratiques</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: C.ink, margin: "0 0 10px", fontWeight: 500 }}>
            <strong>Comptage des étapes</strong> : une étape = un acteur puis un nouveau film. Le film de départ ne compte pas.
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: C.inkSoft, margin: 0, fontStyle: "italic" }}>
            Exemple : Titanic → DiCaprio → Inception = 1 étape.
          </p>
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.hairline}`,
          fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>
          💡 <strong>Astuce</strong> : utilise le bouton <strong>indice</strong> (ampoule) si tu es bloqué.
          Il met en évidence l'acteur ou le film à choisir.
        </div>

        <button onClick={onClose}
          style={{ ...glassDark, borderRadius: 999, padding: "12px 24px",
            border: "none", cursor: "pointer", fontFamily: "inherit",
            fontSize: 12, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase",
            marginTop: 22, width: "100%" }}>
          C'est parti !
        </button>
      </div>
    </div>
  );
}

function ExampleNode({ label, type, color, highlight }) {
  const isMovie = type === "movie";
  const bg = highlight === "start" ? "rgba(99,102,241,0.15)"
           : highlight === "end"   ? "rgba(34,197,94,0.15)"
           : isMovie ? "rgba(255,255,255,0.08)" : "transparent";
  const border = highlight === "start" ? "1px solid rgba(99,102,241,0.5)"
               : highlight === "end"   ? "1px solid rgba(34,197,94,0.5)"
               : isMovie ? "1px solid rgba(255,255,255,0.12)" : "none";
  return (
    <span style={{ fontSize: isMovie ? 9 : 8, fontWeight: isMovie ? 700 : 500,
        color, padding: "4px 7px", borderRadius: 999,
        background: bg, border,
        whiteSpace: "nowrap", letterSpacing: -0.2,
        flexShrink: 0 }}>{label}</span>
  );
}

function ExampleArrow({ color }) {
  return <span style={{ color, fontSize: 9, fontWeight: 600, flexShrink: 0 }}>→</span>;
}

function Rule({ num, text, C }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%",
        background: C.ink, color: C.bg, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, flexShrink: 0 }}>{num}</div>
      <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.5, paddingTop: 1 }}>{text}</div>
    </div>
  );
}

// =========================================================================
// APP
// =========================================================================

export default function App() {
  const [theme, setTheme] = useState(loadTheme);
  const themeColors = THEMES[theme];
  const C = themeColors;
  const glass = useMemo(() => buildGlass(C), [C]);
  const glassDark = useMemo(() => buildGlassDark(C), [C]);

  const [screen, setScreen] = useState("menu");
  const [challenge, setChallenge] = useState(null);
  const [gameKey, setGameKey] = useState(0);
  const [loadingChallenge, setLoadingChallenge] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Préparation du défi…");
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [gamesPlayed, setGamesPlayed] = useState(loadGamesPlayed);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => { savePrefs(prefs); }, [prefs]);
  useEffect(() => { document.body.style.background = C.bg; saveTheme(theme); }, [theme, C.bg]);

  useEffect(() => {
    if (!loadInfoSeen()) {
      setShowInfo(true);
      markInfoSeen();
    }
  }, []);

  useEffect(() => {
    const urlChallenge = getChallengeFromURL();
    if (urlChallenge) loadChallengeFromURL(urlChallenge);
  }, []);

  function toggleTheme() { setTheme(t => t === "light" ? "dark" : "light"); }

  async function loadChallengeFromURL(c) {
    setLoadingChallenge(true);
    setLoadingLabel("Chargement du défi partagé…");
    setError(null);
    try {
      const works = await getWorksByPairs([
        { id: c.startId, type: c.startType },
        { id: c.endId,   type: c.endType   },
      ]);
      const start = works[0];
      const end   = works[1];
      if (!start || !end) throw new Error("Défi introuvable.");
      setChallenge({ start, end, optimal: null, optimalLoading: true, modeUsed: prefs.mode, difficultyUsed: prefs.difficulty });
      setGameKey(k => k + 1);
      setScreen("game");
      findOptimalPath(start, end, 5).then(optimal => {
        setChallenge(c2 => c2 && c2.start.id === start.id && c2.start.type === start.type
                              && c2.end.id === end.id && c2.end.type === end.type
          ? { ...c2, optimal, optimalLoading: false } : c2);
      }).catch(() => {});
    } catch (e) {
      setError(e.message);
      clearChallengeFromURL();
    } finally {
      setLoadingChallenge(false);
    }
  }

  async function startRandom() {
    clearChallengeFromURL();
    setError(null);

    // En mode "Aléatoire", on pioche secrètement easy/medium/hard avec pondération
    // (Facile et Moyen 40% chacun, Difficile 20%) pour garder un bon rythme de jeu
    const isRandomMode = prefs.difficulty === "random";
    let target = prefs.difficulty;
    if (isRandomMode) {
      target = pickWeightedDifficulty();
    }
    const targetRange = DIFFICULTIES[target]?.range;
    const targetLabel = DIFFICULTIES[target]?.label || "défi";
    const forHard = target === "hard";

    setLoadingChallenge(true);
    setLoadingLabel(isRandomMode
      ? "Recherche d'un défi…"
      : `Recherche d'un défi ${targetLabel.toLowerCase()}…`);

    const MAX_TRIES = 10;
    let lastAttempt = null;

    try {
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const { start, end } = await pickRandomPair(prefs, forHard);
        const optimal = await findOptimalPath(start, end, 5);
        if (!optimal || optimal.length < 3) continue;

        const steps = Math.floor((optimal.length - 1) / 2);
        lastAttempt = { start, end, optimal };

        if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
          setChallenge({
            start, end, optimal,
            optimalLoading: false,
            modeUsed: prefs.mode,
            difficultyUsed: target,
          });
          setGameKey(k => k + 1);
          setScreen("game");
          setLoadingChallenge(false);
          return;
        }
      }

      // Fallback : on accepte le dernier essai même si la difficulté ne matche pas exactement
      if (lastAttempt) {
        setError(`Pas de défi ${targetLabel.toLowerCase()} trouvé, voici le plus proche.`);
        setChallenge({
          start: lastAttempt.start, end: lastAttempt.end,
          optimal: lastAttempt.optimal,
          optimalLoading: false,
          modeUsed: prefs.mode,
          difficultyUsed: target,
        });
        setGameKey(k => k + 1);
        setScreen("game");
        setLoadingChallenge(false);
      } else {
        throw new Error("Aucun défi trouvé. Élargis tes critères.");
      }
    } catch (e) {
      setError(e.message);
      setLoadingChallenge(false);
    }
  }

  // Refresh sélectif : change un seul des deux films (Départ OU Arrivée), garde l'autre.
  // Cherche un nouveau partenaire qui matche la difficulté du défi en cours.
  async function refreshOnePart(which) {
    if (!challenge) return;
    const fixed = which === "start" ? challenge.end : challenge.start;
    const target = challenge.difficultyUsed && DIFFICULTIES[challenge.difficultyUsed]?.range
      ? challenge.difficultyUsed
      : pickWeightedDifficulty();
    const targetRange = DIFFICULTIES[target]?.range;
    const targetLabel = DIFFICULTIES[target]?.label || "défi";
    const forHard = target === "hard";

    setLoadingChallenge(true);
    setLoadingLabel(`Nouveau ${which === "start" ? "départ" : "arrivée"}…`);
    setError(null);

    const MAX_TRIES = 10;
    let lastAttempt = null;

    try {
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const newOne = await pickPartnerFor(fixed, prefs, forHard);
        const start = which === "start" ? newOne : fixed;
        const end   = which === "start" ? fixed  : newOne;
        const optimal = await findOptimalPath(start, end, 5);
        if (!optimal || optimal.length < 3) continue;

        const steps = Math.floor((optimal.length - 1) / 2);
        lastAttempt = { start, end, optimal };

        if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
          setChallenge({
            start, end, optimal,
            optimalLoading: false,
            modeUsed: prefs.mode,
            difficultyUsed: target,
          });
          setGameKey(k => k + 1);
          setLoadingChallenge(false);
          return;
        }
      }
      if (lastAttempt) {
        setError(`Pas de remplacement ${targetLabel.toLowerCase()} trouvé, voici le plus proche.`);
        setChallenge({
          start: lastAttempt.start, end: lastAttempt.end,
          optimal: lastAttempt.optimal,
          optimalLoading: false,
          modeUsed: prefs.mode,
          difficultyUsed: target,
        });
        setGameKey(k => k + 1);
        setLoadingChallenge(false);
      } else {
        throw new Error("Aucun remplacement trouvé.");
      }
    } catch (e) {
      setError(e.message);
      setLoadingChallenge(false);
    }
  }

  async function startCustom(startMovie, endMovie) {
    clearChallengeFromURL();
    setLoadingChallenge(true);
    setLoadingLabel("Lancement du défi…");
    setError(null);
    try {
      setChallenge({ start: startMovie, end: endMovie, optimal: null, optimalLoading: true, modeUsed: prefs.mode, difficultyUsed: "custom" });
      setGameKey(k => k + 1);
      setScreen("game");
      setLoadingChallenge(false);
      const optimal = await findOptimalPath(startMovie, endMovie, 5);
      if (!optimal) {
        setError("Aucun chemin trouvé entre ces deux œuvres.");
        setScreen("menu");
        return;
      }
      setChallenge(c => c && c.start.id === startMovie.id && c.start.type === startMovie.type
                          && c.end.id === endMovie.id && c.end.type === endMovie.type
        ? { ...c, optimal, optimalLoading: false } : c);
    } catch (e) {
      setError(e.message);
      setLoadingChallenge(false);
    }
  }

  function retrySame() { setGameKey(k => k + 1); }
  function onGameFinished() { setGamesPlayed(incrementGamesPlayed()); }

  const showTopButtons = screen !== "game";

  return (
    <Background themeColors={C}>
      <Fonts />
      {showTopButtons && (
        <>
          <TopRoundButton position="left" onClick={toggleTheme} title={theme === "light" ? "Mode sombre" : "Mode clair"} themeColors={C}>
            <ThemeIcon isLight={theme === "light"} color={C.ink} />
          </TopRoundButton>
          <TopRoundButton position="right" onClick={() => setScreen("account")} title="Compte" themeColors={C}>
            <AccountIcon color={C.ink} />
          </TopRoundButton>
        </>
      )}
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} themeColors={C} glass={glass} glassDark={glassDark} />}
      {loadingChallenge && (
        <div style={{ position: "fixed", inset: 0, background: theme === "light" ? "rgba(250,250,250,0.7)" : "rgba(10,14,24,0.7)", backdropFilter: "blur(8px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Spinner label={loadingLabel} themeColors={C} />
        </div>
      )}
      {error && (
        <div onClick={() => setError(null)}
          style={{ position: "fixed", top: 16, left: 70, right: 70, ...glassDark, borderRadius: 14,
          padding: "12px 18px", zIndex: 200, maxWidth: 380, margin: "0 auto", cursor: "pointer" }}>
          <span style={{ fontSize: 13 }}>Erreur : {error}</span>
        </div>
      )}
      {screen === "menu" && (
        <Menu onNavigate={setScreen} onPlay={startRandom}
              prefs={prefs} setPrefs={setPrefs}
              themeColors={C} glass={glass} glassDark={glassDark}
              gamesPlayed={gamesPlayed} onOpenInfo={() => setShowInfo(true)} />
      )}
      {screen === "game" && challenge && (
        <Game key={gameKey} challenge={challenge}
              onExit={() => { clearChallengeFromURL(); setScreen("menu"); }}
              onReplay={startRandom} onRetry={retrySame}
              onFinished={onGameFinished}
              onRefreshPart={refreshOnePart}
              themeColors={C} glass={glass} glassDark={glassDark} theme={theme} />
      )}
      {screen === "custom" && <CustomScreen onBack={() => setScreen("menu")} onStart={startCustom}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "multi" && <MultiScreen onBack={() => setScreen("menu")} themeColors={C} glass={glass} />}
      {screen === "options" && <OptionsScreen onBack={() => setScreen("menu")} prefs={prefs} setPrefs={setPrefs}
                                themeColors={C} glass={glass} />}
      {screen === "account" && <AccountScreen onBack={() => setScreen("menu")} themeColors={C} glass={glass}
                                  gamesPlayed={gamesPlayed} />}
    </Background>
  );
}

function Background({ children, themeColors }) {
  const C = themeColors;
  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden",
      background: C.bg, fontFamily: "'Manrope', system-ui, sans-serif", color: C.ink, transition: "background .25s, color .25s" }}>
      <div style={{ position: "absolute", top: "-20%", left: "-10%", width: 600, height: 600, borderRadius: "50%",
        background: `radial-gradient(circle, ${C.radialA}, transparent 70%)`, filter: "blur(80px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-25%", right: "-15%", width: 700, height: 700, borderRadius: "50%",
        background: `radial-gradient(circle, ${C.radialB}, transparent 70%)`, filter: "blur(90px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>{children}</div>
    </div>
  );
}

function Fonts() {
  return <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />;
}

// =========================================================================
// MENU PRINCIPAL
// =========================================================================

function Menu({ onNavigate, onPlay, prefs, setPrefs, themeColors, glass, glassDark, gamesPlayed, onOpenInfo }) {
  const C = themeColors;
  const items = [
    { key: "play", label: "Jouer", sub: "Défi aléatoire", action: onPlay, primary: true },
    { key: "custom", label: "Sur Mesure", sub: "Choisis ton défi", action: () => onNavigate("custom") },
    { key: "multi", label: "Versus", sub: "Affronte un ami", action: () => onNavigate("multi") },
    { key: "options", label: "Options", sub: "Difficulté, genres, époques", action: () => onNavigate("options") },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "70px 24px 48px", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
        .menu-item { animation: fadeUp .5s ease both; transition: transform .25s ease; }
        .menu-item:hover { transform: translateY(-2px); }
      `}</style>

      <div style={{ textAlign: "center", marginTop: 20, marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Logo size={32} color={C.ink} /></div>
        <h1 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 56, lineHeight: .95,
          letterSpacing: -3, margin: 0, color: C.ink }}>Fil</h1>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginTop: 14, fontWeight: 500 }}>Relie les films</div>
        <button onClick={onOpenInfo}
          style={{ background: "none", border: "none", color: C.inkSoft, fontFamily: "inherit",
            fontSize: 11, letterSpacing: 1.5, marginTop: 10, cursor: "pointer",
            padding: "6px 12px", borderRadius: 999,
            textDecoration: "underline", textUnderlineOffset: 3,
            opacity: 0.7, fontWeight: 500 }}>Comment jouer ?</button>
        {gamesPlayed > 0 && (
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.inkMute, marginTop: 10, fontWeight: 500 }}>
            {gamesPlayed} {gamesPlayed > 1 ? "parties jouées" : "partie jouée"}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, marginBottom: 8, paddingLeft: 4 }}>Mode</div>
        <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
          {Object.entries(MODES).map(([key, m]) => {
            const active = prefs.mode === key;
            return (
              <button key={key} onClick={() => setPrefs(p => ({ ...p, mode: key }))}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 999, border: "none",
                  background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: "uppercase",
                  cursor: "pointer", transition: "background .15s" }}>{m.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 6, paddingLeft: 4, fontWeight: 500 }}>{MODES[prefs.mode].sub}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {items.map((it, i) => (
          <button key={it.key} className="menu-item" onClick={it.action}
            style={{ ...(it.primary ? glassDark : glass), borderRadius: 18, padding: "18px 22px",
              display: "flex", alignItems: "center", gap: 16, cursor: "pointer", fontFamily: "inherit",
              textAlign: "left", animationDelay: `${i * 0.05}s`,
              color: it.primary ? C.bg : C.ink, border: "none" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: -0.5, lineHeight: 1, marginBottom: 4 }}>{it.label}</div>
              <div style={{ fontSize: 11, opacity: .65, letterSpacing: .3, fontWeight: 400 }}>{it.sub}</div>
            </div>
            <div style={{ fontSize: 15, opacity: .5 }}>→</div>
          </button>
        ))}
      </div>

      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 3, color: C.inkMute, marginTop: 24, textTransform: "uppercase", fontWeight: 500 }}>v5.7</div>
    </div>
  );
}

// =========================================================================
// OPTIONS SCREEN
// =========================================================================

function OptionsScreen({ onBack, prefs, setPrefs, themeColors, glass }) {
  const C = themeColors;
  const allLangs = Object.keys(LANGUAGES);
  const allGenres = Object.keys(GENRES);
  const allLangsChecked = prefs.languages.length === allLangs.length;
  const [presetExists, setPresetExists] = useState(hasUserPreset());
  const [actionFeedback, setActionFeedback] = useState(null); // "saved" | "restored"

  function toggleAllLangs() { setPrefs(p => ({ ...p, languages: allLangsChecked ? ["en"] : allLangs })); }
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
      const isInclude = (p.filterMode || "exclude") === "include";
      const key = isInclude ? "includeGenres" : "excludeGenres";
      const cur = (p[key] || []).map(Number);
      const has = cur.includes(n);
      return { ...p, [key]: has ? cur.filter(g => g !== n) : [...cur, n] };
    });
  }
  function clearGenres() {
    setPrefs(p => {
      const isInclude = (p.filterMode || "exclude") === "include";
      return { ...p, [isInclude ? "includeGenres" : "excludeGenres"]: [] };
    });
  }
  function toggleEra(key) {
    setPrefs(p => {
      const current = p.eras || [];
      const has = current.includes(key);
      return { ...p, eras: has ? current.filter(k => k !== key) : [...current, key] };
    });
  }
  function resetDefaults() {
    setPrefs({ ...DEFAULT_PREFS });
  }
  function savePreset() {
    saveUserPreset(prefs);
    setPresetExists(true);
    setActionFeedback("saved");
    setTimeout(() => setActionFeedback(null), 2000);
  }
  function restorePreset() {
    const p = loadUserPreset();
    if (p) {
      setPrefs(p);
      setActionFeedback("restored");
      setTimeout(() => setActionFeedback(null), 2000);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "70px 24px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Options</div>
        <h2 style={{ fontWeight: 800, fontSize: 36, margin: 0, letterSpacing: -1.5, lineHeight: 1, color: C.ink }}>Réglages</h2>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 12 }}>Difficulté</div>
        <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
          {Object.entries(DIFFICULTIES).map(([key, d]) => {
            const active = prefs.difficulty === key;
            return (
              <button key={key} onClick={() => setPrefs(p => ({ ...p, difficulty: key }))}
                style={{ flex: 1, padding: "9px 4px", borderRadius: 999, border: "none",
                  background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  letterSpacing: 0.4, textTransform: "uppercase",
                  cursor: "pointer", transition: "background .15s" }}>{d.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 6, fontWeight: 500 }}>{DIFFICULTIES[prefs.difficulty].sub}</div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Époques</div>
          {prefs.eras?.length > 0 && (
            <button onClick={() => setPrefs(p => ({ ...p, eras: [] }))}
              style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", opacity: 0.75 }}>Tout décocher</button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(ERAS).map(([key, e]) => {
            const active = (prefs.eras || []).includes(key);
            return (
              <button key={key} onClick={() => toggleEra(key)}
                style={{ padding: "8px 14px", borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s" }}>{e.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 10, fontWeight: 500, lineHeight: 1.4 }}>
          {(prefs.eras || []).length === 0
            ? "Aucun filtre actif : toutes les époques sont incluses."
            : "Films et séries des époques sélectionnées uniquement."}
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <style>{`
          .rating-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: ${C.hairline};
            outline: none;
            margin: 14px 0 6px;
            cursor: pointer;
          }
          .rating-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: ${C.ink};
            cursor: pointer;
            border: 2px solid ${C.bg};
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: transform .15s;
          }
          .rating-slider::-webkit-slider-thumb:hover {
            transform: scale(1.15);
          }
          .rating-slider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: ${C.ink};
            cursor: pointer;
            border: 2px solid ${C.bg};
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }
        `}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Note minimale</div>
          {(prefs.minRating || 0) > 0 && (
            <button onClick={() => setPrefs(p => ({ ...p, minRating: 0 }))}
              style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", opacity: 0.75 }}>Désactiver</button>
          )}
        </div>
        <div style={{ marginTop: 8, marginBottom: 4, minHeight: 28, display: "flex", alignItems: "center" }}>
          {(prefs.minRating || 0) > 0
            ? <StarsDisplay stars={(prefs.minRating || 0) / 2} themeColors={C} size={22} />
            : <span style={{ fontSize: 14, fontWeight: 600, color: C.inkMute }}>Aucun filtre</span>}
        </div>
        <input type="range" min="0" max="9" step="1"
          value={prefs.minRating || 0}
          onChange={(e) => setPrefs(p => ({ ...p, minRating: parseInt(e.target.value, 10) }))}
          className="rating-slider" />
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 10, fontWeight: 500, lineHeight: 1.4 }}>
          Ne tire que des œuvres dont la note moyenne TMDb dépasse ce seuil. Évite les films oubliables.
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Langues acceptées</div>
          <button onClick={toggleAllLangs}
            style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
              fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer", opacity: 0.75 }}>{allLangsChecked ? "Tout décocher" : "Tout cocher"}</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {allLangs.map(code => {
            const active = prefs.languages.includes(code);
            return (
              <button key={code} onClick={() => toggleLang(code)}
                style={{ padding: "8px 14px", borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s" }}>{LANGUAGES[code]}</button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Genres</div>
          <div style={{ display: "flex", gap: 4, ...glass, padding: 3, borderRadius: 999 }}>
            {[{ key: "include", label: "Inclure" }, { key: "exclude", label: "Exclure" }].map(({ key, label }) => {
              const active = (prefs.filterMode || "exclude") === key;
              return (
                <button key={key} onClick={() => setPrefs(p => ({ ...p, filterMode: key }))}
                  style={{ padding: "6px 14px", borderRadius: 999, border: "none",
                    background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                    fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                    letterSpacing: 0.8, textTransform: "uppercase",
                    cursor: "pointer", transition: "background .15s" }}>{label}</button>
              );
            })}
          </div>
        </div>

        {(() => {
          const isInclude = (prefs.filterMode || "exclude") === "include";
          const activeList = isInclude ? (prefs.includeGenres || []) : (prefs.excludeGenres || []);
          const hasSelection = activeList.length > 0;
          return (
            <>
              {hasSelection && (
                <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={clearGenres}
                    style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                      fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                      cursor: "pointer", opacity: 0.75 }}>Vider</button>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {allGenres.map(id => {
                  const active = activeList.map(Number).includes(Number(id));
                  return (
                    <button key={id} onClick={() => toggleGenre(id)}
                      style={{ padding: "8px 14px", borderRadius: 999,
                        border: `1px solid ${active ? C.ink : C.hairline}`,
                        background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                        fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                        cursor: "pointer", transition: "all .15s",
                        textDecoration: (!isInclude && active) ? "line-through" : "none" }}>{GENRES[id]}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: C.inkMute, marginTop: 10, fontWeight: 500, lineHeight: 1.4 }}>
                {isInclude
                  ? (hasSelection
                      ? "Seuls les genres cochés seront tirés comme départ ou arrivée."
                      : "Aucun filtre actif : tous les genres sont autorisés.")
                  : (hasSelection
                      ? "Les genres barrés ne seront pas tirés comme départ ou arrivée."
                      : "Aucun filtre actif : tous les genres sont autorisés.")}
              </div>
            </>
          );
        })()}
      </div>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${C.hairline}`, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={savePreset}
          style={{ ...glass, borderRadius: 999, padding: "12px 22px",
            background: actionFeedback === "saved" ? C.green : C.glassBg,
            color: actionFeedback === "saved" ? "#fff" : C.ink,
            fontSize: 11, letterSpacing: 1.3, textTransform: "uppercase",
            cursor: "pointer", fontFamily: "inherit", fontWeight: 700,
            border: `1px solid ${actionFeedback === "saved" ? C.green : C.hairline}`,
            transition: "all .25s", width: "100%" }}>
          {actionFeedback === "saved" ? "✓ Préférences enregistrées" : "Enregistrer mes préférences"}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={restorePreset} disabled={!presetExists}
            style={{ ...glass, borderRadius: 999, padding: "11px 14px",
              background: actionFeedback === "restored" ? C.green + "30" : C.glassBg,
              color: actionFeedback === "restored" ? C.green : C.ink,
              fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
              cursor: presetExists ? "pointer" : "not-allowed",
              opacity: presetExists ? 1 : 0.4,
              fontFamily: "inherit", fontWeight: 600,
              border: `1px solid ${C.hairline}`, flex: 1 }}>
            {actionFeedback === "restored" ? "✓ Restauré" : "Restaurer mes préférences"}
          </button>
          <button onClick={resetDefaults}
            style={{ ...glass, borderRadius: 999, padding: "11px 14px",
              fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              color: C.ink, border: `1px solid ${C.hairline}`, flex: 1 }}>
            Valeurs par défaut
          </button>
        </div>
      </div>
    </div>
  );
}

// Composant Étoiles : value = nombre d'étoiles (0 à 5, demi acceptée)
function StarsDisplay({ stars, themeColors, size = 18 }) {
  const C = themeColors;
  const items = [];
  for (let i = 0; i < 5; i++) {
    const fill = Math.min(1, Math.max(0, stars - i)); // 0, 0.5 ou 1
    items.push(<Star key={i} fill={fill} size={size} color={C.ink} emptyColor={C.inkMute} />);
  }
  return <div style={{ display: "flex", gap: 3, alignItems: "center" }}>{items}</div>;
}

function Star({ fill, size, color, emptyColor }) {
  // fill: 0 (vide), 0.5 (demi), 1 (pleine)
  const path = "M12 2 L14.85 8.63 L22 9.27 L16.5 14.14 L18.18 21.02 L12 17.27 L5.82 21.02 L7.5 14.14 L2 9.27 L9.15 8.63 Z";
  const gradientId = `star-grad-${fill}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  if (fill >= 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
        <path d={path} fill={color} />
      </svg>
    );
  }
  if (fill >= 0.5) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="50%" stopColor={color} />
            <stop offset="50%" stopColor={emptyColor} stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <path d={path} fill={`url(#${gradientId})`} stroke={color} strokeWidth="0.5" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d={path} fill="none" stroke={emptyColor} strokeWidth="1.5" />
    </svg>
  );
}

// =========================================================================
// GAME
// =========================================================================

function Game({ challenge, onExit, onReplay, onRetry, onFinished, onRefreshPart, themeColors, glass, glassDark, theme }) {
  const C = themeColors;
  const [path, setPath] = useState([{ type: "movie", data: challenge.start }]);
  const [castOfCurrent, setCastOfCurrent] = useState(null);
  const [filmoOfActor, setFilmoOfActor] = useState(null);
  const [selectedActor, setSelectedActor] = useState(null);
  const [loadingCast, setLoadingCast] = useState(false);
  const [loadingFilmo, setLoadingFilmo] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintActive, setHintActive] = useState(false);
  const [hintAvailable, setHintAvailable] = useState(false);
  const [finished, setFinished] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const [filmoSort, setFilmoSort] = useState("popularity");
  const [castSort, setCastSort] = useState("popularity");

  const currentMovie = path[path.length - 1].data;
  const isAtEnd = currentMovie.id === challenge.end.id && currentMovie.type === challenge.end.type;

  useEffect(() => { setChallengeInURL(challenge.start, challenge.end); },
    [challenge.start.id, challenge.start.type, challenge.end.id, challenge.end.type]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed(Date.now() - startTime), 100);
    return () => clearInterval(id);
  }, [startTime, finished]);

  // L'indice ne devient disponible qu'après 15s à chaque nouvelle étape, pour décourager son usage compulsif.
  useEffect(() => {
    setHintAvailable(false);
    const t = setTimeout(() => setHintAvailable(true), 15000);
    return () => clearTimeout(t);
  }, [path.length, selectedActor]);

  useEffect(() => {
    if (isAtEnd && !finished) {
      setFinished(true);
      onFinished && onFinished();
    }
  }, [isAtEnd, finished, onFinished]);

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
    getMovieCast(currentMovie.id, currentMovie.type, 30).then(cast => {
      if (!cancelled) { setCastOfCurrent(cast); setLoadingCast(false); }
    }).catch(e => { console.error(e); setLoadingCast(false); });
    return () => { cancelled = true; };
  }, [currentMovie.id, currentMovie.type, selectedActor]);

  useEffect(() => {
    if (!selectedActor) return;
    let cancelled = false;
    setLoadingFilmo(true);
    setFilmoOfActor(null);
    getActorMovies(selectedActor.id, currentMovie.id, currentMovie.type, ACTOR_FILMO_LIMIT)
      .then(movies => {
        if (cancelled) return;
        setFilmoOfActor(movies || []);
        setLoadingFilmo(false);
      })
      .catch(e => {
        if (cancelled) return;
        console.error("Filmo error:", e);
        setFilmoOfActor([]);
        setLoadingFilmo(false);
      });
    return () => { cancelled = true; };
  }, [selectedActor, currentMovie.id, currentMovie.type]);

  const playerSteps = Math.max(0, Math.floor((path.length - 1) / 2));
  const formatTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  // Sets of "id:type" pour les œuvres déjà visitées
  const visitedMovieKeys = useMemo(
    () => new Set(path.filter(n => n.type === "movie").map(n => workKey(n.data))),
    [path]
  );
  const visitedActorIds = useMemo(
    () => new Set(path.filter(n => n.type === "actor").map(n => n.data.id)),
    [path]
  );

  const greenHint = useMemo(() => {
    if (!challenge.optimal || challenge.optimal.length < 2) return null;
    const idx = challenge.optimal.findIndex(
      n => n.type === "movie" && n.data.id === currentMovie.id && n.data.type === currentMovie.type
    );
    if (idx === -1) return null;
    if (!selectedActor) {
      const next = challenge.optimal[idx + 1];
      if (next && next.type === "actor") return { kind: "actor", id: next.data.id };
    } else {
      const optimalActor = challenge.optimal[idx + 1];
      if (optimalActor && optimalActor.type === "actor" && optimalActor.data.id === selectedActor.id) {
        const nextMovie = challenge.optimal[idx + 2];
        if (nextMovie && nextMovie.type === "movie") {
          return { kind: "movie", id: nextMovie.data.id, workType: nextMovie.data.type };
        }
      }
    }
    return null;
  }, [challenge.optimal, currentMovie.id, currentMovie.type, selectedActor]);

  const noGreenAvailable = hintActive && !greenHint;
  const showBackInGreen = hintActive && noGreenAvailable && (path.length > 1 || selectedActor);

  // L'indice s'éteint dès qu'on a fait notre prochain choix (changement de path ou ouverture/fermeture d'une filmo).
  useEffect(() => { setHintActive(false); }, [path.length, selectedActor]);

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
  function useHint() {
    if (hintActive) return;
    setHintsUsed(h => h + 1);
    setHintActive(true);
  }
  function handleAbandonClick() {
    if (!confirmingAbandon) { setConfirmingAbandon(true); return; }
    setAbandoned(true);
    setFinished(true);
    onFinished && onFinished();
  }

  if (finished) {
    return (
      <GameShell elapsed={elapsed} clicks={clicks} formatTime={formatTime} onExit={onExit} muted themeColors={C} glass={glass}>
        <EndScreen path={path} optimal={challenge.optimal} elapsed={elapsed} clicks={clicks}
          formatTime={formatTime} playerSteps={playerSteps} abandoned={abandoned} hintsUsed={hintsUsed}
          onReplay={onReplay} onRetry={onRetry} onMenu={onExit}
          themeColors={C} glass={glass} glassDark={glassDark}
          startWork={challenge.start} endWork={challenge.end}
          modeUsed={challenge.modeUsed} difficultyUsed={challenge.difficultyUsed} />
      </GameShell>
    );
  }

  return (
    <GameShell elapsed={elapsed} clicks={clicks} formatTime={formatTime} onExit={onExit} themeColors={C} glass={glass}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fadeUp { animation: fadeUp .35s ease both; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 24 }}>
        <Goal label="Départ" movie={challenge.start} themeColors={C}
          onRefresh={path.length === 1 && onRefreshPart ? () => onRefreshPart("start") : null} />
        <div style={{ flex: 1, height: 1, background: C.hairline, marginTop: 56 }} />
        <Goal label="Arrivée" movie={challenge.end} align="right" themeColors={C}
          onRefresh={path.length === 1 && onRefreshPart ? () => onRefreshPart("end") : null} />
      </div>
      <Trail path={path} themeColors={C} glass={glass} />
      <div className="fadeUp" key={path.length + (selectedActor?.id || "")} style={{ marginTop: 24 }}>
        {!selectedActor ? (
          loadingCast ? <Spinner label="Chargement du casting" themeColors={C} /> :
          castOfCurrent && <ActorPicker title={`Casting · ${currentMovie.title}`} actors={castOfCurrent} onPick={pickActor}
            greenId={hintActive && greenHint?.kind === "actor" ? greenHint.id : null}
            yellowIds={hintActive ? visitedActorIds : null}
            sort={castSort}
            onToggleSort={() => setCastSort(s => s === "popularity" ? "ord" : "popularity")}
            themeColors={C} glass={glass} />
        ) : (
          loadingFilmo ? <Spinner label={`Filmographie de ${selectedActor.name}`} themeColors={C} /> :
          filmoOfActor && <MoviePicker title={`Filmographie · ${selectedActor.name}`}
            movies={filmoOfActor} targetWork={challenge.end} onPick={pickMovie}
            greenWork={hintActive && greenHint?.kind === "movie" ? { id: greenHint.id, type: greenHint.workType } : null}
            yellowKeys={hintActive ? visitedMovieKeys : null}
            sort={filmoSort} onToggleSort={() => setFilmoSort(s => s === "popularity" ? "date" : "popularity")}
            onClose={() => { setClicks(c => c + 1); setSelectedActor(null); setFilmoOfActor(null); }}
            themeColors={C} glass={glass} />
        )}
      </div>

      {confirmingAbandon && (
        <div style={{ position: "fixed", bottom: 88, left: "50%", transform: "translateX(-50%)",
          zIndex: 60, animation: "fadeUp .2s ease both" }}>
          <button onClick={handleAbandonClick}
            style={{ background: C.amber, color: "#fff", border: "none",
              borderRadius: 999, padding: "11px 20px",
              fontSize: 12, fontFamily: "inherit", fontWeight: 700,
              letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer", boxShadow: "0 8px 24px rgba(161,98,7,0.4)" }}>
            Confirmer l'abandon ?
          </button>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 16, left: 16, right: 16, ...glass, borderRadius: 999,
        padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, maxWidth: 520, margin: "0 auto", zIndex: 60 }}>
        <button onClick={undo} disabled={path.length <= 1 && !selectedActor} title="Retour"
          style={{ ...iconBtn(C),
            background: showBackInGreen ? C.green : C.iconBtnBg,
            color: showBackInGreen ? "#fff" : C.ink,
            border: `1px solid ${showBackInGreen ? C.green : C.hairline}`,
            boxShadow: showBackInGreen ? `0 0 0 2px ${C.green}40, 0 0 16px ${C.green}60` : "none" }}>←</button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500 }}>
            {playerSteps} {playerSteps > 1 ? "étapes" : "étape"}
          </div>
          {challenge.optimalLoading && (
            <span style={{ fontSize: 9, color: C.inkMute, fontWeight: 600, letterSpacing: 1 }}>· calcul…</span>
          )}
        </div>

        <div style={{ position: "relative" }}>
          {/* Ring de chargement : se dessine en 15s pendant l'attente */}
          {!hintAvailable && !hintActive && !challenge.optimalLoading && (
            <svg key={`hint-charge-${path.length}-${selectedActor?.id || "none"}`}
              width="32" height="32" viewBox="0 0 32 32"
              style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 1 }}>
              <style>{`
                @keyframes hintCharge {
                  from { stroke-dashoffset: 87.96; }
                  to   { stroke-dashoffset: 0; }
                }
              `}</style>
              <circle cx="16" cy="16" r="14" fill="none"
                stroke={C.green} strokeWidth="2" strokeLinecap="round"
                strokeDasharray="87.96"
                style={{
                  animation: "hintCharge 15s linear forwards",
                  transform: "rotate(-90deg)",
                  transformOrigin: "16px 16px",
                  opacity: 0.7,
                }} />
            </svg>
          )}
          <button onClick={useHint} disabled={hintActive || challenge.optimalLoading || !hintAvailable}
            title={challenge.optimalLoading ? "En cours…" : !hintAvailable ? "Disponible dans quelques secondes…" : "Indice"}
            style={{ ...iconBtn(C),
              background: hintActive ? C.green : C.iconBtnBg,
              color: hintActive ? "#fff" : C.ink,
              opacity: (challenge.optimalLoading || !hintAvailable) ? 0.35 : 1,
              cursor: (challenge.optimalLoading || !hintAvailable) ? "not-allowed" : "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.5V17h8v-2.5A7 7 0 0 0 12 2z"/>
            </svg>
          </button>
        </div>

        <button onClick={() => onReplay && onReplay()} title="Nouvelle partie" style={iconBtn(C)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="12 4 12 12 18 12"/>
            <circle cx="12" cy="12" r="10"/>
            <polyline points="22 11 22 4 15 4"/>
          </svg>
        </button>

        <button onClick={handleAbandonClick} title="Abandonner"
          style={{ ...iconBtn(C), width: 36, height: 36,
            background: confirmingAbandon ? C.amber : C.iconBtnBg,
            color: confirmingAbandon ? "#fff" : C.amber,
            border: `1px solid ${confirmingAbandon ? C.amber : C.hairline}`,
            fontWeight: 700 }}>✕</button>
      </div>
    </GameShell>
  );
}

function iconBtn(C) {
  return {
    background: C.iconBtnBg, border: `1px solid ${C.hairline}`,
    borderRadius: "50%", width: 32, height: 32,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", fontFamily: "inherit", fontSize: 13,
    color: C.ink, fontWeight: 500, transition: "all .15s",
  };
}

function GameShell({ children, elapsed, clicks, formatTime, onExit, muted, themeColors, glass }) {
  const C = themeColors;
  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100, position: "relative", zIndex: 10 }}>
      <header style={{ padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 720, margin: "0 auto", gap: 8, position: "relative", zIndex: 60 }}>
        <button onClick={onExit} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
        {!muted && (
          <div style={{ display: "flex", gap: 8 }}>
            <Stat icon="⏱" value={formatTime(elapsed)} themeColors={C} glass={glass} />
            <Stat icon="✦" value={clicks} label="clics" themeColors={C} glass={glass} />
          </div>
        )}
      </header>
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "8px 20px", position: "relative", zIndex: 10 }}>{children}</main>
    </div>
  );
}

function Stat({ icon, value, label, valueColor, themeColors, glass }) {
  const C = themeColors;
  return (
    <div style={{ ...glass, borderRadius: 999, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6,
      fontFamily: "'Manrope', sans-serif", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: C.ink }}>
      <span style={{ fontSize: 11, opacity: .55 }}>{icon}</span>
      <span style={{ color: valueColor || C.ink }}>{value}</span>
      {label && <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.inkSoft, fontWeight: 500, marginLeft: 2 }}>{label}</span>}
    </div>
  );
}

function Goal({ label, movie, align = "left", themeColors, onRefresh }) {
  const C = themeColors;
  return (
    <div style={{ textAlign: align, maxWidth: 130, display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <Poster movie={movie} size={80} rounded={10} themeColors={C} />
        {onRefresh && (
          <button onClick={onRefresh} title={`Changer ${label.toLowerCase()}`}
            style={{ position: "absolute", top: -6, [align === "right" ? "left" : "right"]: -6,
              width: 26, height: 26, borderRadius: "50%",
              background: C.ink, color: C.bg, border: `2px solid ${C.bg}`,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit", padding: 0,
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              transition: "transform .15s" }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1) rotate(45deg)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1) rotate(0deg)"}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.15, letterSpacing: -0.4, color: C.ink, marginTop: 8 }}>{movie.title}</div>
      <div style={{ fontSize: 11, color: C.inkMute, marginTop: 2, fontWeight: 500 }}>{movie.year}</div>
      {isTv(movie) && <TvLabel themeColors={C} />}
    </div>
  );
}

function Trail({ path, themeColors, glass }) {
  const C = themeColors;
  return (
    <div style={{ ...glass, borderRadius: 18, padding: "12px 14px",
      display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "center" }}>
      {path.map((node, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: C.inkMute, fontSize: 10 }}>—</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {node.type === "movie" ? <Poster movie={node.data} size={28} rounded={5} themeColors={C} /> : <ActorPhoto actor={node.data} size={28} themeColors={C} />}
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

function ActorPicker({ title, actors, onPick, greenId, yellowIds, sort, onToggleSort, themeColors, glass }) {
  const C = themeColors;
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => {
    const copy = [...actors];
    if (sort === "ord") {
      copy.sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999));
    } else {
      copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    return copy;
  }, [actors, sort]);

  const visible = expanded ? sorted : sorted.slice(0, CAST_DISPLAY_DEFAULT);
  const hiddenCount = Math.max(0, sorted.length - CAST_DISPLAY_DEFAULT);

  return (
    <div style={{ ...glass, borderRadius: 20, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 12px", gap: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {onToggleSort && (
          <div style={{ width: 125, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onToggleSort}
              style={{ background: "none", border: "none", color: C.inkSoft, fontFamily: "inherit",
                fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: 0.7, padding: 0 }}>
              Trier · {sort === "ord" ? "Rôle" : "Popularité"}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="8 9 12 5 16 9"/>
                <polyline points="16 15 12 19 8 15"/>
              </svg>
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {visible.map(a => {
          const isGreen = greenId && a.id === greenId;
          const isYellow = !isGreen && yellowIds && yellowIds.has(a.id);
          const hColor = isGreen ? C.green : isYellow ? C.yellow : null;
          const active = isGreen || isYellow;
          return (
            <button key={a.id} onClick={() => onPick(a)}
              style={{ background: active ? hColor + "20" : C.cardBg,
                border: `1px solid ${active ? hColor : C.hairline}`,
                padding: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                fontFamily: "inherit", borderRadius: 14, transition: "all .25s",
                boxShadow: active ? `0 0 0 2px ${hColor}40, 0 0 24px ${hColor}30` : "none" }}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.transform = "translateY(-2px)"; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = C.cardBg; e.currentTarget.style.transform = "translateY(0)"; } }}>
              <ActorPhoto actor={a} size={56} highlight={active} highlightColor={hColor} themeColors={C} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.ink, textAlign: "center", lineHeight: 1.2 }}>{a.name}</span>
            </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button onClick={() => setExpanded(e => !e)}
          style={{ marginTop: 12, width: "100%", background: "transparent",
            border: `1px solid ${C.hairline}`, borderRadius: 12, padding: "10px 14px",
            fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
            color: C.inkSoft, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "background .15s" }}
          onMouseEnter={(e) => e.currentTarget.style.background = C.cardHover}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
          {expanded ? "Voir moins" : `Voir plus (+${hiddenCount} acteurs)`}
        </button>
      )}
    </div>
  );
}

function MoviePicker({ title, movies, targetWork, onPick, onClose, greenWork, yellowKeys, sort, onToggleSort, themeColors, glass }) {
  const C = themeColors;
  const sorted = useMemo(() => {
    const copy = [...movies];
    if (sort === "date") {
      copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else {
      copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    return copy;
  }, [movies, sort]);

  return (
    <div style={{ ...glass, borderRadius: 20, padding: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px 6px", gap: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ width: 105, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onToggleSort}
            style={{ background: "none", border: "none", color: C.inkSoft, fontFamily: "inherit",
              fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: 0.7, padding: 0 }}>
            Trier · {sort === "date" ? "Date" : "Popularité"}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 9 12 5 16 9"/>
              <polyline points="16 15 12 19 8 15"/>
            </svg>
          </button>
        </div>
        <button onClick={onClose} style={{ ...iconBtn(C), fontSize: 14 }}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" }}>
        {sorted.length === 0 && (
          <div style={{ padding: 24, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucune autre œuvre trouvée.</div>
        )}
        {sorted.map(m => {
          const isTarget = targetWork && m.id === targetWork.id && m.type === targetWork.type;
          const isGreen = greenWork && m.id === greenWork.id && m.type === greenWork.type;
          const isYellow = !isGreen && yellowKeys && yellowKeys.has(`${m.id}:${m.type}`);
          const hColor = isGreen ? C.green : isYellow ? C.yellow : null;
          const active = isGreen || isYellow;
          return (
            <button key={`${m.id}:${m.type}`} onClick={() => onPick(m)}
              style={{ background: active ? hColor + "20" : C.cardBg2,
                border: active ? `1px solid ${hColor}` : "none",
                padding: "8px 10px", textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit", borderRadius: 14,
                transition: "background .25s",
                boxShadow: active ? `0 0 0 2px ${hColor}40` : "none" }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.cardHover; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = C.cardBg2; }}>
              <Poster movie={m} size={42} rounded={7} highlight={active} highlightColor={hColor} themeColors={C} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.3, color: C.ink,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 11, color: C.inkMute, fontWeight: 500 }}>
                  {m.year}
                  {isTv(m) && <span style={{ marginLeft: 6, letterSpacing: 1.5, textTransform: "uppercase", fontSize: 9, fontWeight: 700, color: C.inkSoft }}>· série</span>}
                </div>
              </div>
              {isTarget && <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                color: C.bg, background: C.ink, padding: "4px 9px", borderRadius: 999, fontWeight: 600, flexShrink: 0 }}>Objectif</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// END SCREEN
// =========================================================================

function EndScreen({ path, optimal, elapsed, clicks, formatTime, playerSteps, abandoned, hintsUsed, onReplay, onRetry, onMenu, themeColors, glass, glassDark, startWork, endWork, modeUsed, difficultyUsed }) {
  const C = themeColors;
  const optimalSteps = optimal && optimal.length > 0 ? Math.max(0, Math.floor((optimal.length - 1) / 2)) : null;
  const isOptimal = !abandoned && optimalSteps !== null && playerSteps <= optimalSteps;

  let verdict, verdictColor, animType;
  if (abandoned) {
    verdict = "Abandonné"; verdictColor = C.inkSoft; animType = "abandon";
  } else if (optimalSteps === null) {
    verdict = "Bravo !"; verdictColor = C.green; animType = "ok";
  } else {
    const diff = playerSteps - optimalSteps;
    if (diff <= 0) { verdict = "Chemin optimal"; verdictColor = C.green; animType = "optimal"; }
    else if (diff === 1) { verdict = "Une étape de plus"; verdictColor = C.greenSoft; animType = "ok"; }
    else { verdict = `${diff} étapes de plus`; verdictColor = C.greenSoft; animType = "ok"; }
  }

  const difficultyCategory = categorizeDifficulty(optimalSteps);
  const difficultyLabel = difficultyCategory ? DIFFICULTIES[difficultyCategory].label : null;
  const modeLabel = modeUsed ? MODES[modeUsed]?.label : null;

  const [shareStatus, setShareStatus] = useState(null);
  function shareChallenge() {
    const sT = startWork.type === "tv" ? "t" : "m";
    const eT = endWork.type === "tv" ? "t" : "m";
    const url = `${window.location.origin}${window.location.pathname}?challenge=${startWork.id}${sT}-${endWork.id}${eT}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareStatus("copied");
      setTimeout(() => setShareStatus(null), 2500);
    });
  }

  const btnPrimary = {
    background: C.ink, color: C.bg, border: "none",
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

  return (
    <div style={{ textAlign: "center", paddingTop: 8, position: "relative", isolation: "isolate" }}>
      <style>{`
        @keyframes verdictPop {
          0%   { opacity: 0; transform: scale(0.7); }
          50%  { opacity: 1; transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes greenDescend {
          0%   { transform: translateY(-100%); opacity: 0; }
          70%  { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes greenPulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
        @keyframes barDrop {
          0%   { transform: translateY(-100%); opacity: 0; }
          70%  { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(0); opacity: 0.9; }
        }
      `}</style>

      {animType === "optimal" && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "65vh",
          background: `linear-gradient(180deg, ${C.green}cc 0%, ${C.green}66 30%, ${C.green}22 70%, transparent 100%)`,
          animation: "greenDescend 1.4s cubic-bezier(.4,0,.2,1) forwards, greenPulse 3.5s ease-in-out 1.4s infinite",
          pointerEvents: "none", zIndex: 0,
        }} />
      )}
      {animType === "ok" && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "37vh",
          background: `linear-gradient(180deg, ${C.greenSoft}cc 0%, ${C.greenSoft}55 60%, transparent 100%)`,
          animation: "barDrop 0.7s cubic-bezier(.4,0,.2,1) forwards",
          pointerEvents: "none", zIndex: 0,
        }} />
      )}
      {animType === "abandon" && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, height: "10vh",
          background: `linear-gradient(180deg, ${RED}cc 0%, ${RED}44 70%, transparent 100%)`,
          animation: "barDrop 0.6s cubic-bezier(.4,0,.2,1) forwards",
          pointerEvents: "none", zIndex: 0,
        }} />
      )}

      <div style={{ position: "relative", zIndex: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>Résultat</div>
        <div style={{ fontWeight: 800, fontSize: 36, lineHeight: 1.05, color: verdictColor, marginBottom: 8, letterSpacing: -1.4,
                      animation: isOptimal ? "verdictPop .55s cubic-bezier(.34,1.56,.64,1) both" : "none" }}>{verdict}</div>

        {(modeLabel || difficultyLabel) && (
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, marginBottom: 18, fontWeight: 600 }}>
            {modeLabel}{modeLabel && difficultyLabel ? " · " : ""}{difficultyLabel}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <Stat icon="✦" value={`${playerSteps}${optimalSteps !== null ? ` / ${optimalSteps}` : ""}`} label="étapes"
                valueColor={isOptimal ? C.green : undefined} themeColors={C} glass={glass} />
          <Stat icon="⏱" value={formatTime(elapsed)} themeColors={C} glass={glass} />
          <Stat icon="◯" value={clicks} label="clics" themeColors={C} glass={glass} />
        </div>
        {hintsUsed > 0 && (
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.inkSoft, marginBottom: 20, fontWeight: 500 }}>
            {hintsUsed} indice{hintsUsed > 1 ? "s" : ""} utilisé{hintsUsed > 1 ? "s" : ""}
          </div>
        )}
        {hintsUsed === 0 && <div style={{ marginBottom: 18 }} />}

        <div style={{ ...glass, borderRadius: 18, padding: 14, marginBottom: 10, textAlign: "left" }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.ink, marginBottom: 10, fontWeight: 700 }}>
            {abandoned ? "Ton parcours (incomplet)" : "Ton parcours"}
          </div>
          <PathStrip path={path} themeColors={C} />
        </div>

        {optimal && optimal.length > 0 && (
          <div style={{ ...glass, borderRadius: 18, padding: 14, textAlign: "left", opacity: 0.95 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 700 }}>
              Chemin optimal · {optimalSteps} étape{optimalSteps > 1 ? "s" : ""}
            </div>
            <OptimalPathStrip path={optimal} themeColors={C} />
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={onMenu} style={btnSecondary}>Menu</button>
          {onRetry && <button onClick={onRetry} style={btnSecondary}>Réessayer</button>}
          <button onClick={shareChallenge}
            style={{ ...btnSecondary, color: shareStatus === "copied" ? C.green : C.ink }}>
            {shareStatus === "copied" ? "Lien copié !" : "Partager"}
          </button>
          <button onClick={onReplay} style={btnPrimary}>Nouvelle partie</button>
        </div>
      </div>
    </div>
  );
}

function PathStrip({ path, themeColors }) {
  const C = themeColors;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {path.map((node, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: C.inkMute, fontSize: 10 }}>—</span>}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            {node.type === "movie" ? <Poster movie={node.data} size={42} rounded={7} themeColors={C} /> : <ActorPhoto actor={node.data} size={42} themeColors={C} />}
            <span style={{ fontWeight: node.type === "movie" ? 700 : 500, fontSize: 10,
              color: node.type === "movie" ? C.ink : C.inkSoft,
              maxWidth: 70, textAlign: "center", lineHeight: 1.2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {node.type === "movie" ? (node.data.title || "…") : node.data.name.split(" ")[0]}
            </span>
            {node.type === "movie" && isTv(node.data) && <TvLabel size="tiny" themeColors={C} />}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function OptimalPathStrip({ path, themeColors }) {
  const C = themeColors;
  const [hydrated, setHydrated] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const workPairs = path.filter(n => n.type === "movie").map(n => n.data);
    if (workPairs.length === 0) { setHydrated([]); return; }
    const ids = [...new Set(workPairs.map(w => w.id))];
    supabase.from("works").select("id, type, title, year, poster_path").in("id", ids).then(({ data }) => {
      if (cancelled || !data) return;
      const map = new Map(data.map(w => [`${w.id}:${w.type}`, w]));
      setHydrated(path.map(n => {
        if (n.type !== "movie") return n;
        const w = map.get(`${n.data.id}:${n.data.type}`);
        return { type: "movie", data: w || { id: n.data.id, type: n.data.type, title: "…" } };
      }));
    });
    return () => { cancelled = true; };
  }, [path]);
  if (!hydrated) return <div style={{ padding: 8, fontSize: 12, color: C.inkSoft }}>Chargement…</div>;
  return <PathStrip path={hydrated} themeColors={C} />;
}

// =========================================================================
// CUSTOM SCREEN
// =========================================================================

function CustomScreen({ onBack, onStart, themeColors, glass, glassDark }) {
  const C = themeColors;
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
    if (start.id === end.id && start.type === end.type) return;
    onStart(start, end);
  }

  const btnPrimary = {
    background: C.ink, color: C.bg, border: "none",
    borderRadius: 999, padding: "11px 22px",
    fontSize: 12, letterSpacing: 1.3, textTransform: "uppercase",
    cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
    boxShadow: "0 4px 14px rgba(15,23,41,0.18)",
  };

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Sur Mesure</div>
        <h2 style={{ fontWeight: 800, fontSize: 36, margin: 0, letterSpacing: -1.5, lineHeight: 1, color: C.ink }}>Compose ton défi</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <Slot label="Œuvre de départ" movie={start} active={pickingFor === "start"}
          onClick={() => setPickingFor("start")} onClear={() => setStart(null)} themeColors={C} glass={glass} />
        <div style={{ textAlign: "center", color: C.inkMute, fontSize: 18 }}>↓</div>
        <Slot label="Œuvre d'arrivée" movie={end} active={pickingFor === "end"}
          onClick={() => setPickingFor("end")} onClear={() => setEnd(null)} themeColors={C} glass={glass} />
      </div>
      <div style={{ ...glass, borderRadius: 16, padding: 6, marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={`Rechercher pour ${pickingFor === "start" ? "le départ" : "l'arrivée"}…`}
          style={{ width: "100%", background: "transparent", border: "none", outline: "none",
            padding: "10px 12px", fontSize: 14, fontFamily: "inherit", color: C.ink, fontWeight: 500 }} />
      </div>
      {search.length >= 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 320, overflowY: "auto", ...glass, borderRadius: 16, padding: 6 }}>
          {searching && <Spinner label="Recherche" themeColors={C} />}
          {!searching && results.length === 0 && (
            <div style={{ padding: 24, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucun résultat.</div>
          )}
          {!searching && results.map(m => {
            const sel = pickingFor === "start" ? start : end;
            const isSelected = sel && m.id === sel.id && m.type === sel.type;
            return (
              <button key={`${m.id}:${m.type}`} onClick={() => {
                if (pickingFor === "start") { setStart(m); setPickingFor("end"); }
                else { setEnd(m); }
                setSearch("");
              }}
                style={{ background: isSelected ? C.ink : C.cardBg2,
                  color: isSelected ? C.bg : C.ink, border: "none",
                  padding: "8px 10px", textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit", borderRadius: 12 }}>
                <Poster movie={m} size={36} rounded={6} themeColors={C} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.3,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                  <div style={{ fontSize: 11, opacity: .6, fontWeight: 500 }}>
                    {m.year}
                    {isTv(m) && <span style={{ marginLeft: 6, letterSpacing: 1.5, textTransform: "uppercase", fontSize: 9, fontWeight: 700 }}>· série</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <button onClick={tryStart} disabled={!start || !end}
        style={{ ...btnPrimary, marginTop: 20, width: "100%",
          opacity: (!start || !end) ? 0.3 : 1, cursor: (!start || !end) ? "not-allowed" : "pointer" }}>
        Lancer le défi
      </button>
    </div>
  );
}

function Slot({ label, movie, active, onClick, onClear, themeColors, glass }) {
  const C = themeColors;
  return (
    <div onClick={onClick} style={{ ...glass, borderRadius: 18, padding: "12px 14px",
      border: active ? `1.5px solid ${C.ink}` : `1px solid ${C.hairline}`,
      cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
      {movie ? <Poster movie={movie} size={50} rounded={8} themeColors={C} /> :
        <div style={{ width: 50, height: 75, borderRadius: 8, background: C.cardBg,
          border: `1px dashed ${C.hairline}`, flexShrink: 0 }} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
          color: active ? C.ink : C.inkMute, marginBottom: 4, fontWeight: 600 }}>{label}</div>
        {movie ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.5, color: C.ink, lineHeight: 1.15 }}>{movie.title}</div>
            <div style={{ fontSize: 11, color: C.inkMute, fontWeight: 500, marginTop: 2 }}>
              {movie.year}
              {isTv(movie) && <span style={{ marginLeft: 6, letterSpacing: 1.5, textTransform: "uppercase", fontSize: 9, fontWeight: 700 }}>· série</span>}
            </div>
          </div>
        ) : (
          <div style={{ fontWeight: 500, fontSize: 15, color: C.inkMute }}>À choisir…</div>
        )}
      </div>
      {movie && <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={iconBtn(C)}>✕</button>}
    </div>
  );
}

function MultiScreen({ onBack, themeColors, glass }) {
  const C = themeColors;
  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 20px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 48 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>
      <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, opacity: .25 }}><LogoMark size={40} color={C.ink} /></div>
        <div style={{ fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: -1, color: C.ink }}>Bientôt disponible</div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, fontWeight: 500 }}>
          Le mode Versus arrive bientôt :<br />duels en temps réel, défis partagés, classements entre amis.
        </div>
      </div>
    </div>
  );
}

function AccountScreen({ onBack, themeColors, glass, gamesPlayed }) {
  const C = themeColors;
  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 20px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 48 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>
      <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16, opacity: .25 }}><LogoMark size={40} color={C.ink} /></div>
        <div style={{ fontWeight: 800, fontSize: 28, marginBottom: 8, letterSpacing: -1, color: C.ink }}>Compte</div>
        <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5, fontWeight: 500 }}>Profil, stats, historique.</div>
        <div style={{ marginTop: 32, padding: "20px 0", borderTop: `1px solid ${C.hairline}` }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 8, fontWeight: 600 }}>Stats locales</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: C.ink, letterSpacing: -1 }}>{gamesPlayed}</div>
          <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 500 }}>{gamesPlayed > 1 ? "parties jouées" : "partie jouée"}</div>
        </div>
      </div>
    </div>
  );
}