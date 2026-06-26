import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";

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
  filterMode: "include",
  includeGenres: [28, 12, 35, 80, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37],
  excludeGenres: [],
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
const LS_PLAYER_TOKEN  = "fil-player-token"; // Identifiant unique du joueur (anonyme, persistant)
const LS_PLAYER_NAME   = "fil-player-name";  // Pseudo réutilisé entre les parties Versus
const LS_BEST_STEPS     = "fil-best-steps";   // Meilleur score solo (min étapes)
const LS_VERSUS_WINS    = "fil-versus-wins";
const LS_VERSUS_LOSSES  = "fil-versus-losses";
const LS_SOLO_EASY      = "fil-solo-easy";
const LS_SOLO_MEDIUM    = "fil-solo-medium";
const LS_SOLO_HARD      = "fil-solo-hard";
const LS_SOLO_OPTIMAL   = "fil-solo-optimal";
const LS_VERSUS_OPTIMAL = "fil-versus-optimal";
const LS_SOLO_ABANDONS  = "fil-solo-abandons";
const LS_SOLO_HINTS     = "fil-solo-hints";
const LS_VERSUS_HINTS   = "fil-versus-hints";

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
function loadBestSteps()    { try { return parseInt(localStorage.getItem(LS_BEST_STEPS) || "0", 10); } catch { return 0; } }
function saveBestSteps(s)   { try { const c = loadBestSteps(); if (!c || s < c) localStorage.setItem(LS_BEST_STEPS, String(s)); } catch {} }
function loadVersusWins()   { try { return parseInt(localStorage.getItem(LS_VERSUS_WINS)   || "0", 10); } catch { return 0; } }
function loadVersusLosses() { try { return parseInt(localStorage.getItem(LS_VERSUS_LOSSES) || "0", 10); } catch { return 0; } }
function incrementVersusWins()   { try { const c = loadVersusWins()   + 1; localStorage.setItem(LS_VERSUS_WINS,   String(c)); } catch {} }
function incrementVersusLosses() { try { const c = loadVersusLosses() + 1; localStorage.setItem(LS_VERSUS_LOSSES, String(c)); } catch {} }
function loadSoloDiff(d)  { try { const k = d === "easy" ? LS_SOLO_EASY : d === "medium" ? LS_SOLO_MEDIUM : LS_SOLO_HARD; return parseInt(localStorage.getItem(k) || "0", 10); } catch { return 0; } }
function incSoloDiff(d)   { try { const k = d === "easy" ? LS_SOLO_EASY : d === "medium" ? LS_SOLO_MEDIUM : LS_SOLO_HARD; localStorage.setItem(k, String(parseInt(localStorage.getItem(k) || "0", 10) + 1)); } catch {} }
function loadSoloOptimal()    { try { return parseInt(localStorage.getItem(LS_SOLO_OPTIMAL)   || "0", 10); } catch { return 0; } }
function loadVersusOptimal()  { try { return parseInt(localStorage.getItem(LS_VERSUS_OPTIMAL) || "0", 10); } catch { return 0; } }
function incSoloOptimal()     { try { localStorage.setItem(LS_SOLO_OPTIMAL,   String(loadSoloOptimal()   + 1)); } catch {} }
function incVersusOptimal()   { try { localStorage.setItem(LS_VERSUS_OPTIMAL, String(loadVersusOptimal() + 1)); } catch {} }
function loadSoloAbandons()   { try { return parseInt(localStorage.getItem(LS_SOLO_ABANDONS) || "0", 10); } catch { return 0; } }
function incSoloAbandons()    { try { localStorage.setItem(LS_SOLO_ABANDONS, String(loadSoloAbandons() + 1)); } catch {} }
function loadSoloHints()      { try { return parseInt(localStorage.getItem(LS_SOLO_HINTS)    || "0", 10); } catch { return 0; } }
function loadVersusHints()    { try { return parseInt(localStorage.getItem(LS_VERSUS_HINTS)  || "0", 10); } catch { return 0; } }
function addSoloHints(n)      { try { localStorage.setItem(LS_SOLO_HINTS,    String(loadSoloHints()    + (n || 0))); } catch {} }
function addVersusHints(n)    { try { localStorage.setItem(LS_VERSUS_HINTS,  String(loadVersusHints()  + (n || 0))); } catch {} }

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

// === VERSUS : identité anonyme du joueur ===
function getPlayerToken() {
  try {
    let t = localStorage.getItem(LS_PLAYER_TOKEN);
    if (!t) {
      // Génère 32 bytes random en hex (64 chars)
      const arr = new Uint8Array(32);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      t = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(LS_PLAYER_TOKEN, t);
    }
    return t;
  } catch { return "anon-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
}
function getStoredPlayerName() {
  try { return localStorage.getItem(LS_PLAYER_NAME) || ""; }
  catch { return ""; }
}
function savePlayerName(name) {
  try { localStorage.setItem(LS_PLAYER_NAME, name); } catch {}
}

// === VERSUS : code de partie (6 chiffres) ===
function generateMatchCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += Math.floor(Math.random() * 10);
  return code;
}
function formatMatchCode(code) {
  // "482715" → "482 715"
  if (!code || code.length !== 6) return code || "";
  return code.slice(0, 3) + " " + code.slice(3);
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

// === VERSUS : URL ?versus=XXXXXX ===
function getVersusFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("versus");
    if (!v || !/^\d{6}$/.test(v)) return null;
    return v;
  } catch { return null; }
}
function setVersusInURL(code) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("versus", code);
    window.history.replaceState({}, "", url);
  } catch {}
}
function clearVersusFromURL() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("versus");
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
      const actors = (grouped.get(key) || []).slice(0, CAST_LIMIT);
      if (actors.length > 0) setCachedCast(p.id, p.type, actors);
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
      const films = (grouped.get(id) || []).filter(Boolean).slice(0, ACTOR_FILMO_LIMIT);
      if (films.length > 0) setCachedFilmo(id, films);
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
// API VERSUS
// =========================================================================

async function createMatch({ startWork, endWork, optimalSteps, difficulty, victoryCondition = "hybrid", customMode = false }) {
  // Génère un code unique (retry si collision, très rare avec 10^6 possibilités)
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = generateMatchCode();
    const { data } = await supabase.from("matches").select("id").eq("code", candidate).maybeSingle();
    if (!data) { code = candidate; break; }
  }
  if (!code) throw new Error("Impossible de générer un code unique, réessaie.");

  const { data, error } = await supabase
    .from("matches")
    .insert({
      code,
      start_id: startWork.id, start_type: startWork.type,
      end_id: endWork.id,     end_type: endWork.type,
      optimal_steps: optimalSteps,
      difficulty,
      victory_condition: victoryCondition,
      custom_mode: customMode,
      status: "waiting",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMatchByCode(code) {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getMatchPlayers(matchId) {
  const { data, error } = await supabase
    .from("match_players")
    .select("*")
    .eq("match_id", matchId)
    .order("slot", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function joinMatch(matchId, playerName, slot, userId = null) {
  const token = getPlayerToken();

  // Si ce token a déjà rejoint ce match (refresh page), on retourne le joueur existant
  const { data: existing } = await supabase
    .from("match_players")
    .select("*")
    .eq("match_id", matchId)
    .eq("player_token", token)
    .maybeSingle();
  if (existing) return existing;

  const row = { match_id: matchId, slot, player_name: playerName, player_token: token };
  if (userId) row.user_id = userId;

  const { data, error } = await supabase
    .from("match_players")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Claim atomique : ne démarre que si le match est encore "waiting" (évite un double-start
// si les 2 clients détectent la condition de lancement au même moment).
async function startMatch(matchId, victoryCondition = "hybrid", customStart = null, customEnd = null) {
  const update = { status: "playing", started_at: new Date().toISOString(), victory_condition: victoryCondition, pending_change: null };
  if (customStart) { update.start_id = customStart.id; update.start_type = customStart.type; }
  if (customEnd) { update.end_id = customEnd.id; update.end_type = customEnd.type; }
  const { data, error } = await supabase
    .from("matches")
    .update(update)
    .eq("id", matchId)
    .eq("status", "waiting")
    .select();
  if (error) throw error;
  return (data && data[0]) || null;
}

// Récupère une œuvre quelconque pour servir de placeholder start/end tant que les joueurs
// n'ont pas encore choisi leurs films en mode sur-mesure, ou tant qu'aucun défi n'a été tiré
// en mode standard ("salon vierge").
async function getPlaceholderWork() {
  const { data, error } = await supabase.from("works").select("id, type").limit(1).single();
  if (error) throw error;
  return data;
}

// Remet le défi d'un match à l'état "vierge" (placeholder start===end, pending_change vidé).
// customModeOverride optionnel : si fourni, bascule aussi le type de partie (Standard/Sur-mesure).
async function resetMatchDefi(matchId, customModeOverride) {
  const placeholder = await getPlaceholderWork();
  const update = {
    start_id: placeholder.id, start_type: placeholder.type,
    end_id: placeholder.id, end_type: placeholder.type,
    optimal_steps: 0,
    pending_change: null,
  };
  if (customModeOverride !== undefined) update.custom_mode = customModeOverride;
  const { error } = await supabase.from("matches").update(update).eq("id", matchId);
  if (error) throw error;
}

async function setMatchVictoryCondition(matchId, victoryCondition) {
  const { error } = await supabase.from("matches").update({ victory_condition: victoryCondition }).eq("id", matchId);
  if (error) throw error;
}

async function updatePlayerName(matchPlayerId, name) {
  const { error } = await supabase.from("match_players").update({ player_name: name }).eq("id", matchPlayerId);
  if (error) throw error;
}

// Mode personnalisé : enregistre le choix de film d'un joueur (départ ou arrivée selon son rôle tiré au hasard)
// en fusionnant avec le pending_change courant pour ne pas écraser le choix de l'autre joueur.
async function saveCustomPick(matchId, currentPendingChange, role, film) {
  const updated = { ...(currentPendingChange || {}), [role]: { id: film.id, type: film.type } };
  const { error } = await supabase.from("matches")
    .update({ pending_change: updated })
    .eq("id", matchId);
  if (error) throw error;
}

async function clearCustomPick(matchId, currentPendingChange, role) {
  const updated = { ...(currentPendingChange || {}) };
  delete updated[role];
  delete updated.readySlots; // reset les "OK pour moi" puisque le choix a changé
  const { error } = await supabase.from("matches")
    .update({ pending_change: updated })
    .eq("id", matchId);
  if (error) throw error;
}

async function updatePlayerProgress(matchPlayerId, { currentPath, currentSteps, hintsUsed }) {
  const update = {};
  if (currentPath !== undefined) update.current_path = currentPath;
  if (currentSteps !== undefined) update.current_steps = currentSteps;
  if (hintsUsed !== undefined) update.hints_used = hintsUsed;
  if (Object.keys(update).length === 0) return;
  await supabase.from("match_players").update(update).eq("id", matchPlayerId);
}

async function finishPlayer(matchPlayerId, { finalSteps, finalTimeMs, abandoned, hintsUsed }) {
  await supabase
    .from("match_players")
    .update({
      finished: true,
      abandoned: !!abandoned,
      final_steps: finalSteps,
      final_time_ms: finalTimeMs,
      hints_used: hintsUsed,
      finished_at: new Date().toISOString(),
    })
    .eq("id", matchPlayerId);
}

// Mode revanche : reset des champs de progression de tous les joueurs d'un match pour une nouvelle manche.
async function resetMatchPlayersForNewRound(matchId) {
  const { error } = await supabase
    .from("match_players")
    .update({
      current_path: null, current_steps: 0,
      finished: false, abandoned: false,
      final_steps: null, final_time_ms: null,
      hints_used: 0, finished_at: null,
    })
    .eq("match_id", matchId);
  if (error) throw error;
}

// Marque la manche comme terminée côté salon (sans ça, le statut reste "playing" pour toujours
// et la revanche ne peut jamais réclamer le reset, qui exige status="finished").
async function finishMatch(matchId) {
  const { error } = await supabase
    .from("matches")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("status", "playing");
  if (error) throw error;
}

// Génère un nouveau défi (ou une partie) en fonction du target :
// - "start" : nouveau départ, garde l'arrivée actuelle
// - "end"   : nouvelle arrivée, garde le départ actuel
// - "both"  : nouveau couple complet
async function generateNewDefi({ currentStart, currentEnd, target, versusPrefs }) {
  const isRandomMode = versusPrefs.difficulty === "random";
  let targetDiff = versusPrefs.difficulty;
  if (isRandomMode) targetDiff = pickWeightedDifficulty();
  const targetRange = DIFFICULTIES[targetDiff]?.range;
  const forHard = targetDiff === "hard";

  let chosen = null;
  let lastAttempt = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    let start, end;
    if (target === "both") {
      const pair = await pickRandomPair(versusPrefs, forHard);
      start = pair.start; end = pair.end;
    } else if (target === "start") {
      start = await pickPartnerFor(currentEnd, versusPrefs, forHard);
      end = currentEnd;
    } else { // "end"
      start = currentStart;
      end = await pickPartnerFor(currentStart, versusPrefs, forHard);
    }
    // Évite de retomber sur les mêmes films
    if (target === "start" && start.id === currentStart.id && start.type === currentStart.type) continue;
    if (target === "end" && end.id === currentEnd.id && end.type === currentEnd.type) continue;

    const optimal = await findOptimalPath(start, end, 5);
    if (!optimal || optimal.length < 3) continue;
    const steps = Math.floor((optimal.length - 1) / 2);
    lastAttempt = { start, end, steps };
    if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
      chosen = lastAttempt; break;
    }
  }
  if (!chosen) chosen = lastAttempt;
  if (!chosen) throw new Error("Aucun défi trouvé.");
  return { start: chosen.start, end: chosen.end, optimalSteps: chosen.steps, difficulty: targetDiff };
}

// Applique directement un nouveau défi (départ/arrivée/les deux) — n'importe quel joueur peut
// le faire à tout moment, ça remet les 2 "OK pour moi" à zéro (pending_change vidé).
async function applyNewDefi(matchId, { start, end, optimalSteps, difficulty }) {
  const { error } = await supabase
    .from("matches")
    .update({
      start_id: start.id, start_type: start.type,
      end_id: end.id, end_type: end.type,
      optimal_steps: optimalSteps,
      difficulty,
      pending_change: null,
    })
    .eq("id", matchId);
  if (error) throw error;
}

// Bascule mon "OK pour moi" sur le défi en cours (mode standard) — togglable librement.
async function setReadySlot(matchId, currentPendingChange, mySlot, ready) {
  const base = currentPendingChange || {};
  const current = base.readySlots || [];
  const next = ready ? Array.from(new Set([...current, mySlot])) : current.filter(s => s !== mySlot);
  const { error } = await supabase
    .from("matches")
    .update({ pending_change: { ...base, readySlots: next } })
    .eq("id", matchId);
  if (error) throw error;
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
    versusMe: "#2563eb", versusOpponent: "#db2777",
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
    versusMe: "#60a5fa", versusOpponent: "#f472b6",
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
// COMPOSANTS UTILITAIRES (animations)
// =========================================================================

// Trois points qui clignotent successivement, à utiliser après les textes "En attente", "Chargement", etc.
function AnimatedDots({ color = "currentColor" }) {
  return (
    <span style={{ display: "inline-flex", marginLeft: 2 }}>
      <style>{`
        @keyframes fil-dot-blink {
          0%, 80%, 100% { opacity: 0.15; }
          40% { opacity: 1; }
        }
        .fil-dot {
          animation: fil-dot-blink 1.4s ease-in-out infinite both;
          display: inline-block;
          line-height: 1;
        }
      `}</style>
      <span className="fil-dot" style={{ color }}>.</span>
      <span className="fil-dot" style={{ color, animationDelay: "0.2s" }}>.</span>
      <span className="fil-dot" style={{ color, animationDelay: "0.4s" }}>.</span>
    </span>
  );
}

// Cercle qui pulse doucement (état "en attente"), passe en plein quand actif
function WaitingDot({ active, activeColor, idleColor, size = 10 }) {
  return (
    <span style={{ display: "inline-block", position: "relative", width: size, height: size, flexShrink: 0 }}>
      <style>{`
        @keyframes fil-dot-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.85); }
          50%      { opacity: 0.75; transform: scale(1.05); }
        }
      `}</style>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: active ? activeColor : idleColor,
        animation: active ? "none" : "fil-dot-pulse 1.6s ease-in-out infinite both",
      }} />
    </span>
  );
}

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
    : position === "left2"
    ? { left: "max(62px, calc(50% - 240px + 62px))" }
    : position === "center"
    ? { left: "calc(50% - 19px)" }
    : position === "right2"
    ? { right: "max(62px, calc(50% - 240px + 62px))" }
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

function EyeIcon({ visible, color, size = 18 }) {
  return visible ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
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

// =========================================================================
// ELO + RANGS
// =========================================================================

const VERSUS_RANKS = [
  { name: "Figurant I",        min: 0,    nextMin: 317  },
  { name: "Figurant II",       min: 317,  nextMin: 633  },
  { name: "Figurant III",      min: 633,  nextMin: 950  },
  { name: "Second Rôle I",    min: 950,  nextMin: 1017 },
  { name: "Second Rôle II",   min: 1017, nextMin: 1083 },
  { name: "Second Rôle III",  min: 1083, nextMin: 1150 },
  { name: "Premier Rôle I",   min: 1150, nextMin: 1234 },
  { name: "Premier Rôle II",  min: 1234, nextMin: 1317 },
  { name: "Premier Rôle III", min: 1317, nextMin: 1400 },
  { name: "Vedette I",         min: 1400, nextMin: 1500 },
  { name: "Vedette II",        min: 1500, nextMin: 1600 },
  { name: "Vedette III",       min: 1600, nextMin: 1700 },
  { name: "Légende I",         min: 1700, nextMin: 2000 },
  { name: "Légende II",        min: 2000, nextMin: 2300 },
  { name: "Légende III",       min: 2300, nextMin: null  },
];

const SOLO_RANKS = [
  { name: "Figurant I",        min: 800,  nextMin: 867  },
  { name: "Figurant II",       min: 867,  nextMin: 934  },
  { name: "Figurant III",      min: 934,  nextMin: 1000 },
  { name: "Second Rôle I",    min: 1000, nextMin: 1117 },
  { name: "Second Rôle II",   min: 1117, nextMin: 1234 },
  { name: "Second Rôle III",  min: 1234, nextMin: 1350 },
  { name: "Premier Rôle I",   min: 1350, nextMin: 1500 },
  { name: "Premier Rôle II",  min: 1500, nextMin: 1650 },
  { name: "Premier Rôle III", min: 1650, nextMin: 1800 },
  { name: "Vedette I",         min: 1800, nextMin: 2000 },
  { name: "Vedette II",        min: 2000, nextMin: 2200 },
  { name: "Vedette III",       min: 2200, nextMin: 2400 },
  { name: "Légende I",         min: 2400, nextMin: 2800 },
  { name: "Légende II",        min: 2800, nextMin: 3200 },
  { name: "Légende III",       min: 3200, nextMin: null  },
];

function getRankInfo(score, ranks) {
  let rank = ranks[0];
  for (const r of ranks) { if (score >= r.min) rank = r; else break; }
  const progress = rank.nextMin
    ? Math.min(1, (score - rank.min) / (rank.nextMin - rank.min))
    : 1;
  return { ...rank, progress };
}

function computeVersusEloGain(myElo, oppElo, result) {
  const E = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  return Math.round(32 * (result - E));
}

function computeSoloScoreDelta(difficulty, isOptimal, abandoned) {
  if (abandoned) return difficulty === "easy" ? -3 : -5;
  const table = { easy: [5, 12], medium: [10, 22], hard: [15, 35] };
  const [base, opt] = table[difficulty] || [5, 12];
  return isOptimal ? opt : base;
}

async function updateSoloScore(userId, delta) {
  if (!userId || delta === 0) return;
  const { data } = await supabase.from("profiles").select("solo_score").eq("id", userId).single();
  const next = Math.max(800, (data?.solo_score ?? 800) + delta);
  await supabase.from("profiles").update({ solo_score: next }).eq("id", userId);
}

// Lit les stats depuis localStorage et les pousse vers profiles (appelé après chaque partie)
async function pushStatsToProfile(userId) {
  if (!userId) return;
  await supabase.from("profiles").update({
    solo_games:     loadSoloDiff("easy") + loadSoloDiff("medium") + loadSoloDiff("hard") + loadSoloAbandons(),
    solo_easy:      loadSoloDiff("easy"),
    solo_medium:    loadSoloDiff("medium"),
    solo_hard:      loadSoloDiff("hard"),
    solo_optimal:   loadSoloOptimal(),
    solo_abandons:  loadSoloAbandons(),
    solo_hints:     loadSoloHints(),
    best_score:     loadBestSteps(),
    versus_wins:    loadVersusWins(),
    versus_losses:  loadVersusLosses(),
    versus_optimal: loadVersusOptimal(),
    versus_hints:   loadVersusHints(),
  }).eq("id", userId);
}

// Crée la ligne profiles si elle n'existe pas encore, puis la retourne
async function syncProfile(user) {
  await supabase.from("profiles").upsert(
    { id: user.id },
    { onConflict: "id", ignoreDuplicates: true }
  );
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data || null;
}

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
  const [showRankPopup, setShowRankPopup] = useState(false);
  const [versusCode, setVersusCode] = useState(null); // Code de partie Versus en cours
  const [versusContext, setVersusContext] = useState(null); // Contexte du jeu Versus { matchId, code, myPlayerId, mySlot, myName, opponentName, opponentPlayerId, victoryCondition }
  const [versusPrefs, setVersusPrefs] = useState(() => ({ ...DEFAULT_PREFS })); // Prefs Versus indépendantes des prefs globales, partagées avec le Lobby (Mode/Difficulté/filtres avancés uniquement, le reste vit en DB)
  // Série de victoires consécutives en cours, en mémoire (pas de DB) — reset si on quitte le Versus
  const [versusStreak, setVersusStreak] = useState({ winner: null, count: 0 });
  const [authUser, setAuthUser] = useState(null);   // Utilisateur Supabase connecté (ou null)
  const [profile, setProfile] = useState(null);     // Ligne profiles correspondante

  async function refreshProfile() {
    if (!authUser) return;
    const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
    setProfile(data || null);
  }

  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setAuthUser(u);
      if (u) syncProfile(u).then(p => {
        setProfile(p);
        if (p?.filter_preset) setPrefs({ ...DEFAULT_PREFS, ...p.filter_preset });
        // Naviguer vers "compte" uniquement si on venait de l'écran auth (login explicite)
        // SIGNED_IN se déclenche aussi au refresh de token → ne pas rediriger dans ce cas
        if (_event === "SIGNED_IN" && screenRef.current === "auth") setScreen("account");
      });
      else setProfile(null);
      if (_event === "PASSWORD_RECOVERY") setScreen("password-reset");
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { savePrefs(prefs); }, [prefs]);
  useEffect(() => {
    if (!authUser) return;
    const t = setTimeout(() => {
      supabase.from("profiles").update({ filter_preset: prefs }).eq("id", authUser.id).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [prefs, authUser]);
  useEffect(() => { document.body.style.background = C.bg; saveTheme(theme); }, [theme, C.bg]);

  useEffect(() => {
    if (!loadInfoSeen()) {
      setShowInfo(true);
      markInfoSeen();
    }
  }, []);

  useEffect(() => {
    // Détection des paramètres URL au mount (priorité versus > challenge)
    const v = getVersusFromURL();
    if (v) {
      setVersusCode(v);
      setScreen("versus-join");
      return;
    }
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

    const MAX_TRIES = forHard ? 25 : 10;
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

    const MAX_TRIES = forHard ? 25 : 10;
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

  // Prépare et lance le jeu Versus : fetch works + BFS + setup versusContext
  async function prepareAndStartVersusGame(match) {
    setLoadingChallenge(true);
    setLoadingLabel("Préparation du défi…");
    setError(null);
    try {
      const works = await getWorksByPairs([
        { id: match.start_id, type: match.start_type },
        { id: match.end_id,   type: match.end_type   },
      ]);
      const start = works[0];
      const end   = works[1];
      if (!start || !end) throw new Error("Œuvres introuvables.");

      const players = await getMatchPlayers(match.id);
      const myToken = getPlayerToken();
      const me = players.find(p => p.player_token === myToken);
      const opp = players.find(p => p.player_token !== myToken);
      if (!me) throw new Error("Tu n'es pas dans cette partie.");

      const optimal = await findOptimalPath(start, end, 5);

      setChallenge({
        start, end, optimal,
        optimalLoading: false,
        modeUsed: "versus",
        difficultyUsed: match.difficulty,
      });
      setVersusContext({
        matchId: match.id,
        code: match.code,
        myPlayerId: me.id,
        mySlot: me.slot,
        myName: me.player_name,
        opponentName: opp?.player_name || "Adversaire",
        opponentPlayerId: opp?.id || null,
        victoryCondition: match.victory_condition || "hybrid",
      });
      setGameKey(k => k + 1);
      setScreen("game");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoadingChallenge(false);
    }
  }

  // Crée un salon Versus vierge (pas de défi choisi) et y entre direct en tant que créateur (slot 1).
  // Le pseudo, le type de partie, le mode/difficulté et la condition de victoire se règlent ensuite dans le lobby.
  async function handleCreateVersusRoom() {
    setLoadingChallenge(true);
    setLoadingLabel("Création du salon…");
    setError(null);
    try {
      setVersusPrefs({ ...prefs });
      const placeholder = await getPlaceholderWork();
      const match = await createMatch({
        startWork: placeholder, endWork: placeholder,
        optimalSteps: 0, difficulty: "easy",
        victoryCondition: "time", customMode: true,
      });
      const name = getStoredPlayerName() || "Joueur";
      await joinMatch(match.id, name, 1, authUser?.id ?? null);
      setVersusCode(match.code);
      setVersusInURL(match.code);
      setScreen("versus-lobby");
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de la création du salon.");
    } finally {
      setLoadingChallenge(false);
    }
  }

  function exitVersus() {
    clearVersusFromURL();
    setVersusCode(null);
    setVersusContext(null);
    setChallenge(null);
    setVersusStreak({ winner: null, count: 0 });
    setScreen("menu");
  }

  // Met à jour la série de victoires en cours (mémoire locale, pas de DB) à la fin d'une manche.
  // result : "me" | "opponent" | null (égalité / double abandon → on casse la série)
  function handleVersusRoundResult(result) {
    setVersusStreak(s => {
      if (!result) return { winner: null, count: 0 };
      if (s.winner === result) return { winner: result, count: s.count + 1 };
      return { winner: result, count: 1 };
    });
  }

  // Lance une revanche : reset en place du même match (même code, même salon), écran vierge
  // (pas de défi pré-choisi, à charge des 2 joueurs de décider). Revanche bilatérale :
  // n'importe quel joueur peut cliquer "Revanche". Premier qui clique gagne (atomic claim
  // sur status), l'autre rejoint juste le même salon.
  async function requestRematch(previousMatch) {
    setLoadingChallenge(true);
    setLoadingLabel("Préparation de la revanche…");
    setError(null);
    try {
      // 1. Vérifie l'état actuel : peut-être que l'autre a déjà reset le salon
      const { data: refreshed } = await supabase
        .from("matches").select("status").eq("id", previousMatch.id).maybeSingle();
      if (refreshed?.status === "waiting") {
        setVersusContext(null);
        setChallenge(null);
        setScreen("versus-lobby");
        return;
      }

      const placeholder = await getPlaceholderWork();

      // 2. Réclame le reset de façon atomique (premier arrivé gagne)
      const { data: claimed } = await supabase
        .from("matches")
        .update({
          start_id: placeholder.id, start_type: placeholder.type,
          end_id: placeholder.id, end_type: placeholder.type,
          optimal_steps: 0,
          pending_change: null, status: "waiting", started_at: null, finished_at: null,
        })
        .eq("id", previousMatch.id)
        .eq("status", "finished")
        .select();

      if (claimed && claimed.length > 0) {
        await resetMatchPlayersForNewRound(previousMatch.id);
      }
      // Que la claim ait réussi ou non, le salon est maintenant en "waiting" → on y retourne.
      setVersusContext(null);
      setChallenge(null);
      setScreen("versus-lobby");
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoadingChallenge(false);
    }
  }

  const showTopButtons = screen !== "game";

  return (
    <Background themeColors={C}>
      <Fonts />
      {showTopButtons && (
        <>
          <TopRoundButton position="left" onClick={() => setShowInfo(true)} title="Comment jouer" themeColors={C}>
            <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>?</span>
          </TopRoundButton>
          <TopRoundButton position="left2" onClick={toggleTheme} title={theme === "light" ? "Mode sombre" : "Mode clair"} themeColors={C}>
            <ThemeIcon isLight={theme === "light"} color={C.ink} />
          </TopRoundButton>
          <TopRoundButton position="right2" onClick={() => setShowRankPopup(v => !v)} title="Mon rang" themeColors={C}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={C.ink} stroke="none">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </TopRoundButton>
          <TopRoundButton position="right" onClick={() => setScreen("account")} title="Compte" themeColors={C}>
            <AccountIcon color={C.ink} />
          </TopRoundButton>
        </>
      )}
      {showRankPopup && (() => {
        const sr = profile ? getRankInfo(profile.solo_score ?? 800, SOLO_RANKS) : null;
        const vr = profile ? getRankInfo(profile.versus_elo ?? 0, VERSUS_RANKS) : null;
        return (
          <div onClick={() => setShowRankPopup(false)}
            style={{ position: "fixed", inset: 0, zIndex: 90 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ position: "fixed", top: 62, right: "max(16px, calc(50% - 240px + 62px))",
                ...glass, borderRadius: 16, padding: "14px 18px", minWidth: 190, zIndex: 91,
                boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
              {profile ? (
                <>
                  {sr && (
                    <div style={{ marginBottom: vr ? 14 : 0 }}>
                      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: C.inkMute, fontWeight: 600, marginBottom: 4 }}>Solo</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 5, letterSpacing: -0.3 }}>{sr.name}</div>
                      <div style={{ height: 4, borderRadius: 99, background: C.hairline, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 99, background: C.ink, width: `${Math.round(sr.progress * 100)}%` }} />
                      </div>
                      <div style={{ fontSize: 10, color: C.inkMute, marginTop: 3, textAlign: "right" }}>{profile.solo_score ?? 800} pts</div>
                    </div>
                  )}
                  {vr && (
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: C.inkMute, fontWeight: 600, marginBottom: 4 }}>Versus</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 5, letterSpacing: -0.3 }}>{vr.name}</div>
                      <div style={{ height: 4, borderRadius: 99, background: C.hairline, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 99, background: C.versusMe, width: `${Math.round(vr.progress * 100)}%` }} />
                      </div>
                      <div style={{ fontSize: 10, color: C.inkMute, marginTop: 3, textAlign: "right" }}>{profile.versus_elo ?? 0} Elo</div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>Connecte-toi pour suivre ton rang</div>
                  <button onClick={() => { setScreen("account"); setShowRankPopup(false); }}
                    style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700,
                      color: C.ink, background: "none", border: `1px solid ${C.hairline}`,
                      borderRadius: 99, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" }}>
                    Se connecter
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
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
              gamesPlayed={gamesPlayed} />
      )}
      {screen === "game" && challenge && (
        <Game key={gameKey} challenge={challenge}
              onExit={versusContext ? exitVersus : () => { clearChallengeFromURL(); setScreen("menu"); }}
              onReplay={versusContext ? null : startRandom}
              onRetry={versusContext ? null : retrySame}
              onFinished={onGameFinished}
              onRefreshPart={versusContext ? null : refreshOnePart}
              versusContext={versusContext}
              onStartRematch={requestRematch}
              onJoinRematch={requestRematch}
              versusStreak={versusStreak}
              onVersusRoundResult={handleVersusRoundResult}
              authUserId={authUser?.id ?? null}
              myVersusElo={profile?.versus_elo ?? 0}
              onStatsSync={authUser ? refreshProfile : null}
              themeColors={C} glass={glass} glassDark={glassDark} theme={theme} />
      )}
      {screen === "custom" && <CustomScreen onBack={() => setScreen("menu")} onStart={startCustom}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "multi" && <VersusScreen
                                onBack={() => setScreen("menu")}
                                onCreate={handleCreateVersusRoom}
                                onJoinManual={() => setScreen("versus-join")}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-lobby" && versusCode && <VersusLobbyScreen
                                code={versusCode}
                                onBack={() => { clearVersusFromURL(); setVersusCode(null); setScreen("multi"); }}
                                onStartGame={prepareAndStartVersusGame}
                                versusPrefs={versusPrefs} setVersusPrefs={setVersusPrefs}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-join" && <VersusJoinScreen
                                initialCode={versusCode}
                                onBack={() => { clearVersusFromURL(); setVersusCode(null); setScreen("menu"); }}
                                onJoined={(code) => { setVersusCode(code); setVersusInURL(code); setScreen("versus-lobby"); }}
                                authUserId={authUser?.id ?? null}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "options" && <OptionsScreen onBack={() => setScreen("menu")} prefs={prefs} setPrefs={setPrefs}
                                themeColors={C} glass={glass} />}
      {screen === "account" && <AccountScreen onBack={() => setScreen("menu")} onOpenAuth={() => setScreen("auth")}
                                  themeColors={C} glass={glass} glassDark={glassDark}
                                  gamesPlayed={gamesPlayed} authUser={authUser} profile={profile}
                                  onProfileRefresh={refreshProfile}
                                  onLogout={async () => { await supabase.auth.signOut(); setScreen("menu"); }} />}
      {screen === "auth" && <AuthScreen onBack={() => setScreen("account")}
                                  themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "password-reset" && <PasswordResetScreen onDone={() => setScreen("account")}
                                  themeColors={C} glass={glass} glassDark={glassDark} />}

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

function Menu({ onNavigate, onPlay, prefs, setPrefs, themeColors, glass, glassDark, gamesPlayed }) {
  const C = themeColors;
  useEffect(() => {
    if (window.innerWidth < 768) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);
  const items = [
    { key: "play", label: "Jouer", sub: "Défi aléatoire", action: onPlay, primary: true },
    { key: "custom", label: "Sur Mesure", sub: "Choisis ton défi", action: () => onNavigate("custom") },
    { key: "multi", label: "Versus", sub: "Affronte un ami", action: () => onNavigate("multi") },
    { key: "options", label: "Options", sub: "Difficulté, genres, époques", action: () => onNavigate("options") },
  ];

  return (
    <div className="menu-container" style={{ height: "100dvh", display: "flex", flexDirection: "column", padding: "60px 24px 16px", maxWidth: 480, margin: "0 auto", overflow: "hidden", boxSizing: "border-box" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
        .menu-item { animation: fadeUp .5s ease both; transition: transform .25s ease; }
        .menu-item:hover { transform: translateY(-2px); }
        @media (min-width: 768px) {
          .menu-container { height: auto !important; min-height: 100vh !important; overflow: visible !important; padding: 70px 24px 48px !important; }
          .menu-logo    { margin-top: 20px !important; margin-bottom: 32px !important; }
          .menu-mode    { margin-bottom: 20px !important; }
          .menu-buttons { gap: 10px !important; }
          .menu-item    { flex: none !important; padding: 18px 22px !important; }
          .menu-version { margin-top: 24px !important; }
        }
      `}</style>

      <div className="menu-logo" style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><Logo size={28} color={C.ink} /></div>
        <h1 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 52, lineHeight: .95,
          letterSpacing: -3, margin: 0, color: C.ink }}>Fil</h1>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginTop: 10, fontWeight: 500 }}>Relie les films</div>

        {gamesPlayed > 0 && (
          <div style={{ fontSize: 10, letterSpacing: 2, color: C.inkMute, marginTop: 6, fontWeight: 500 }}>
            {gamesPlayed} {gamesPlayed > 1 ? "parties jouées" : "partie jouée"}
          </div>
        )}
      </div>

      <div className="menu-mode" style={{ marginBottom: 14 }}>
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

      <div className="menu-buttons" style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        {items.map((it, i) => (
          <button key={it.key} className="menu-item" onClick={it.action}
            style={{ ...(it.primary ? glassDark : glass), borderRadius: 18, padding: "0 22px",
              display: "flex", alignItems: "center", gap: 16, cursor: "pointer", fontFamily: "inherit",
              textAlign: "left", animationDelay: `${i * 0.05}s`,
              color: it.primary ? C.bg : C.ink, border: "none", flex: 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 19, letterSpacing: -0.5, lineHeight: 1, marginBottom: 4 }}>{it.label}</div>
              <div style={{ fontSize: 11, opacity: .65, letterSpacing: .3, fontWeight: 400 }}>{it.sub}</div>
            </div>
            <div style={{ fontSize: 15, opacity: .5 }}>→</div>
          </button>
        ))}
      </div>

      <div className="menu-version" style={{ textAlign: "center", fontSize: 10, letterSpacing: 3, color: C.inkMute, marginTop: 8, textTransform: "uppercase", fontWeight: 500 }}>v5.39</div>
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
      const cur = (p.includeGenres || []).map(Number);
      const has = cur.includes(n);
      return { ...p, filterMode: "include", includeGenres: has ? cur.filter(g => g !== n) : [...cur, n] };
    });
  }
  const allGenresChecked = allGenres.length === (prefs.includeGenres || []).length;
  function toggleAllGenres() {
    setPrefs(p => ({
      ...p, filterMode: "include",
      includeGenres: allGenresChecked ? [] : allGenres.map(Number),
    }));
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

      <div style={{ ...glass, borderRadius: 16, padding: 16, marginBottom: 28 }}>
        {/* Époques */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Époques</div>
            {prefs.eras?.length > 0 && (
              <button onClick={() => setPrefs(p => ({ ...p, eras: [] }))}
                style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                  fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  cursor: "pointer", opacity: 0.75 }}>Tout décocher</button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(ERAS).map(([key, e]) => {
              const active = (prefs.eras || []).includes(key);
              return (
                <button key={key} onClick={() => toggleEra(key)}
                  style={{ padding: "6px 12px", borderRadius: 999,
                    border: `1px solid ${active ? C.ink : C.hairline}`,
                    background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s" }}>{e.label}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.inkMute, marginTop: 8, fontWeight: 500, lineHeight: 1.4 }}>
            {(prefs.eras || []).length === 0
              ? "Aucun filtre actif : toutes les époques sont incluses."
              : "Films et séries des époques sélectionnées uniquement."}
          </div>
        </div>

        {/* Note minimale */}
        <div style={{ marginBottom: 18 }}>
          <style>{`
            .rating-slider {
              -webkit-appearance: none;
              appearance: none;
              width: 100%;
              height: 6px;
              border-radius: 3px;
              background: ${C.hairline};
              outline: none;
              margin: 12px 0 4px;
              cursor: pointer;
            }
            .rating-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: ${C.ink};
              cursor: pointer;
              border: 2px solid ${C.bg};
              box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            }
            .rating-slider::-moz-range-thumb {
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: ${C.ink};
              cursor: pointer;
              border: 2px solid ${C.bg};
            }
          `}</style>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Note minimale</div>
            {(prefs.minRating || 0) > 0 && (
              <button onClick={() => setPrefs(p => ({ ...p, minRating: 0 }))}
                style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                  fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  cursor: "pointer", opacity: 0.75 }}>Désactiver</button>
            )}
          </div>
          <div style={{ minHeight: 26, display: "flex", alignItems: "center", marginTop: 6 }}>
            {(prefs.minRating || 0) > 0
              ? <StarsDisplay stars={(prefs.minRating || 0) / 2} themeColors={C} size={18} />
              : <span style={{ fontSize: 12, fontWeight: 600, color: C.inkMute }}>Aucun filtre</span>}
          </div>
          <input type="range" min="0" max="9" step="1"
            value={prefs.minRating || 0}
            onChange={(e) => setPrefs(p => ({ ...p, minRating: parseInt(e.target.value, 10) }))}
            className="rating-slider" />
          <div style={{ fontSize: 11, color: C.inkMute, marginTop: 8, fontWeight: 500, lineHeight: 1.4 }}>
            Ne tire que des œuvres dont la note moyenne TMDb dépasse ce seuil. Évite les films oubliables.
          </div>
        </div>

        {/* Langues */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Langues acceptées</div>
            <button onClick={toggleAllLangs}
              style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", opacity: 0.75 }}>{allLangsChecked ? "Tout décocher" : "Tout cocher"}</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allLangs.map(code => {
              const active = prefs.languages.includes(code);
              return (
                <button key={code} onClick={() => toggleLang(code)}
                  style={{ padding: "6px 12px", borderRadius: 999,
                    border: `1px solid ${active ? C.ink : C.hairline}`,
                    background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s" }}>{LANGUAGES[code]}</button>
              );
            })}
          </div>
        </div>

        {/* Genres */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700 }}>Genres acceptés</div>
            <button onClick={toggleAllGenres}
              style={{ background: "none", border: "none", color: C.ink, fontFamily: "inherit",
                fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                cursor: "pointer", opacity: 0.75 }}>{allGenresChecked ? "Tout décocher" : "Tout cocher"}</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allGenres.map(id => {
              const active = (prefs.includeGenres || []).map(Number).includes(Number(id));
              return (
                <button key={id} onClick={() => toggleGenre(id)}
                  style={{ padding: "6px 12px", borderRadius: 999,
                    border: `1px solid ${active ? C.ink : C.hairline}`,
                    background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s" }}>{GENRES[id]}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.inkMute, marginTop: 8, fontWeight: 500, lineHeight: 1.4 }}>
            {(prefs.includeGenres || []).length === 0
              ? "Aucun filtre actif : tous les genres sont autorisés."
              : "Seuls les genres cochés seront tirés comme départ ou arrivée."}
          </div>
        </div>
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

function Game({ challenge, onExit, onReplay, onRetry, onFinished, onRefreshPart, versusContext, onStartRematch, onJoinRematch, versusStreak, onVersusRoundResult, authUserId, myVersusElo, onStatsSync, themeColors, glass, glassDark, theme }) {
  const C = themeColors;
  const isVersus = !!versusContext;
  const [path, setPath] = useState([{ type: "movie", data: challenge.start }]);
  const [castOfCurrent, setCastOfCurrent] = useState(null);
  const [filmoOfActor, setFilmoOfActor] = useState(null);
  const [selectedActor, setSelectedActor] = useState(null);
  const [loadingCast, setLoadingCast] = useState(false);
  const [loadingFilmo, setLoadingFilmo] = useState(false);
  const [castReloadEmpty, setCastReloadEmpty] = useState(false);
  const [filmoReloadEmpty, setFilmoReloadEmpty] = useState(false);
  const [startTime] = useState(() => {
    if (!versusContext) return Date.now();
    const key = `vs_start:${versusContext.matchId}:${versusContext.myPlayerId}`;
    const stored = localStorage.getItem(key);
    if (stored) return parseInt(stored, 10);
    const t = Date.now();
    localStorage.setItem(key, String(t));
    return t;
  });
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

  // ÉTAT VERSUS : progression de l'adversaire en temps réel
  const [opponentSteps, setOpponentSteps] = useState(0);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const [opponentAbandoned, setOpponentAbandoned] = useState(false);
  const [opponentFinalSteps, setOpponentFinalSteps] = useState(null);
  const [opponentFinalTimeMs, setOpponentFinalTimeMs] = useState(null);
  const [opponentHintsUsed, setOpponentHintsUsed] = useState(0);
  const [opponentDisconnectedAt, setOpponentDisconnectedAt] = useState(null);
  const [opponentLivePath, setOpponentLivePath] = useState(null);
  // Une fois les 2 manches vraiment conclues, on gèle l'écoute de l'adversaire : la revanche
  // (resetMatchPlayersForNewRound) remet finished=false en DB, ce qui casserait bothDone côté
  // écran de fin si on continuait à appliquer les updates en direct.
  const bothDoneAchievedRef = useRef(false);
  useEffect(() => {
    if (finished && opponentFinished) bothDoneAchievedRef.current = true;
  }, [finished, opponentFinished]);

  const currentMovie = path[path.length - 1].data;
  const isAtEnd = currentMovie.id === challenge.end.id && currentMovie.type === challenge.end.type;

  useEffect(() => {
    if (isVersus) return; // L'URL versus est gérée ailleurs, on ne touche pas à ?challenge=
    setChallengeInURL(challenge.start, challenge.end);
  }, [isVersus, challenge.start.id, challenge.start.type, challenge.end.id, challenge.end.type]);

  // VERSUS : broadcast de ma progression à chaque changement de path
  useEffect(() => {
    if (!isVersus || finished) return;
    const lightPath = path.map(n =>
      n.type === "movie"
        ? { type: "movie", id: n.data.id, work_type: n.data.type }
        : { type: "actor", id: n.data.id });
    const steps = Math.max(0, Math.floor((path.length - 1) / 2));
    updatePlayerProgress(versusContext.myPlayerId, {
      currentPath: lightPath,
      currentSteps: steps,
      hintsUsed,
    }).catch(() => {});
  }, [isVersus, path, finished, hintsUsed, versusContext]);

  // VERSUS : subscribe à l'adversaire (initial fetch + realtime)
  useEffect(() => {
    if (!isVersus) return;
    let cancelled = false;

    // Initial fetch
    (async () => {
      try {
        const players = await getMatchPlayers(versusContext.matchId);
        if (cancelled) return;
        const opp = players.find(p => p.id !== versusContext.myPlayerId);
        if (opp) {
          setOpponentSteps(opp.current_steps || 0);
          setOpponentFinished(!!opp.finished);
          setOpponentAbandoned(!!opp.abandoned);
          setOpponentFinalSteps(opp.final_steps);
          setOpponentFinalTimeMs(opp.final_time_ms);
          setOpponentHintsUsed(opp.hints_used || 0);
        }
      } catch {}
    })();

    const channel = supabase.channel(`game-${versusContext.matchId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "match_players",
        filter: `match_id=eq.${versusContext.matchId}`,
      }, (payload) => {
        // Une fois les 2 manches conclues, on ignore les updates suivants : ils ne peuvent venir
        // que du reset "revanche" (resetMatchPlayersForNewRound) et casseraient bothDone côté écran de fin.
        if (bothDoneAchievedRef.current) return;
        const p = payload.new || payload.old;
        if (!p || p.id === versusContext.myPlayerId) return;
        if (payload.eventType === "DELETE") return;
        setOpponentSteps(p.current_steps || 0);
        setOpponentFinished(!!p.finished);
        setOpponentAbandoned(!!p.abandoned);
        setOpponentFinalSteps(p.final_steps);
        setOpponentFinalTimeMs(p.final_time_ms);
        setOpponentHintsUsed(p.hints_used || 0);
        if (!p.finished && Array.isArray(p.current_path)) setOpponentLivePath(p.current_path);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isVersus, versusContext]);

  // VERSUS : Presence channel pour détecter la déconnexion de l'adversaire
  useEffect(() => {
    if (!isVersus) return;
    const ch = supabase.channel(`presence:game-${versusContext.matchId}`, {
      config: { presence: { key: String(versusContext.myPlayerId) } },
    });
    ch.on("presence", { event: "leave" }, ({ key }) => {
      if (versusContext.opponentPlayerId && key === String(versusContext.opponentPlayerId)) {
        setOpponentDisconnectedAt(Date.now());
      }
    });
    ch.on("presence", { event: "join" }, ({ key }) => {
      if (versusContext.opponentPlayerId && key === String(versusContext.opponentPlayerId)) {
        setOpponentDisconnectedAt(null);
      }
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ playerId: versusContext.myPlayerId });
    });
    return () => { supabase.removeChannel(ch); };
  }, [isVersus, versusContext]);

  // VERSUS : victoire automatique si l'adversaire reste déconnecté 30s
  useEffect(() => {
    if (!opponentDisconnectedAt || !isVersus || finished) return;
    if (Date.now() - opponentDisconnectedAt < 30000) return;
    const finalSteps = Math.max(0, Math.floor((path.length - 1) / 2));
    const finalTimeMs = Date.now() - startTime;
    setFinished(true);
    onFinished?.();
    finishPlayer(versusContext.myPlayerId, { finalSteps, finalTimeMs, abandoned: false, hintsUsed }).catch(() => {});
    if (versusContext.opponentPlayerId) {
      finishPlayer(versusContext.opponentPlayerId, {
        finalSteps: opponentSteps, finalTimeMs: elapsed, abandoned: true, hintsUsed: opponentHintsUsed,
      }).catch(() => {});
    }
  }, [elapsed, opponentDisconnectedAt, isVersus, finished]);

  // VERSUS (condition de victoire "Temps") : en mode Temps, les indices passent avant le temps.
  // Si l'adversaire finit en premier sans avoir utilisé d'indice, rien ne peut nous sauver (son temps
  // ne peut qu'être meilleur que le nôtre, et on ne peut pas faire moins de 0 indice) → arrêt immédiat.
  // S'il a utilisé au moins un indice, on continue à jouer : on a une chance de gagner sur les indices.
  // On s'arrête seulement quand on atteint (ou dépasse) son nombre d'indices, puisqu'à ce moment le
  // temps décide et le sien est déjà meilleur.
  useEffect(() => {
    if (!isVersus || finished) return;
    if ((versusContext.victoryCondition || "hybrid") !== "time") return;
    if (!opponentFinished || opponentAbandoned) return;
    if (hintsUsed < opponentHintsUsed) return;
    const finalSteps = Math.max(0, Math.floor((path.length - 1) / 2));
    const finalTimeMs = Date.now() - startTime;
    setFinished(true);
    onFinished?.();
    finishPlayer(versusContext.myPlayerId, { finalSteps, finalTimeMs, abandoned: false, hintsUsed }).catch(() => {});
  }, [isVersus, finished, opponentFinished, opponentAbandoned, opponentHintsUsed, versusContext, hintsUsed, path.length, startTime]);

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
      if (isVersus) {
        const finalSteps = Math.max(0, Math.floor((path.length - 1) / 2));
        const finalTimeMs = Date.now() - startTime;
        finishPlayer(versusContext.myPlayerId, {
          finalSteps, finalTimeMs, abandoned: false, hintsUsed,
        }).catch(() => {});
      } else {
        const finalSteps = Math.max(0, Math.floor((path.length - 1) / 2));
        saveBestSteps(finalSteps);
        if (challenge.difficultyUsed && challenge.difficultyUsed !== "custom") {
          incSoloDiff(challenge.difficultyUsed);
        }
        const optSteps = challenge.optimal?.length > 0
          ? Math.max(0, Math.floor((challenge.optimal.length - 1) / 2)) : null;
        const isOptimal = optSteps !== null && finalSteps <= optSteps;
        if (isOptimal) incSoloOptimal();
        addSoloHints(hintsUsed);
        if (authUserId && challenge.difficultyUsed && challenge.difficultyUsed !== "custom") {
          const delta = computeSoloScoreDelta(challenge.difficultyUsed, isOptimal, false);
          updateSoloScore(authUserId, delta).catch(() => {});
        }
        pushStatsToProfile(authUserId).then(() => onStatsSync?.()).catch(() => {});
      }
    }
  }, [isAtEnd, finished, onFinished, isVersus, versusContext, path.length, startTime, hintsUsed]);

  useEffect(() => {
    if (!confirmingAbandon) return;
    const t = setTimeout(() => setConfirmingAbandon(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingAbandon]);

  useEffect(() => {
    if (selectedActor) return;
    let cancelled = false;
    setCastReloadEmpty(false);
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
    setFilmoReloadEmpty(false);
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

  function reloadCast() {
    castCache.delete(`${currentMovie.id}:${currentMovie.type}`);
    setLoadingCast(true);
    setCastOfCurrent(null);
    getMovieCast(currentMovie.id, currentMovie.type, 30)
      .then(cast => { setCastOfCurrent(cast); setLoadingCast(false); if (!cast.length) setCastReloadEmpty(true); })
      .catch(e => { console.error(e); setLoadingCast(false); setCastReloadEmpty(true); });
  }

  function reloadFilmo() {
    filmoCache.delete(selectedActor.id);
    setLoadingFilmo(true);
    setFilmoOfActor(null);
    getActorMovies(selectedActor.id, currentMovie.id, currentMovie.type, ACTOR_FILMO_LIMIT)
      .then(movies => { setFilmoOfActor(movies || []); setLoadingFilmo(false); if (!movies?.length) setFilmoReloadEmpty(true); })
      .catch(e => { console.error(e); setFilmoOfActor([]); setLoadingFilmo(false); setFilmoReloadEmpty(true); });
  }

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
    if (isVersus) {
      const finalSteps = Math.max(0, Math.floor((path.length - 1) / 2));
      const finalTimeMs = Date.now() - startTime;
      finishPlayer(versusContext.myPlayerId, {
        finalSteps, finalTimeMs, abandoned: true, hintsUsed,
      }).catch(() => {});
    } else {
      incSoloAbandons();
      addSoloHints(hintsUsed);
      if (authUserId && challenge.difficultyUsed && challenge.difficultyUsed !== "custom") {
        const delta = computeSoloScoreDelta(challenge.difficultyUsed, false, true);
        updateSoloScore(authUserId, delta).catch(() => {});
      }
      pushStatsToProfile(authUserId).then(() => onStatsSync?.()).catch(() => {});
    }
  }

  if (finished) {
    if (isVersus) {
      return (
        <GameShell elapsed={elapsed} clicks={clicks} formatTime={formatTime} onExit={onExit} muted themeColors={C} glass={glass}>
          <VersusEndScreen
            matchId={versusContext.matchId}
            iAmCreator={versusContext.mySlot === 1}
            myName={versusContext.myName}
            opponentName={versusContext.opponentName}
            myPath={path}
            mySteps={playerSteps}
            myTimeMs={elapsed}
            myAbandoned={abandoned}
            myHintsUsed={hintsUsed}
            opponentFinished={opponentFinished}
            opponentAbandoned={opponentAbandoned}
            opponentSteps={opponentSteps}
            opponentFinalSteps={opponentFinalSteps}
            opponentFinalTimeMs={opponentFinalTimeMs}
            opponentHintsUsed={opponentHintsUsed}
            opponentLivePath={opponentLivePath}
            victoryCondition={versusContext.victoryCondition || "hybrid"}
            optimalSteps={challenge.optimal ? Math.max(0, Math.floor((challenge.optimal.length - 1) / 2)) : null}
            optimalPath={challenge.optimal}
            startWork={challenge.start} endWork={challenge.end}
            onExit={onExit}
            onStartRematch={onStartRematch}
            onJoinRematch={onJoinRematch}
            streak={versusStreak}
            onRoundResult={onVersusRoundResult}
            authUserId={authUserId}
            myVersusElo={myVersusElo}
            onStatsSync={onStatsSync}
            themeColors={C} glass={glass} glassDark={glassDark} />
        </GameShell>
      );
    }
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

      {isVersus && (
        <VersusBanner
          myName={versusContext.myName}
          opponentName={versusContext.opponentName}
          mySteps={playerSteps}
          opponentSteps={opponentSteps}
          myHintsUsed={hintsUsed}
          opponentHintsUsed={opponentHintsUsed}
          opponentFinished={opponentFinished}
          opponentAbandoned={opponentAbandoned}
          opponentFinalSteps={opponentFinalSteps}
          themeColors={C} glass={glass} />
      )}

      {isVersus && opponentDisconnectedAt && (() => {
        const secondsLeft = Math.max(0, 30 - Math.floor((Date.now() - opponentDisconnectedAt) / 1000));
        return (
          <div style={{ background: C.amber, color: "#fff", borderRadius: 10,
            padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600,
            textAlign: "center", letterSpacing: 0.5 }}>
            {versusContext.opponentName} s'est déconnecté — victoire dans {secondsLeft}s
          </div>
        );
      })()}

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
          castOfCurrent && <>
            {castOfCurrent.length > 0
              ? <ActorPicker title={`Casting · ${currentMovie.title} · ${castOfCurrent.length}`} actors={castOfCurrent} onPick={pickActor}
                  greenId={hintActive && greenHint?.kind === "actor" ? greenHint.id : null}
                  yellowIds={hintActive ? visitedActorIds : null}
                  sort={castSort}
                  onToggleSort={() => setCastSort(s => s === "popularity" ? "ord" : "popularity")}
                  themeColors={C} glass={glass} />
              : castReloadEmpty && <div style={{ textAlign: "center", padding: "16px 0", color: C.inkMute, fontSize: 14 }}>Données manquantes</div>}
            <div style={{ textAlign: "center", marginTop: 12, marginBottom: 4 }}>
              <button onClick={reloadCast} style={{ background: "none", border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "6px 16px", color: C.inkSoft, cursor: "pointer", fontSize: 13 }}>Recharger le casting</button>
            </div>
          </>
        ) : (
          loadingFilmo ? <Spinner label={`Filmographie de ${selectedActor.name}`} themeColors={C} /> :
          filmoOfActor && <>
            {filmoOfActor.length > 0
              ? <MoviePicker title={`Filmographie · ${selectedActor.name} · ${filmoOfActor.length}`}
                  movies={filmoOfActor} targetWork={challenge.end} onPick={pickMovie}
                  greenWork={hintActive && greenHint?.kind === "movie" ? { id: greenHint.id, type: greenHint.workType } : null}
                  yellowKeys={hintActive ? visitedMovieKeys : null}
                  sort={filmoSort} onToggleSort={() => setFilmoSort(s => s === "popularity" ? "date" : "popularity")}
                  onClose={() => { setClicks(c => c + 1); setSelectedActor(null); setFilmoOfActor(null); }}
                  themeColors={C} glass={glass} />
              : filmoReloadEmpty && <div style={{ textAlign: "center", padding: "16px 0", color: C.inkMute, fontSize: 14 }}>Données manquantes</div>}
            <div style={{ textAlign: "center", marginTop: 12, marginBottom: 4 }}>
              <button onClick={reloadFilmo} style={{ background: "none", border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "6px 16px", color: C.inkSoft, cursor: "pointer", fontSize: 13 }}>Recharger la filmographie</button>
            </div>
          </>
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

      <div style={{ position: "fixed", bottom: 16, left: 16, right: 16,
        background: C.name === "light" ? "rgba(250,250,250,0.97)" : "rgba(10,14,24,0.97)",
        backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)",
        border: `1px solid ${C.hairline}`,
        boxShadow: C.name === "light" ? "0 -2px 12px rgba(15,23,41,0.08)" : "0 -2px 12px rgba(0,0,0,0.3)",
        transform: "translateZ(0)",
        borderRadius: 999, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);

  const sorted = useMemo(() => {
    const copy = [...actors];
    if (sort === "ord") {
      copy.sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999));
    } else {
      copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    return copy;
  }, [actors, sort]);

  const displayed = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const fuse = new Fuse(sorted, { keys: ["name"], threshold: 0.4, minMatchCharLength: 2 });
    return fuse.search(searchQuery.trim()).map(r => r.item);
  }, [sorted, searchQuery]);

  const isSearching = !!displayed;
  const visible = isSearching ? displayed : (expanded ? sorted : sorted.slice(0, CAST_DISPLAY_DEFAULT));
  const hiddenCount = Math.max(0, sorted.length - CAST_DISPLAY_DEFAULT);

  function toggleSearch() {
    setShowSearch(s => {
      if (s) setSearchQuery("");
      return !s;
    });
    if (!showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }

  return (
    <div style={{ ...glass, borderRadius: 20, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 12px", gap: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <button onClick={toggleSearch} title="Rechercher"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4,
            color: showSearch ? C.ink : C.inkSoft, opacity: showSearch ? 1 : 0.6, display: "flex", alignItems: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        {onToggleSort && (
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", minWidth: 95 }}>
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
      {showSearch && (
        <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${C.hairline}` }}>
          <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher un acteur…"
            style={{ width: "100%", boxSizing: "border-box", background: C.cardBg, border: `1px solid ${C.hairline}`,
              borderRadius: 10, padding: "8px 12px", fontSize: 13, fontFamily: "inherit",
              color: C.ink, outline: "none" }} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {visible.length === 0 && isSearching && (
          <div style={{ gridColumn: "1 / -1", padding: "16px 0", fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucun résultat</div>
        )}
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
              <ActorPhoto actor={a} size={68} highlight={active} highlightColor={hColor} themeColors={C} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.ink, textAlign: "center", lineHeight: 1.2 }}>{a.name}</span>
            </button>
          );
        })}
      </div>
      {!isSearching && hiddenCount > 0 && (
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);

  const sorted = useMemo(() => {
    const copy = [...movies];
    if (sort === "date") {
      copy.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else {
      copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    }
    return copy;
  }, [movies, sort]);

  const displayed = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const fuse = new Fuse(sorted, { keys: ["title"], threshold: 0.4, minMatchCharLength: 2 });
    return fuse.search(searchQuery.trim()).map(r => r.item);
  }, [sorted, searchQuery]);

  const isSearching = !!displayed;
  const visible = isSearching ? displayed : sorted;

  function toggleSearch() {
    setShowSearch(s => {
      if (s) setSearchQuery("");
      return !s;
    });
    if (!showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }

  return (
    <div style={{ ...glass, borderRadius: 20, padding: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px 6px", gap: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <button onClick={toggleSearch} title="Rechercher"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4,
            color: showSearch ? C.ink : C.inkSoft, opacity: showSearch ? 1 : 0.6, display: "flex", alignItems: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", minWidth: 95 }}>
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
      {showSearch && (
        <div style={{ padding: "0 8px 8px" }}>
          <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher un film ou une série…"
            style={{ width: "100%", boxSizing: "border-box", background: C.cardBg, border: `1px solid ${C.hairline}`,
              borderRadius: 10, padding: "8px 12px", fontSize: 13, fontFamily: "inherit",
              color: C.ink, outline: "none" }} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflowY: "auto" }}>
        {visible.length === 0 && (
          <div style={{ padding: 24, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>
            {isSearching ? "Aucun résultat" : "Aucune autre œuvre trouvée."}
          </div>
        )}
        {visible.map(m => {
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
              <Poster movie={m} size={52} rounded={8} highlight={active} highlightColor={hColor} themeColors={C} />
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

// =========================================================================
// VERSUS — Composants in-game (banner + écran de fin)
// =========================================================================

function VersusBanner({ myName, opponentName, mySteps, opponentSteps, myHintsUsed, opponentHintsUsed, opponentFinished, opponentAbandoned, opponentFinalSteps, themeColors, glass }) {
  const C = themeColors;
  const oppDisplay = opponentAbandoned ? "Abandon"
                   : opponentFinished  ? `${opponentFinalSteps ?? opponentSteps} ét.`
                                       : `${opponentSteps} ét.`;
  const oppValueColor = opponentAbandoned ? C.amber
                      : opponentFinished  ? C.green
                                          : C.versusOpponent;
  // Pictogramme ampoule pour indiquer les indices, suivi du nombre
  const HintIcon = ({ color }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color, letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
        <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.5V17h8v-2.5A7 7 0 0 0 12 2z"/>
      </svg>
    </span>
  );
  return (
    <div style={{ ...glass, borderRadius: 14, padding: "10px 14px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, marginBottom: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: C.versusMe, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.versusMe, display: "inline-block" }} />
          {myName} · toi
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.versusMe, letterSpacing: -0.4, fontVariantNumeric: "tabular-nums" }}>{mySteps} ét.</div>
          {(myHintsUsed > 0) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color: C.versusMe, opacity: 0.75 }}>
              <HintIcon color={C.versusMe} />
              {myHintsUsed}
            </span>
          )}
        </div>
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: C.hairline }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: C.versusOpponent, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
          {opponentName}
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.versusOpponent, display: "inline-block" }} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          {(opponentHintsUsed > 0) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color: C.versusOpponent, opacity: 0.75 }}>
              <HintIcon color={C.versusOpponent} />
              {opponentHintsUsed}
            </span>
          )}
          <div style={{ fontSize: 16, fontWeight: 800, color: oppValueColor, letterSpacing: -0.4, fontVariantNumeric: "tabular-nums" }}>{oppDisplay}</div>
        </div>
      </div>
    </div>
  );
}

function VersusEndScreen({
  matchId, iAmCreator,
  myName, opponentName,
  myPath, mySteps, myTimeMs, myAbandoned, myHintsUsed,
  opponentFinished, opponentAbandoned, opponentSteps,
  opponentFinalSteps, opponentFinalTimeMs, opponentHintsUsed, opponentLivePath,
  victoryCondition = "hybrid",
  optimalSteps, optimalPath,
  startWork, endWork,
  onExit, onStartRematch, onJoinRematch,
  streak, onRoundResult, authUserId, myVersusElo, onStatsSync,
  themeColors, glass, glassDark
}) {
  const C = themeColors;
  const formatTime = (ms) => {
    if (ms == null) return "—";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const bothDone = opponentFinished;
  const [opponentPath, setOpponentPath] = useState(null);
  const [opponentLiveHydrated, setOpponentLiveHydrated] = useState(null);
  const [rematchReady, setRematchReady] = useState(false);
  const [requestingRematch, setRequestingRematch] = useState(false);
  const [eloGain, setEloGain] = useState(null);
  const statsTrackedRef = useRef(false);

  // Enregistre victoire/défaite en localStorage une seule fois quand bothDone
  useEffect(() => {
    if (!bothDone || statsTrackedRef.current) return;
    statsTrackedRef.current = true;
    let iWon = false;
    let iLost = false;
    if (myAbandoned) {
      iLost = true;
    } else if (opponentAbandoned) {
      iWon = true;
    } else if (victoryCondition === "time") {
      const oppSteps = opponentFinalSteps ?? Infinity;
      const oppTime  = opponentFinalTimeMs ?? Infinity;
      if      (myHintsUsed < opponentHintsUsed) iWon  = true;
      else if (myHintsUsed > opponentHintsUsed) iLost = true;
      else if (myTimeMs    < oppTime)            iWon  = true;
      else if (myTimeMs    > oppTime)            iLost = true;
      else if (mySteps     < oppSteps)           iWon  = true;
      else if (mySteps     > oppSteps)           iLost = true;
    } else {
      const oppSteps = opponentFinalSteps ?? Infinity;
      const oppTime  = opponentFinalTimeMs ?? Infinity;
      if      (mySteps     < oppSteps)           iWon  = true;
      else if (mySteps     > oppSteps)           iLost = true;
      else if (myHintsUsed < opponentHintsUsed)  iWon  = true;
      else if (myHintsUsed > opponentHintsUsed)  iLost = true;
      else if (myTimeMs    < oppTime)             iWon  = true;
      else if (myTimeMs    > oppTime)             iLost = true;
    }
    if (iWon) incrementVersusWins();
    else if (iLost) incrementVersusLosses();
    if (!myAbandoned && optimalSteps !== null && mySteps <= optimalSteps) incVersusOptimal();
    addVersusHints(myHintsUsed);
    // Elo Versus
    if (authUserId && !myAbandoned) {
      (async () => {
        try {
          const players = await getMatchPlayers(matchId);
          const opp = players.find(p => p.user_id && p.user_id !== authUserId);
          let oppElo = 0;
          if (opp?.user_id) {
            const { data } = await supabase.from("profiles").select("versus_elo").eq("id", opp.user_id).single();
            oppElo = data?.versus_elo ?? 0;
          }
          const result = iWon ? 1 : iLost ? 0 : 0.5;
          const gain = computeVersusEloGain(myVersusElo ?? 0, oppElo, result);
          const next = Math.max(0, (myVersusElo ?? 0) + gain);
          await supabase.from("profiles").update({ versus_elo: next }).eq("id", authUserId);
          setEloGain(gain);
        } catch {}
      })();
    }
    pushStatsToProfile(authUserId).then(() => onStatsSync?.()).catch(() => {});
    // Marque le salon "finished" (sinon la revanche ne peut jamais réclamer le reset)
    finishMatch(matchId).catch(() => {});
    onRoundResult?.(iWon ? "me" : iLost ? "opponent" : null);
  }, [bothDone]);

  // Hydrate le chemin live de l'adversaire pendant qu'il joue encore
  useEffect(() => {
    if (!opponentLivePath || opponentLivePath.length === 0 || bothDone) return;
    let cancelled = false;
    (async () => {
      try {
        const workPairs = opponentLivePath.filter(n => n.type === "movie").map(n => ({ id: n.id, type: n.work_type }));
        const actorIds = opponentLivePath.filter(n => n.type === "actor").map(n => n.id);
        const [works, actorsData] = await Promise.all([
          workPairs.length > 0 ? getWorksByPairs(workPairs) : Promise.resolve([]),
          actorIds.length > 0
            ? supabase.from("actors").select("id, name, profile_path, popularity").in("id", actorIds).then(r => r.data || [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const workMap = new Map((works || []).filter(Boolean).map(w => [`${w.id}:${w.type}`, w]));
        const actorMap = new Map((actorsData || []).map(a => [a.id, a]));
        const hydrated = opponentLivePath.map(n => {
          if (n.type === "movie") {
            const w = workMap.get(`${n.id}:${n.work_type}`);
            return { type: "movie", data: w || { id: n.id, type: n.work_type, title: "…" } };
          } else {
            const a = actorMap.get(n.id);
            return { type: "actor", data: a || { id: n.id, name: "…" } };
          }
        });
        setOpponentLiveHydrated(hydrated);
      } catch (e) { /* silently ignore */ }
    })();
    return () => { cancelled = true; };
  }, [opponentLivePath, bothDone]);

  // Hydrate le chemin de l'adversaire quand il a fini
  useEffect(() => {
    if (!bothDone) return;
    let cancelled = false;
    (async () => {
      try {
        // Fetch son current_path et hydrate works/actors
        const players = await getMatchPlayers(matchId);
        if (cancelled) return;
        const opp = players.find(p => p.player_name === opponentName);
        if (!opp || !opp.current_path || !Array.isArray(opp.current_path) || opp.current_path.length === 0) return;

        const workPairs = opp.current_path
          .filter(n => n.type === "movie")
          .map(n => ({ id: n.id, type: n.work_type }));
        const actorIds = opp.current_path.filter(n => n.type === "actor").map(n => n.id);

        const [works, actorsData] = await Promise.all([
          workPairs.length > 0 ? getWorksByPairs(workPairs) : Promise.resolve([]),
          actorIds.length > 0
            ? supabase.from("actors").select("id, name, profile_path, popularity").in("id", actorIds).then(r => r.data || [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;

        const workMap = new Map((works || []).filter(Boolean).map(w => [`${w.id}:${w.type}`, w]));
        const actorMap = new Map((actorsData || []).map(a => [a.id, a]));

        const hydrated = opp.current_path.map(n => {
          if (n.type === "movie") {
            const w = workMap.get(`${n.id}:${n.work_type}`);
            return { type: "movie", data: w || { id: n.id, type: n.work_type, title: "…" } };
          } else {
            const a = actorMap.get(n.id);
            return { type: "actor", data: a || { id: n.id, name: "…" } };
          }
        });
        setOpponentPath(hydrated);
      } catch (e) { /* silently ignore */ }
    })();
    return () => { cancelled = true; };
  }, [bothDone, matchId, opponentName]);

  // Realtime : écoute si l'adversaire a déjà reset le salon pour une revanche (status repasse à "waiting")
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.from("matches").select("status").eq("id", matchId).maybeSingle();
      if (!cancelled && data?.status === "waiting") setRematchReady(true);
    })();

    const channel = supabase.channel(`end-${matchId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "matches",
        filter: `id=eq.${matchId}`,
      }, (payload) => {
        if (!cancelled && payload.new?.status === "waiting") setRematchReady(true);
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [matchId]);

  // Calcul du verdict si les deux ont fini
  let verdict = null;
  let verdictColor = C.ink;
  if (bothDone) {
    if (myAbandoned && opponentAbandoned) {
      verdict = "Double abandon"; verdictColor = C.inkSoft;
    } else if (myAbandoned) {
      verdict = `${opponentName} gagne par abandon`; verdictColor = C.amber;
    } else if (opponentAbandoned) {
      verdict = "Tu gagnes par abandon"; verdictColor = C.green;
    } else if (victoryCondition === "time") {
      // Mode Temps : indices d'abord (un indice est une pénalité), puis temps, puis étapes
      const oppTime = opponentFinalTimeMs ?? Infinity;
      const oppSteps = opponentFinalSteps ?? Infinity;
      if (myHintsUsed < opponentHintsUsed) {
        verdict = "🏆 Tu gagnes (moins d'indices)"; verdictColor = C.green;
      } else if (myHintsUsed > opponentHintsUsed) {
        verdict = `${opponentName} gagne (moins d'indices)`; verdictColor = C.amber;
      } else if (myTimeMs < oppTime) {
        verdict = "🏆 Tu gagnes (plus rapide)"; verdictColor = C.green;
      } else if (myTimeMs > oppTime) {
        verdict = `${opponentName} gagne (plus rapide)`; verdictColor = C.amber;
      } else if (mySteps < oppSteps) {
        verdict = "🏆 Tu gagnes (moins d'étapes)"; verdictColor = C.green;
      } else if (mySteps > oppSteps) {
        verdict = `${opponentName} gagne (moins d'étapes)`; verdictColor = C.amber;
      } else {
        verdict = "Égalité parfaite"; verdictColor = C.inkSoft;
      }
    } else {
      // Mode Étapes (hybrid) : étapes d'abord, puis indices, puis temps
      const oppSteps = opponentFinalSteps ?? Infinity;
      const oppTime = opponentFinalTimeMs ?? Infinity;
      if (mySteps < oppSteps) {
        verdict = "🏆 Tu gagnes"; verdictColor = C.green;
      } else if (mySteps > oppSteps) {
        verdict = `${opponentName} gagne`; verdictColor = C.amber;
      } else if (myHintsUsed < opponentHintsUsed) {
        verdict = "🏆 Tu gagnes (moins d'indices)"; verdictColor = C.green;
      } else if (myHintsUsed > opponentHintsUsed) {
        verdict = `${opponentName} gagne (moins d'indices)`; verdictColor = C.amber;
      } else if (myTimeMs < oppTime) {
        verdict = "🏆 Tu gagnes (au temps)"; verdictColor = C.green;
      } else if (myTimeMs > oppTime) {
        verdict = `${opponentName} gagne (au temps)`; verdictColor = C.amber;
      } else {
        verdict = "Égalité parfaite"; verdictColor = C.inkSoft;
      }
    }
  }

  async function handleRequestRematch() {
    if (requestingRematch) return;
    setRequestingRematch(true);
    try {
      // onStartRematch et onJoinRematch pointent tous deux vers requestRematch :
      // reset en place du même salon, que ce soit nous qui réclamions ou l'adversaire qui l'a déjà fait.
      await onStartRematch({ id: matchId });
    } catch (e) {
      setRequestingRematch(false);
    }
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
    <div style={{ textAlign: "center", paddingTop: 8, position: "relative" }}>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 4, fontWeight: 600 }}>Versus</div>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.inkMute, marginBottom: 12, fontWeight: 500 }}>
        {victoryCondition === "time" ? "Mode Temps" : "Mode Étapes"}
      </div>

      {bothDone ? (
        <>
          <div style={{ fontWeight: 800, fontSize: 32, lineHeight: 1.05, color: verdictColor, marginBottom: streak?.count >= 2 ? 8 : 24, letterSpacing: -1.2 }}>
            {verdict}
          </div>

          {streak?.count >= 2 && (
            <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 8, letterSpacing: 0.3 }}>
              🔥 {streak.winner === "me" ? "Toi" : opponentName} : {streak.count} victoires de suite
            </div>
          )}

          {eloGain !== null && authUserId && (
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, letterSpacing: 0.2,
              color: eloGain >= 0 ? C.green : C.amber }}>
              {eloGain >= 0 ? "+" : ""}{eloGain} Elo Versus
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <VersusPlayerCard
              name={myName} isMe
              steps={mySteps} timeMs={myTimeMs}
              abandoned={myAbandoned} hintsUsed={myHintsUsed}
              winner={!myAbandoned && (
                opponentAbandoned || (() => {
                  const os = opponentFinalSteps ?? Infinity, ot = opponentFinalTimeMs ?? Infinity;
                  if (victoryCondition === "time") {
                    return myHintsUsed < opponentHintsUsed || (myHintsUsed === opponentHintsUsed && myTimeMs < ot) || (myHintsUsed === opponentHintsUsed && myTimeMs === ot && mySteps < os);
                  }
                  return mySteps < os || (mySteps === os && myHintsUsed < opponentHintsUsed) || (mySteps === os && myHintsUsed === opponentHintsUsed && myTimeMs < ot);
                })()
              )}
              themeColors={C} glass={glass} />
            <VersusPlayerCard
              name={opponentName}
              steps={opponentFinalSteps ?? opponentSteps}
              timeMs={opponentFinalTimeMs}
              abandoned={opponentAbandoned}
              hintsUsed={opponentHintsUsed}
              winner={!opponentAbandoned && !myAbandoned && (() => {
                const os = opponentFinalSteps ?? Infinity, ot = opponentFinalTimeMs ?? Infinity;
                if (victoryCondition === "time") {
                  return opponentHintsUsed < myHintsUsed || (opponentHintsUsed === myHintsUsed && ot < myTimeMs) || (opponentHintsUsed === myHintsUsed && ot === myTimeMs && os < mySteps);
                }
                return os < mySteps || (os === mySteps && opponentHintsUsed < myHintsUsed) || (os === mySteps && opponentHintsUsed === myHintsUsed && ot < myTimeMs);
              })()}
              themeColors={C} glass={glass} />
          </div>

          {/* Mon chemin */}
          {myPath && myPath.length > 0 && (
            <div style={{ ...glass, borderRadius: 16, padding: 14, marginBottom: 10, textAlign: "left",
              borderLeft: `3px solid ${C.versusMe}` }}>
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.versusMe, marginBottom: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.versusMe, display: "inline-block" }} />
                Ton parcours
              </div>
              <PathStrip path={myPath} themeColors={C} />
            </div>
          )}

          {/* Chemin adversaire */}
          {opponentPath && opponentPath.length > 0 && (
            <div style={{ ...glass, borderRadius: 16, padding: 14, marginBottom: 10, textAlign: "left",
              borderLeft: `3px solid ${C.versusOpponent}` }}>
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.versusOpponent, marginBottom: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.versusOpponent, display: "inline-block" }} />
                Parcours de {opponentName}
              </div>
              <PathStrip path={opponentPath} themeColors={C} />
            </div>
          )}

          {/* Chemin optimal */}
          {optimalPath && optimalPath.length > 0 && (
            <div style={{ ...glass, borderRadius: 16, padding: 14, marginBottom: 10, textAlign: "left" }}>
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 700 }}>
                Chemin optimal · {optimalSteps} étape{optimalSteps > 1 ? "s" : ""}
              </div>
              <OptimalPathStrip path={optimalPath} themeColors={C} />
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontWeight: 800, fontSize: 30, lineHeight: 1.1, color: myAbandoned ? C.amber : C.green, marginBottom: 10, letterSpacing: -1.2 }}>
            {myAbandoned ? "Tu as abandonné" : "Tu as fini !"}
          </div>
          <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 22, fontWeight: 500 }}>
            {myAbandoned
              ? <>On attend la fin de la partie<AnimatedDots /></>
              : <>En attente de {opponentName}<AnimatedDots /></>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <VersusPlayerCard
              name={myName} isMe done
              steps={mySteps} timeMs={myTimeMs}
              abandoned={myAbandoned} hintsUsed={myHintsUsed}
              themeColors={C} glass={glass} />
            <VersusPlayerCard
              name={opponentName}
              steps={opponentSteps}
              inProgress
              abandoned={opponentAbandoned}
              hintsUsed={opponentHintsUsed}
              themeColors={C} glass={glass} />
          </div>

          {!myAbandoned && opponentLiveHydrated && opponentLiveHydrated.length > 0 && (
            <div style={{ ...glass, borderRadius: 16, padding: 14, marginBottom: 10, textAlign: "left",
              borderLeft: `3px solid ${C.versusOpponent}` }}>
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.versusOpponent, marginBottom: 10, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.versusOpponent, display: "inline-block" }} />
                Parcours de {opponentName} en direct
              </div>
              <PathStrip path={opponentLiveHydrated} themeColors={C} />
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
        <button onClick={onExit} style={btnSecondary}>Menu</button>

        {/* REVANCHE BILATÉRALE :
            - Si personne n'a encore demandé : bouton "Revanche" pour les 2
            - Si l'autre a déjà reset le salon (status repassé à "waiting") : bouton vert "X propose une revanche !"
        */}
        {bothDone && !rematchReady && (
          <button onClick={handleRequestRematch} disabled={requestingRematch} style={btnPrimary}>
            {requestingRematch ? <>Préparation<AnimatedDots color="#fff" /></> : "Revanche"}
          </button>
        )}

        {bothDone && rematchReady && !requestingRematch && (
          <button onClick={handleRequestRematch}
            style={{ ...btnPrimary, background: C.green, boxShadow: `0 4px 14px ${C.green}66` }}>
            {`${opponentName} propose une revanche !`}
          </button>
        )}

        {bothDone && rematchReady && requestingRematch && (
          <button disabled style={{ ...btnPrimary, background: C.green, opacity: 0.7 }}>
            <>Connexion<AnimatedDots color="#fff" /></>
          </button>
        )}
      </div>
    </div>
  );
}

function VersusPlayerCard({ name, isMe, steps, timeMs, abandoned, hintsUsed, winner, done, inProgress, themeColors, glass }) {
  const C = themeColors;
  const accent = isMe ? C.versusMe : C.versusOpponent;
  const formatTime = (ms) => {
    if (ms == null) return "—";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return (
    <div style={{ ...glass, borderRadius: 16, padding: "14px 16px",
      border: winner ? `1.5px solid ${C.green}` : `1px solid ${C.hairline}`,
      borderLeft: winner ? `1.5px solid ${C.green}` : `3px solid ${accent}`,
      boxShadow: winner ? `0 0 0 2px ${C.green}30, 0 0 24px ${C.green}20` : "none",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: accent, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, display: "inline-block" }} />
          {isMe ? "Toi" : "Adversaire"}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, letterSpacing: -0.5,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {abandoned ? (
          <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, letterSpacing: 1, textTransform: "uppercase" }}>Abandon</div>
        ) : inProgress ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{steps ?? 0} ét.</div>
            <div style={{ fontSize: 10, color: C.inkMute, fontWeight: 600, letterSpacing: 1 }}>en cours…</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{steps ?? 0} ét.</div>
            <div style={{ fontSize: 11, color: C.inkSoft, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatTime(timeMs)}{hintsUsed > 0 ? ` · ${hintsUsed} indice${hintsUsed > 1 ? "s" : ""}` : ""}</div>
          </>
        )}
      </div>
    </div>
  );
}

function CustomScreen({ onBack, onStart, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pickingFor, setPickingFor] = useState("start");

  useEffect(() => {
    if (window.innerWidth < 768) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

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

// =========================================================================
// VERSUS — Écrans
// =========================================================================

function VersusScreen({ onBack, onCreate, onJoinManual, themeColors, glass, glassDark }) {
  const C = themeColors;
  useEffect(() => {
    if (window.innerWidth < 768) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);
  const btnPrimary = {
    ...glassDark, borderRadius: 18, padding: "20px 22px",
    display: "flex", alignItems: "center", gap: 16, cursor: "pointer", fontFamily: "inherit",
    textAlign: "left", border: "none", width: "100%",
  };
  const btnSecondary = {
    ...glass, borderRadius: 18, padding: "20px 22px",
    display: "flex", alignItems: "center", gap: 16, cursor: "pointer", fontFamily: "inherit",
    textAlign: "left", color: C.ink, width: "100%",
  };
  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus</div>
        <h2 style={{ fontWeight: 800, fontSize: 36, margin: 0, letterSpacing: -1.5, lineHeight: 1, color: C.ink }}>Affronte un ami</h2>
        <p style={{ fontSize: 13, color: C.inkSoft, marginTop: 12, lineHeight: 1.5, fontWeight: 500 }}>
          Deux joueurs, le même défi. Le plus rapide ou le plus malin gagne.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={onCreate} style={btnPrimary}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5, marginBottom: 4 }}>Créer une partie</div>
            <div style={{ fontSize: 11, opacity: .7, letterSpacing: .3, fontWeight: 400 }}>Invite ton ami avec un code</div>
          </div>
          <div style={{ fontSize: 15, opacity: .6 }}>→</div>
        </button>
        <button onClick={onJoinManual} style={btnSecondary}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5, marginBottom: 4 }}>Rejoindre une partie</div>
            <div style={{ fontSize: 11, opacity: .7, letterSpacing: .3, fontWeight: 400 }}>J'ai reçu un code</div>
          </div>
          <div style={{ fontSize: 15, opacity: .5 }}>→</div>
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// VERSUS — Panel des filtres réutilisable (utilisé dans CreateScreen + Lobby)
// =========================================================================

function VersusFiltersPanel({ versusPrefs, setVersusPrefs, disabled, themeColors, glass }) {
  const C = themeColors;
  const allLangs = Object.keys(LANGUAGES);
  const allGenres = Object.keys(GENRES);
  const allLangsChecked = (versusPrefs.languages || []).length === allLangs.length;

  function toggleLang(code) {
    setVersusPrefs(p => {
      const has = p.languages.includes(code);
      const next = has ? p.languages.filter(l => l !== code) : [...p.languages, code];
      return { ...p, languages: next.length === 0 ? ["en"] : next };
    });
  }
  function toggleAllLangs() {
    setVersusPrefs(p => ({ ...p, languages: allLangsChecked ? ["en"] : allLangs }));
  }
  function toggleGenre(id) {
    setVersusPrefs(p => {
      const n = Number(id);
      const cur = (p.includeGenres || []).map(Number);
      const has = cur.includes(n);
      return { ...p, filterMode: "include", includeGenres: has ? cur.filter(g => g !== n) : [...cur, n] };
    });
  }
  const allGenresChecked = allGenres.length === (versusPrefs.includeGenres || []).length;
  function toggleAllGenres() {
    setVersusPrefs(p => ({
      ...p, filterMode: "include",
      includeGenres: allGenresChecked ? [] : allGenres.map(Number),
    }));
  }
  function toggleEra(key) {
    setVersusPrefs(p => {
      const current = p.eras || [];
      const has = current.includes(key);
      return { ...p, eras: has ? current.filter(k => k !== key) : [...current, key] };
    });
  }
  function resetDefaults() {
    setVersusPrefs(p => ({
      ...p,
      languages: [...DEFAULT_PREFS.languages],
      filterMode: DEFAULT_PREFS.filterMode,
      includeGenres: [...DEFAULT_PREFS.includeGenres],
      excludeGenres: [...DEFAULT_PREFS.excludeGenres],
      eras: [...DEFAULT_PREFS.eras],
      minRating: DEFAULT_PREFS.minRating,
    }));
  }

  const titleStyle = {
    fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
    color: C.inkSoft, fontWeight: 700,
  };
  // Pattern uniforme pour les titres de sections : flex avec bouton optionnel à droite
  const titleRowStyle = {
    display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8,
  };
  const linkBtnStyle = {
    background: "none", border: "none", color: C.ink, fontFamily: "inherit",
    fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 0.75,
  };

  return (
    <div style={{ ...glass, borderRadius: 16, padding: 16 }}>
      {/* Époques */}
      <div style={{ marginBottom: 18 }}>
        <div style={titleRowStyle}>
          <div style={titleStyle}>Époques</div>
          {versusPrefs.eras?.length > 0 && (
            <button onClick={() => setVersusPrefs(p => ({ ...p, eras: [] }))} disabled={disabled} style={linkBtnStyle}>Vider</button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(ERAS).map(([key, e]) => {
            const active = (versusPrefs.eras || []).includes(key);
            return (
              <button key={key} onClick={() => toggleEra(key)} disabled={disabled}
                style={{ padding: "6px 12px", borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1 }}>{e.label}</button>
            );
          })}
        </div>
      </div>

      {/* Note minimale */}
      <div style={{ marginBottom: 18 }}>
        <style>{`
          .rating-slider-vp {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: ${C.hairline};
            outline: none;
            margin: 12px 0 4px;
            cursor: pointer;
          }
          .rating-slider-vp::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 18px; height: 18px;
            border-radius: 50%;
            background: ${C.ink};
            cursor: pointer;
            border: 2px solid ${C.bg};
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }
          .rating-slider-vp::-moz-range-thumb {
            width: 18px; height: 18px;
            border-radius: 50%;
            background: ${C.ink};
            cursor: pointer;
            border: 2px solid ${C.bg};
          }
        `}</style>
        <div style={titleRowStyle}>
          <div style={titleStyle}>Note minimale</div>
          {(versusPrefs.minRating || 0) > 0 && (
            <button onClick={() => setVersusPrefs(p => ({ ...p, minRating: 0 }))} disabled={disabled} style={linkBtnStyle}>Désactiver</button>
          )}
        </div>
        <div style={{ minHeight: 26, display: "flex", alignItems: "center", marginTop: 6 }}>
          {(versusPrefs.minRating || 0) > 0
            ? <StarsDisplay stars={(versusPrefs.minRating || 0) / 2} themeColors={C} size={18} />
            : <span style={{ fontSize: 12, fontWeight: 600, color: C.inkMute }}>Aucun filtre</span>}
        </div>
        <input type="range" min="0" max="9" step="1"
          value={versusPrefs.minRating || 0}
          disabled={disabled}
          onChange={(e) => setVersusPrefs(p => ({ ...p, minRating: parseInt(e.target.value, 10) }))}
          className="rating-slider-vp" />
      </div>

      {/* Langues (titre aligné à gauche comme les autres, bouton à droite pour cohérence) */}
      <div style={{ marginBottom: 18 }}>
        <div style={titleRowStyle}>
          <div style={titleStyle}>Langues</div>
          <button onClick={toggleAllLangs} disabled={disabled} style={linkBtnStyle}>
            {allLangsChecked ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {allLangs.map(code => {
            const active = versusPrefs.languages.includes(code);
            return (
              <button key={code} onClick={() => toggleLang(code)} disabled={disabled}
                style={{ padding: "6px 12px", borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1 }}>{LANGUAGES[code]}</button>
            );
          })}
        </div>
      </div>

      {/* Genres */}
      <div style={{ marginBottom: 18 }}>
        <div style={titleRowStyle}>
          <div style={titleStyle}>Genres acceptés</div>
          <button onClick={toggleAllGenres} disabled={disabled} style={linkBtnStyle}>
            {allGenresChecked ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {allGenres.map(id => {
            const active = (versusPrefs.includeGenres || []).map(Number).includes(Number(id));
            return (
              <button key={id} onClick={() => toggleGenre(id)} disabled={disabled}
                style={{ padding: "6px 12px", borderRadius: 999,
                  border: `1px solid ${active ? C.ink : C.hairline}`,
                  background: active ? C.ink : C.cardBg, color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1 }}>{GENRES[id]}</button>
            );
          })}
        </div>
      </div>

      {/* Réinitialiser par défaut */}
      <div style={{ paddingTop: 14, borderTop: `1px solid ${C.hairline}` }}>
        <button onClick={resetDefaults} disabled={disabled}
          style={{ width: "100%", background: "transparent", border: `1px solid ${C.hairline}`,
            borderRadius: 999, padding: "9px 16px",
            fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
            cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700,
            color: C.ink, opacity: disabled ? 0.5 : 1 }}>
          Réinitialiser par défaut
        </button>
      </div>
    </div>
  );
}

function VersusJoinScreen({ initialCode, onBack, onJoined, authUserId, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [playerName, setPlayerName] = useState(getStoredPlayerName());
  const [code, setCode] = useState(initialCode || "");
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleJoin() {
    const name = playerName.trim();
    const clean = code.replace(/\D/g, "");
    if (!name) { setErrorMsg("Choisis un pseudo."); return; }
    if (name.length > 20) { setErrorMsg("Pseudo trop long (20 max)."); return; }
    if (clean.length !== 6) { setErrorMsg("Le code fait 6 chiffres."); return; }

    setJoining(true);
    setErrorMsg(null);
    try {
      const match = await getMatchByCode(clean);
      if (!match) throw new Error("Aucune partie avec ce code.");
      if (match.status === "finished") throw new Error("Cette partie est terminée.");

      const myToken = getPlayerToken();
      const players = await getMatchPlayers(match.id);
      const already = players.find(p => p.player_token === myToken);
      if (!already && players.length >= 2) throw new Error("Cette partie est complète.");

      savePlayerName(name);
      if (!already) {
        const slot = players.length === 0 ? 1 : 2;
        await joinMatch(match.id, name, slot, authUserId ?? null);
      }
      onJoined(clean);
    } catch (e) {
      console.error(e);
      setErrorMsg(e.message || "Erreur en rejoignant.");
      setJoining(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} disabled={joining} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: joining ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none", opacity: joining ? 0.5 : 1 }}>← Menu</button>
      </header>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Rejoindre</div>
        <h2 style={{ fontWeight: 800, fontSize: 32, margin: 0, letterSpacing: -1.2, lineHeight: 1, color: C.ink }}>Rejoindre une partie</h2>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 10 }}>Ton pseudo</div>
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Mathieu, Kévin…" maxLength={20} disabled={joining}
          style={{ width: "100%", boxSizing: "border-box", background: C.cardBg, border: `1px solid ${C.hairline}`,
            outline: "none", borderRadius: 14, padding: "12px 16px",
            fontSize: 16, fontFamily: "inherit", color: C.ink, fontWeight: 600 }} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 10 }}>Code de la partie</div>
        <input value={formatMatchCode(code.replace(/\D/g, ""))}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000 000" inputMode="numeric" maxLength={7} disabled={joining}
          style={{ width: "100%", boxSizing: "border-box", background: C.cardBg, border: `1px solid ${C.hairline}`,
            outline: "none", borderRadius: 14, padding: "16px 20px",
            fontSize: 26, fontFamily: "inherit", color: C.ink, fontWeight: 800,
            letterSpacing: 4, textAlign: "center",
            fontVariantNumeric: "tabular-nums" }} />
      </div>

      {errorMsg && (
        <div style={{ ...glassDark, borderRadius: 14, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      <button onClick={handleJoin} disabled={joining || !playerName.trim() || code.replace(/\D/g, "").length !== 6}
        style={{ ...glassDark, borderRadius: 999, padding: "14px 22px",
          fontSize: 13, letterSpacing: 1.3, textTransform: "uppercase",
          cursor: (joining || !playerName.trim() || code.replace(/\D/g, "").length !== 6) ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontWeight: 700,
          border: "none", width: "100%",
          opacity: (joining || !playerName.trim() || code.replace(/\D/g, "").length !== 6) ? 0.4 : 1 }}>
        {joining ? "Connexion…" : "Rejoindre"}
      </button>
    </div>
  );
}

function VersusLobbyScreen({ code, onBack, onStartGame, versusPrefs, setVersusPrefs, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [match, setMatch] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(null);
  const [shareStatus, setShareStatus] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  // États pour le défi affiché dans le lobby (mode standard)
  const [defiWorks, setDefiWorks] = useState({ start: null, end: null });
  const [refreshing, setRefreshing] = useState(null); // null | "start" | "end" | "both"
  const [togglingReady, setTogglingReady] = useState(false);
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1 | 0
  const startedRef = useRef(false);
  const matchToStartRef = useRef(null);
  // États pour le mode sur-mesure : recherche/choix du film de mon rôle (départ ou arrivée, tiré au hasard)
  const [pickSearch, setPickSearch] = useState("");
  const [pickSearchResults, setPickSearchResults] = useState([]);
  const [pickSearching, setPickSearching] = useState(false);
  const [pickSaving, setPickSaving] = useState(false);
  const [myPickWork, setMyPickWork] = useState(null);
  const [opponentPickWork, setOpponentPickWork] = useState(null);
  // Pseudo éditable (créateur uniquement)
  const [pseudoInput, setPseudoInput] = useState("");

  const myToken = useMemo(() => getPlayerToken(), []);
  const me = players.find(p => p.player_token === myToken);
  const opponent = players.find(p => p.player_token !== myToken);
  const iAmCreator = me?.slot === 1;
  const bothReady = players.length === 2;
  const pendingChange = match?.pending_change || null;
  const mySlot = me?.slot;
  const opponentName = opponent?.player_name || "Adversaire";
  const locked = countdown !== null;

  // Mode sur-mesure : rôle tiré au hasard (qui choisit le départ, qui choisit l'arrivée)
  const isPickingPhase = !!match?.custom_mode && pendingChange?.phase === "picking";
  const myRole = isPickingPhase
    ? (pendingChange.startSlot === mySlot ? "startPick" : pendingChange.endSlot === mySlot ? "endPick" : null)
    : null;
  const opponentRole = myRole === "startPick" ? "endPick" : myRole === "endPick" ? "startPick" : null;
  const myPick = myRole ? pendingChange?.[myRole] : null;
  const opponentPick = opponentRole ? pendingChange?.[opponentRole] : null;

  // Mode standard : défi "vierge" tant que personne n'a tiré de film (placeholder start === end)
  const noDefiYet = !match?.custom_mode && match?.start_id != null &&
    match.start_id === match.end_id && match.start_type === match.end_type;
  // "OK pour moi" : utilisé en standard (sur le défi affiché) ET en sur-mesure (une fois les 2 films choisis)
  const readySlots = pendingChange?.readySlots || [];
  const iAmReady = !!mySlot && readySlots.includes(mySlot);
  const opponentReady = !!opponent && readySlots.includes(opponent.slot);
  const bothPicked = !!(pendingChange?.startPick && pendingChange?.endPick);

  // Charge initial + subscribe realtime
  useEffect(() => {
    let cancelled = false;
    let channel = null;

    (async () => {
      try {
        const m = await getMatchByCode(code);
        if (cancelled) return;
        if (!m) { setError("Partie introuvable."); return; }
        setMatch(m);
        const ps = await getMatchPlayers(m.id);
        if (cancelled) return;
        setPlayers(ps);

        // Realtime : écoute les changements sur match_players et matches
        channel = supabase.channel(`match-${m.id}`)
          .on("postgres_changes", {
            event: "*", schema: "public", table: "match_players",
            filter: `match_id=eq.${m.id}`,
          }, () => {
            getMatchPlayers(m.id).then(p => { if (!cancelled) setPlayers(p); });
          })
          .on("postgres_changes", {
            event: "UPDATE", schema: "public", table: "matches",
            filter: `id=eq.${m.id}`,
          }, (payload) => {
            if (!cancelled) setMatch(payload.new);
          })
          .subscribe();
      } catch (e) {
        if (!cancelled) setError("Erreur de chargement.");
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [code]);

  // Pseudo : seed depuis le nom enregistré en DB pour le créateur
  useEffect(() => {
    if (me?.player_name != null) setPseudoInput(me.player_name);
  }, [me?.player_name]);

  // Pseudo : sync live vers la DB (debounce), créateur uniquement
  useEffect(() => {
    if (!iAmCreator || !me) return;
    const trimmed = pseudoInput.trim();
    if (!trimmed || trimmed === me.player_name) return;
    const handle = setTimeout(async () => {
      try {
        await updatePlayerName(me.id, trimmed);
        savePlayerName(trimmed);
      } catch (e) { console.error(e); }
    }, 600);
    return () => clearTimeout(handle);
  }, [pseudoInput, iAmCreator, me?.id, me?.player_name]);

  // Mode sur-mesure : dès que les 2 joueurs sont là pour une manche fraîche (pas de pending_change),
  // tire au hasard qui choisit le départ et qui choisit l'arrivée. Claim atomique : premier arrivé gagne,
  // l'autre reçoit le résultat via l'écho realtime.
  useEffect(() => {
    if (!match?.custom_mode || !bothReady || match.status !== "waiting" || match.pending_change) return;
    let cancelled = false;
    (async () => {
      const startSlot = Math.random() < 0.5 ? 1 : 2;
      const endSlot = startSlot === 1 ? 2 : 1;
      const { data } = await supabase
        .from("matches")
        .update({ pending_change: { phase: "picking", startSlot, endSlot } })
        .eq("id", match.id)
        .is("pending_change", null)
        .select();
      if (!cancelled && data && data.length > 0) setMatch(data[0]);
    })();
    return () => { cancelled = true; };
  }, [match?.custom_mode, bothReady, match?.status, match?.pending_change, match?.id]);

  // Mode sur-mesure : recherche de film pour le joueur en train de choisir son rôle (départ ou arrivée)
  useEffect(() => {
    if (!myRole || myPick) { setPickSearchResults([]); return; }
    if (!pickSearch || pickSearch.trim().length < 2) { setPickSearchResults([]); return; }
    const handle = setTimeout(async () => {
      setPickSearching(true);
      try { setPickSearchResults(await searchMovies(pickSearch, 20)); }
      catch (e) { console.error(e); }
      finally { setPickSearching(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [pickSearch, myRole, myPick]);

  // Mode sur-mesure : fetch l'affiche de mon propre choix (pending_change ne stocke que id/type,
  // il faut re-fetch le titre/affiche pour l'afficher correctement)
  useEffect(() => {
    if (!myPick?.id) { setMyPickWork(null); return; }
    let cancelled = false;
    getWorksByPairs([{ id: myPick.id, type: myPick.type }])
      .then(works => { if (!cancelled && works[0]) setMyPickWork(works[0]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [myPick?.id, myPick?.type]);

  // Mode sur-mesure : fetch l'affiche du film choisi par l'adversaire (pour l'afficher flouté)
  useEffect(() => {
    if (!opponentPick?.id) { setOpponentPickWork(null); return; }
    let cancelled = false;
    getWorksByPairs([{ id: opponentPick.id, type: opponentPick.type }])
      .then(works => { if (!cancelled && works[0]) setOpponentPickWork(works[0]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [opponentPick?.id, opponentPick?.type]);

  // Charge les œuvres du défi standard pour affichage, dès qu'un vrai défi existe (pas le placeholder vierge).
  useEffect(() => {
    if (!match?.start_id || !match?.end_id || !bothReady || match?.custom_mode) return;
    let cancelled = false;
    getWorksByPairs([
      { id: match.start_id, type: match.start_type },
      { id: match.end_id,   type: match.end_type   },
    ]).then(works => {
      if (!cancelled) setDefiWorks({ start: works[0], end: works[1] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [match?.start_id, match?.start_type, match?.end_id, match?.end_type, bothReady]);

  // Auto-start : dès que le défi est validé par les 2 joueurs (OK pour moi des 2 côtés, après
  // avoir choisi le défi standard ou les films en sur-mesure), n'importe quel client lance la partie.
  // Claim atomique dans startMatch (WHERE status='waiting') : un seul lancement effectif.
  useEffect(() => {
    if (!match || match.status !== "waiting") return;
    const pc = match.pending_change;
    const rs = pc?.readySlots || [];
    const bothOk = rs.includes(1) && rs.includes(2);
    let ready = false, customStart = null, customEnd = null;
    if (match.custom_mode) {
      if (pc?.startPick && pc?.endPick && bothOk) { ready = true; customStart = pc.startPick; customEnd = pc.endPick; }
    } else {
      const hasDefi = match.start_id !== match.end_id || match.start_type !== match.end_type;
      ready = hasDefi && bothOk;
    }
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try { await startMatch(match.id, match.victory_condition || "hybrid", customStart, customEnd); }
      catch (e) { console.error(e); }
    })();
    return () => { cancelled = true; };
  }, [match?.custom_mode, match?.pending_change, match?.status, match?.start_id, match?.start_type, match?.end_id, match?.end_type, match?.victory_condition, match?.id]);

  // Auto-démarre le jeu quand le match passe en "playing"
  // (déclenché côté local par l'effet auto-start, côté distant par l'echo realtime)
  useEffect(() => {
    if (!match) return;
    if (match.status !== "playing") return;
    if (startedRef.current) return;
    startedRef.current = true;
    matchToStartRef.current = match;
    setCountdown(3);
  }, [match?.status]);

  // Décompte avant le lancement
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { onStartGame(matchToStartRef.current); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, onStartGame]);

  // Mode sur-mesure : j'enregistre mon choix de film (départ ou arrivée selon mon rôle tiré au hasard)
  async function handleSelectPick(film) {
    if (!myRole || myPick || pickSaving) return;
    setPickSaving(true);
    try {
      await saveCustomPick(match.id, match.pending_change, myRole, film);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'enregistrement du choix.");
    } finally {
      setPickSaving(false);
    }
  }

  // Mode standard : applique un nouveau défi (un film ou les deux) — n'importe quel joueur peut le faire
  // à tout moment, ça remet les 2 "OK pour moi" à zéro.
  async function handleRefreshDefi(target) {
    if (!match || refreshing) return;
    setRefreshing(target);
    try {
      const result = await generateNewDefi({
        currentStart: defiWorks.start,
        currentEnd: defiWorks.end,
        target,
        versusPrefs,
      });
      await applyNewDefi(match.id, result);
    } catch (e) {
      console.error(e);
      setError(e.message || "Aucun film trouvé.");
    } finally {
      setRefreshing(null);
    }
  }

  // Mode standard : bascule librement mon "OK pour moi" sur le défi en cours
  async function handleToggleReady() {
    if (!match || !mySlot || togglingReady) return;
    setTogglingReady(true);
    try {
      await setReadySlot(match.id, match.pending_change, mySlot, !iAmReady);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur.");
    } finally {
      setTogglingReady(false);
    }
  }

  async function handleSetVictoryCondition(key) {
    if (!match || locked || match.victory_condition === key) return;
    try { await setMatchVictoryCondition(match.id, key); }
    catch (e) { console.error(e); setError(e.message); }
  }

  async function handleToggleCustomMode(nextCustomMode) {
    if (!match || locked || !!match.custom_mode === nextCustomMode) return;
    try { await resetMatchDefi(match.id, nextCustomMode); }
    catch (e) { console.error(e); setError(e.message); }
  }

  const shareUrl = `${window.location.origin}${window.location.pathname}?versus=${code}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareStatus("link");
      setTimeout(() => setShareStatus(null), 2000);
    });
  }
  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setShareStatus("code");
      setTimeout(() => setShareStatus(null), 2000);
    });
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
        </header>
        <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8, color: C.ink }}>Erreur</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
        <Spinner label="Connexion à la partie…" themeColors={C} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} disabled={locked} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: locked ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none", opacity: locked ? 0.5 : 1 }}>← Quitter</button>
      </header>

      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Salon</div>
        <h2 style={{ fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: -1, lineHeight: 1.1, color: C.ink }}>
          {bothReady ? "Prêt à jouer !" : <>En attente du joueur 2<AnimatedDots /></>}
        </h2>
      </div>

      {/* Pseudo (créateur uniquement) */}
      {iAmCreator && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 8, fontWeight: 600 }}>Ton pseudo</div>
          <input value={pseudoInput} onChange={(e) => setPseudoInput(e.target.value)} maxLength={20} disabled={locked}
            style={{ width: "100%", boxSizing: "border-box", background: C.cardBg, border: `1px solid ${C.hairline}`,
              outline: "none", borderRadius: 14, padding: "12px 16px",
              fontSize: 16, fontFamily: "inherit", color: C.ink, fontWeight: 600 }} />
        </div>
      )}

      {/* Code à partager */}
      {iAmCreator && !bothReady && (
        <div style={{ ...glass, borderRadius: 22, padding: 24, marginBottom: 20, textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 12, fontWeight: 600 }}>Code à partager</div>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 8, color: C.ink, fontVariantNumeric: "tabular-nums", marginBottom: 16 }}>
            {formatMatchCode(code)}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={copyCode}
              style={{ ...glass, borderRadius: 999, padding: "9px 16px", cursor: "pointer",
                fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
                color: shareStatus === "code" ? C.green : C.ink, fontWeight: 600, border: `1px solid ${C.hairline}` }}>
              {shareStatus === "code" ? "✓ Copié" : "Copier le code"}
            </button>
            <button onClick={copyLink}
              style={{ ...glassDark, borderRadius: 999, padding: "9px 16px", cursor: "pointer",
                fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
                color: shareStatus === "link" ? C.green : C.glassDarkInk, fontWeight: 700, border: "none" }}>
              {shareStatus === "link" ? "✓ Lien copié" : "Copier le lien"}
            </button>
          </div>
        </div>
      )}

      {/* Liste joueurs */}
      <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 14, fontWeight: 600 }}>Joueurs</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PlayerRow
            slot={1} name={players.find(p => p.slot === 1)?.player_name}
            isMe={me?.slot === 1}
            themeColors={C} />
          <PlayerRow
            slot={2} name={players.find(p => p.slot === 2)?.player_name}
            isMe={me?.slot === 2}
            themeColors={C} />
        </div>
      </div>

      {/* Réglages de la partie (créateur uniquement) : condition de victoire, type de partie, mode, difficulté, options */}
      {iAmCreator && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>Condition de victoire</div>
            <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
              {[{ key: "time", label: "Temps" }, { key: "hybrid", label: "Étapes" }].map(({ key, label }) => {
                const active = (match.victory_condition || "hybrid") === key;
                return (
                  <button key={key} onClick={() => handleSetVictoryCondition(key)} disabled={locked}
                    style={{ flex: 1, padding: "9px 6px", borderRadius: 999, border: "none",
                      background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                      letterSpacing: 0.5, textTransform: "uppercase",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.6 : 1 }}>{label}</button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>Type de partie</div>
            <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
              {[{ key: true, label: "Sur-mesure" }, { key: false, label: "Standard" }].map(({ key, label }) => {
                const active = !!match.custom_mode === key;
                return (
                  <button key={String(key)} onClick={() => handleToggleCustomMode(key)} disabled={locked}
                    style={{ flex: 1, padding: "9px 6px", borderRadius: 999, border: "none",
                      background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                      letterSpacing: 0.5, textTransform: "uppercase",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.6 : 1 }}>{label}</button>
                );
              })}
            </div>
          </div>

          {!match.custom_mode && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>Mode</div>
                <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
                  {Object.entries(MODES).map(([key, m]) => {
                    const active = versusPrefs.mode === key;
                    return (
                      <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, mode: key }))} disabled={locked}
                        style={{ flex: 1, padding: "9px 6px", borderRadius: 999, border: "none",
                          background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                          fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                          letterSpacing: 0.5, textTransform: "uppercase",
                          cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.6 : 1 }}>{m.label}</button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>Difficulté</div>
                <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
                  {Object.entries(DIFFICULTIES).map(([key, d]) => {
                    const active = versusPrefs.difficulty === key;
                    return (
                      <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, difficulty: key }))} disabled={locked}
                        style={{ flex: 1, padding: "8px 4px", borderRadius: 999, border: "none",
                          background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                          fontFamily: "inherit", fontSize: 10, fontWeight: 600,
                          letterSpacing: 0.4, textTransform: "uppercase",
                          cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.6 : 1 }}>{d.label}</button>
                    );
                  })}
                </div>
              </div>

              <button onClick={() => setShowFilters(s => !s)} disabled={locked}
                style={{ ...glass, borderRadius: 999, padding: "10px 18px", border: "none",
                  width: "100%", cursor: locked ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  color: C.ink, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
                  opacity: locked ? 0.5 : 1 }}>
                <span>Options du défi</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: showFilters ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {showFilters && (
                <div style={{ marginTop: 8 }}>
                  <VersusFiltersPanel
                    versusPrefs={versusPrefs} setVersusPrefs={setVersusPrefs}
                    disabled={locked} themeColors={C} glass={glass} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Défi : mode standard (affiches + OK pour moi) ou sur-mesure (choix symétrique) */}
      <div style={{ ...glass, borderRadius: 22, padding: "20px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 16, fontWeight: 600, textAlign: "center" }}>
          {match?.custom_mode ? "Partie sur-mesure" : "Le défi"}
        </div>

        {match?.custom_mode ? (
          /* UI sur-mesure : choix symétrique, rôle (départ/arrivée) tiré au hasard */
          !bothReady ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: C.inkMute, fontSize: 13 }}>
              Les rôles seront tirés au hasard quand l'adversaire rejoindra.
            </div>
          ) : !isPickingPhase ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: C.inkMute, fontSize: 13 }}>
              <AnimatedDots />Tirage des rôles
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, marginBottom: 8, fontWeight: 600 }}>
                  Ton film
                </div>
                {myPick ? (
                  myPickWork ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Poster movie={myPickWork} size={44} rounded={6} themeColors={C} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{myPickWork.title}</div>
                        <div style={{ fontSize: 11, color: C.inkMute }}>{myPickWork.year}</div>
                      </div>
                      <button onClick={async () => {
                        try { await clearCustomPick(match.id, match.pending_change, myRole); }
                        catch (e) { console.error(e); }
                      }}
                        style={{ background: "none", border: `1px solid ${C.hairline}`, borderRadius: 99,
                          padding: "5px 12px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                          color: C.inkSoft, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                        Modifier
                      </button>
                    </div>
                  ) : <Spinner label="Chargement…" themeColors={C} />
                ) : (
                  <>
                    <div style={{ ...glass, borderRadius: 12, padding: 6, marginBottom: 6 }}>
                      <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)}
                        placeholder="Rechercher un film ou une série…"
                        style={{ width: "100%", background: "transparent", border: "none", outline: "none",
                          padding: "8px 10px", fontSize: 14, fontFamily: "inherit", color: C.ink, fontWeight: 500 }} />
                    </div>
                    {pickSearch.length >= 2 && (
                      <div style={{ ...glass, borderRadius: 12, padding: 6, maxHeight: 240, overflowY: "auto" }}>
                        {pickSearching && <Spinner label="Recherche" themeColors={C} />}
                        {!pickSearching && pickSearchResults.length === 0 && (
                          <div style={{ padding: 16, fontSize: 13, color: C.inkSoft, textAlign: "center" }}>Aucun résultat.</div>
                        )}
                        {!pickSearching && pickSearchResults.map(m => (
                          <button key={`${m.id}:${m.type}`}
                            onClick={() => { setPickSearch(""); handleSelectPick(m); }}
                            disabled={pickSaving}
                            style={{ background: C.cardBg2, border: "none", padding: "8px 10px", textAlign: "left",
                              cursor: pickSaving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 10,
                              fontFamily: "inherit", borderRadius: 10, width: "100%" }}>
                            <Poster movie={m} size={32} rounded={5} themeColors={C} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                              <div style={{ fontSize: 10, color: C.inkMute }}>{m.year}{isTv(m) ? " · série" : ""}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {pickSaving && (
                      <div style={{ fontSize: 12, color: C.inkMute, fontWeight: 600, marginTop: 6 }}>Enregistrement<AnimatedDots /></div>
                    )}
                  </>
                )}
              </div>
              <div style={{ height: 1, background: C.hairline }} />
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: C.inkSoft, marginBottom: 8, fontWeight: 600 }}>
                  Film de {opponentName}
                </div>
                {!opponentPick ? (
                  <div style={{ fontSize: 13, color: C.inkMute }}><AnimatedDots />En attente du choix</div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ position: "relative", width: 44, height: 66, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                      <div style={{ position: "absolute", inset: 0, filter: "blur(9px)", transform: "scale(1.2)" }}>
                        <Poster movie={opponentPickWork || opponentPick} size={44} rounded={6} themeColors={C} />
                      </div>
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 22, fontWeight: 800, color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>?</div>
                    </div>
                    <div style={{ flex: 1, userSelect: "none" }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, filter: "blur(4px)" }}>Titre mystère</div>
                      <div style={{ fontSize: 11, color: C.inkMute, filter: "blur(4px)" }}>20XX</div>
                    </div>
                  </div>
                )}
              </div>

              {bothPicked && (
                <>
                  <div style={{ height: 1, background: C.hairline }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <button onClick={handleToggleReady} disabled={togglingReady}
                      style={{ ...(iAmReady ? glassDark : glass), borderRadius: 999, padding: "10px 18px",
                        border: iAmReady ? "none" : `1px solid ${C.hairline}`,
                        fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                        cursor: togglingReady ? "not-allowed" : "pointer", opacity: togglingReady ? 0.6 : 1 }}>
                      {iAmReady ? "✓ OK pour moi" : "OK pour moi"}
                    </button>
                    <div style={{ fontSize: 12, color: opponentReady ? C.green : C.inkMute, fontWeight: 600 }}>
                      {opponentReady ? <>✓ {opponentName} est prêt</> : <>{opponentName}<AnimatedDots /></>}
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11, color: C.inkMute, marginTop: 4 }}>
                    La partie démarre automatiquement dès que vous êtes prêts tous les deux.
                  </div>
                </>
              )}
            </div>
          )
        ) : (
          /* UI mode standard */
          !bothReady ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: C.inkMute, fontSize: 13 }}>
              Les affiches seront révélées quand l'adversaire rejoindra.
            </div>
          ) : noDefiYet ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 13, color: C.inkMute, marginBottom: 14 }}>Aucun défi pour l'instant.</div>
              <button onClick={() => handleRefreshDefi("both")} disabled={!!refreshing}
                style={{ ...glassDark, borderRadius: 999, padding: "12px 20px", border: "none",
                  fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  cursor: refreshing ? "not-allowed" : "pointer", opacity: refreshing ? 0.6 : 1 }}>
                {refreshing === "both" ? <>Recherche<AnimatedDots /></> : "Tirer un défi aléatoire"}
              </button>
            </div>
          ) : !defiWorks.start || !defiWorks.end ? (
            <Spinner label="Chargement du défi…" themeColors={C} />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <LobbyDefiSide label="Départ" movie={defiWorks.start} align="left"
                  onRefresh={() => handleRefreshDefi("start")}
                  refreshing={refreshing === "start"} disabledAll={!!refreshing} themeColors={C} />
                <div style={{ flex: 1, height: 1, background: C.hairline, marginTop: 56 }} />
                <LobbyDefiSide label="Arrivée" movie={defiWorks.end} align="right"
                  onRefresh={() => handleRefreshDefi("end")}
                  refreshing={refreshing === "end"} disabledAll={!!refreshing} themeColors={C} />
              </div>
              <button onClick={() => handleRefreshDefi("both")} disabled={!!refreshing}
                style={{ ...glass, borderRadius: 999, padding: "10px 16px",
                  border: `1px solid ${C.hairline}`, width: "100%", marginTop: 16,
                  fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
                  cursor: refreshing ? "not-allowed" : "pointer", fontFamily: "inherit",
                  color: C.ink, fontWeight: 700, opacity: refreshing ? 0.5 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {refreshing === "both" ? <>Recherche<AnimatedDots /></> : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>Nouveau défi</>
                )}
              </button>

              <div style={{ height: 1, background: C.hairline, margin: "16px 0" }} />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <button onClick={handleToggleReady} disabled={togglingReady}
                  style={{ ...(iAmReady ? glassDark : glass), borderRadius: 999, padding: "10px 18px",
                    border: iAmReady ? "none" : `1px solid ${C.hairline}`,
                    fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                    cursor: togglingReady ? "not-allowed" : "pointer", opacity: togglingReady ? 0.6 : 1 }}>
                  {iAmReady ? "✓ OK pour moi" : "OK pour moi"}
                </button>
                <div style={{ fontSize: 12, color: opponentReady ? C.green : C.inkMute, fontWeight: 600 }}>
                  {opponentReady ? <>✓ {opponentName} est prêt</> : <>{opponentName}<AnimatedDots /></>}
                </div>
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: C.inkMute, marginTop: 12 }}>
                La partie démarre automatiquement dès que vous êtes prêts tous les deux.
              </div>
            </>
          )
        )}
      </div>

      {!bothReady && (
        <div style={{ textAlign: "center", fontSize: 12, color: C.inkMute, fontWeight: 500, padding: "12px 0" }}>
          {iAmCreator
            ? "Partage le code ou le lien à ton ami."
            : <>Partie créée. Attendons le démarrage<AnimatedDots /></>}
        </div>
      )}

      {countdown !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200,
          background: C.bg, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: countdown === 0 ? 96 : 144, fontWeight: 900,
            color: countdown === 0 ? C.green : C.ink, letterSpacing: -6,
            lineHeight: 1, fontVariantNumeric: "tabular-nums",
            transition: "color 0.15s" }}>
            {countdown === 0 ? "GO !" : countdown}
          </div>
        </div>
      )}
    </div>
  );
}

// Affiche une "moitié" du défi (Départ ou Arrivée) avec son affiche + bouton 🔄
function LobbyDefiSide({ label, movie, align, onRefresh, refreshing, disabledAll, themeColors }) {
  const C = themeColors;
  return (
    <div style={{ textAlign: align, maxWidth: 130, display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <Poster movie={movie} size={80} rounded={10} themeColors={C} />
        {onRefresh && (
          <button onClick={onRefresh} disabled={disabledAll} title={`Proposer un nouveau ${label.toLowerCase()}`}
            style={{ position: "absolute", top: -6, [align === "right" ? "left" : "right"]: -6,
              width: 26, height: 26, borderRadius: "50%",
              background: refreshing ? C.versusMe : C.ink, color: C.bg,
              border: `2px solid ${C.bg}`,
              cursor: disabledAll ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit", padding: 0,
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              opacity: disabledAll && !refreshing ? 0.35 : 1,
              transition: "transform .15s" }}>
            {refreshing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "fil-spin 1s linear infinite" }}>
                <style>{`@keyframes fil-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            )}
          </button>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.15, letterSpacing: -0.4, color: C.ink, marginTop: 8 }}>{movie.title}</div>
      <div style={{ fontSize: 11, color: C.inkMute, marginTop: 2, fontWeight: 500 }}>{movie.year}</div>
      {isTv(movie) && <TvLabel themeColors={C} />}
    </div>
  );
}


function PlayerRow({ slot, name, isMe, themeColors }) {
  const C = themeColors;
  const ready = !!name;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <WaitingDot active={ready} activeColor={C.green} idleColor={C.inkMute} size={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: ready ? C.ink : C.inkMute,
          letterSpacing: -0.3, fontStyle: ready ? "normal" : "italic" }}>
          {ready ? name : <>En attente<AnimatedDots /></>}
          {isMe && ready && <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
            color: C.inkSoft, marginLeft: 10, fontWeight: 600 }}>· toi</span>}
        </div>
        <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
          color: C.inkMute, fontWeight: 500, marginTop: 2 }}>
          Joueur {slot}
        </div>
      </div>
    </div>
  );
}

function PasswordResetScreen({ onDone, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirmPassword) { setError("Les mots de passe ne correspondent pas."); return; }
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(onDone, 1800);
  }

  const inputStyle = {
    width: "100%", boxSizing: "border-box", background: "transparent", border: `1px solid ${C.hairline}`,
    borderRadius: 12, padding: "13px 16px", fontFamily: "inherit", fontSize: 15, color: C.ink, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ ...glass, borderRadius: 22, padding: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Nouveau mot de passe</div>
        {done ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 14, color: C.green, fontWeight: 700 }}>Mot de passe mis à jour !</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            <div style={{ position: "relative" }}>
              <input type={showPassword ? "text" : "password"} placeholder="Nouveau mot de passe"
                value={password} onChange={e => setPassword(e.target.value)}
                required minLength={6} autoComplete="new-password"
                style={{ ...inputStyle, paddingRight: 46 }} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                <EyeIcon visible={showPassword} color={C.inkMute} />
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <input type={showPassword ? "text" : "password"} placeholder="Confirmer le mot de passe"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                required minLength={6} autoComplete="new-password"
                style={{ ...inputStyle, paddingRight: 46,
                  borderColor: confirmPassword && confirmPassword !== password ? RED : C.hairline }} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                <EyeIcon visible={showPassword} color={C.inkMute} />
              </button>
            </div>
            {error && <div style={{ fontSize: 12, color: RED, background: `${RED}18`, borderRadius: 8, padding: "9px 13px" }}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{ ...glassDark, width: "100%", borderRadius: 13, padding: "14px 0", border: "none",
                fontFamily: "inherit", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase",
                fontWeight: 800, cursor: loading ? "default" : "pointer", color: C.glassDarkInk,
                opacity: loading ? 0.6 : 1, marginTop: 4 }}>
              {loading ? "…" : "Enregistrer"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function AuthScreen({ onBack, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleForgot(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setForgotSent(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    if (mode === "register") {
      const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password });
      if (err) { setError(err.message); setLoading(false); return; }
      if (data?.session) {
        // Sauvegarde le username immédiatement si renseigné
        if (username.trim()) {
          await supabase.from("profiles").upsert(
            { id: data.user.id, username: username.trim() },
            { onConflict: "id" }
          ).catch(() => {});
        }
        // Navigation via SIGNED_IN dans onAuthStateChange
      } else {
        setDone(true);
        setLoading(false);
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(err.message); setLoading(false); return; }
      // Navigation via SIGNED_IN dans onAuthStateChange ; loading reste à true jusqu'au démontage
    }
  }

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "transparent", border: `1px solid ${C.hairline}`,
    borderRadius: 12, padding: "13px 16px", fontFamily: "inherit",
    fontSize: 15, color: C.ink, outline: "none",
  };
  const btnStyle = {
    ...glassDark, width: "100%", borderRadius: 13, padding: "14px 0", border: "none",
    fontFamily: "inherit", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase",
    fontWeight: 800, cursor: loading ? "default" : "pointer", color: C.glassDarkInk,
    opacity: loading ? 0.6 : 1,
  };

  if (done) {
    return (
      <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 420, margin: "0 auto" }}>
        <header style={{ marginBottom: 32 }}>
          <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
        </header>
        <div style={{ ...glass, borderRadius: 22, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>✉️</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 10 }}>Vérifie ta boîte mail</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.6 }}>
            Un lien de confirmation a été envoyé à <strong>{email}</strong>.<br/>
            Clique dessus pour activer ton compte.
          </div>
          <button onClick={() => { setDone(false); setMode("login"); }}
            style={{ ...btnStyle, marginTop: 24, width: "auto", padding: "11px 24px" }}>
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 420, margin: "0 auto" }}>
      <header style={{ marginBottom: 32 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>

      <div style={{ ...glass, borderRadius: 22, padding: 24 }}>
        {/* Toggle login / register */}
        <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 12, padding: 4, marginBottom: 24 }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null); setConfirmPassword(""); setUsername(""); setShowPassword(false); setForgotMode(false); setForgotSent(false); }}
              style={{ flex: 1, borderRadius: 9, padding: "9px 0", border: "none", fontFamily: "inherit",
                fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, cursor: "pointer",
                background: mode === m ? C.ink : "transparent", color: mode === m ? C.bg : C.inkSoft,
                transition: "background .15s, color .15s" }}>
              {m === "login" ? "Connexion" : "Inscription"}
            </button>
          ))}
        </div>

        {forgotMode ? (
          forgotSent ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>✉️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Email envoyé !</div>
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
                Clique sur le lien reçu à <strong>{email}</strong> pour définir un nouveau mot de passe.
              </div>
              <button onClick={() => { setForgotMode(false); setForgotSent(false); }}
                style={{ ...btnStyle, width: "auto", padding: "11px 24px" }}>Retour</button>
            </div>
          ) : (
            <form onSubmit={handleForgot} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 4 }}>
                Saisis ton email pour recevoir un lien de réinitialisation.
              </div>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                required autoComplete="email" style={inputStyle} />
              {error && <div style={{ fontSize: 12, color: RED, background: `${RED}18`, borderRadius: 8, padding: "9px 13px" }}>{error}</div>}
              <button type="submit" disabled={loading} style={{ ...btnStyle, marginTop: 4 }}>
                {loading ? "…" : "Envoyer le lien"}
              </button>
              <button type="button" onClick={() => { setForgotMode(false); setError(null); }}
                style={{ background: "none", border: "none", fontSize: 12, color: C.inkMute, cursor: "pointer", fontFamily: "inherit", padding: "4px 0" }}>
                ← Retour à la connexion
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" style={inputStyle} />
            {mode === "register" && (
              <input type="text" placeholder="Pseudo (affiché en jeu)" value={username}
                onChange={e => setUsername(e.target.value)} maxLength={20}
                autoComplete="username" style={inputStyle} />
            )}
            <div style={{ position: "relative" }}>
              <input type={showPassword ? "text" : "password"} placeholder="Mot de passe" value={password}
                onChange={e => setPassword(e.target.value)}
                required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{ ...inputStyle, paddingRight: 46 }} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                <EyeIcon visible={showPassword} color={C.inkMute} />
              </button>
            </div>
            {mode === "register" && (
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} placeholder="Confirmer le mot de passe"
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  required minLength={6} autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: 46,
                    borderColor: confirmPassword && confirmPassword !== password ? RED : C.hairline }} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                  <EyeIcon visible={showPassword} color={C.inkMute} />
                </button>
              </div>
            )}
            {error && (
              <div style={{ fontSize: 12, color: RED, background: `${RED}18`, borderRadius: 8, padding: "9px 13px" }}>{error}</div>
            )}
            <button type="submit" disabled={loading} style={{ ...btnStyle, marginTop: 4 }}>
              {loading ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>
            {mode === "login" && (
              <button type="button" onClick={() => { setForgotMode(true); setError(null); }}
                style={{ background: "none", border: "none", fontSize: 12, color: C.inkMute, cursor: "pointer",
                  fontFamily: "inherit", padding: "2px 0", textAlign: "center" }}>
                Mot de passe oublié ?
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

const LS_MIGRATED = "fil-migrated";

function AccountScreen({ onBack, onOpenAuth, onLogout, onProfileRefresh, themeColors, glass, glassDark, gamesPlayed, authUser, profile }) {
  const C = themeColors;
  const [playerName, setPlayerName] = useState(getStoredPlayerName);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const inputRef = useRef(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // Sécurité
  const [showSecurity, setShowSecurity] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleChangeEmail(e) {
    e.preventDefault();
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) { setEmailMsg({ ok: false, text: error.message }); return; }
    setEmailMsg({ ok: true, text: "Email mis à jour. Vérifie ta boîte mail si une confirmation est requise." });
    setNewEmail("");
  }
  async function handleChangePwd(e) {
    e.preventDefault();
    if (newPwd !== confirmPwd) { setPwdMsg({ ok: false, text: "Les mots de passe ne correspondent pas." }); return; }
    setPwdMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    if (error) { setPwdMsg({ ok: false, text: error.message }); return; }
    setPwdMsg({ ok: true, text: "Mot de passe mis à jour !" });
    setNewPwd(""); setConfirmPwd("");
  }
  async function handleDeleteAccount() {
    if (deleteConfirm !== "SUPPRIMER") return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) { setDeleting(false); alert("Erreur : " + error.message); return; }
    await supabase.auth.signOut();
    onLogout?.();
  }

  // Propose migration si connecté + données locales + pas encore migré
  useEffect(() => {
    if (!authUser || !profile) return;
    const alreadyDone = localStorage.getItem(LS_MIGRATED) === "1";
    if (alreadyDone) return;
    const hasLocalData = loadGamesPlayed() > 0 || loadVersusWins() > 0 || loadVersusLosses() > 0;
    if (hasLocalData) setShowMigrate(true);
  }, [authUser, profile]);

  async function handleMigrate() {
    setMigrating(true);
    await supabase.from("profiles").update({
      solo_games:      loadSoloDiff("easy") + loadSoloDiff("medium") + loadSoloDiff("hard") + loadSoloAbandons(),
      solo_easy:       loadSoloDiff("easy"),
      solo_medium:     loadSoloDiff("medium"),
      solo_hard:       loadSoloDiff("hard"),
      solo_optimal:    loadSoloOptimal(),
      solo_abandons:   loadSoloAbandons(),
      solo_hints:      loadSoloHints(),
      best_score:      loadBestSteps(),
      versus_wins:     loadVersusWins(),
      versus_losses:   loadVersusLosses(),
      versus_optimal:  loadVersusOptimal(),
      versus_hints:    loadVersusHints(),
      username:        getStoredPlayerName() || profile?.username || null,
    }).eq("id", authUser.id);
    localStorage.setItem(LS_MIGRATED, "1");
    setShowMigrate(false);
    setMigrating(false);
    onProfileRefresh?.();
  }

  // Stats : DB si connecté, localStorage sinon
  const isLoggedIn = !!authUser && !!profile;
  const bestSteps     = isLoggedIn ? (profile.best_score || 0)      : loadBestSteps();
  const soloEasy      = isLoggedIn ? (profile.solo_easy || 0)       : loadSoloDiff("easy");
  const soloMedium    = isLoggedIn ? (profile.solo_medium || 0)     : loadSoloDiff("medium");
  const soloHard      = isLoggedIn ? (profile.solo_hard || 0)       : loadSoloDiff("hard");
  const soloOptimal   = isLoggedIn ? (profile.solo_optimal || 0)    : loadSoloOptimal();
  const soloAbandons  = isLoggedIn ? (profile.solo_abandons || 0)   : loadSoloAbandons();
  const soloHints     = isLoggedIn ? (profile.solo_hints || 0)      : loadSoloHints();
  const versusWins    = isLoggedIn ? (profile.versus_wins || 0)     : loadVersusWins();
  const versusLosses  = isLoggedIn ? (profile.versus_losses || 0)   : loadVersusLosses();
  const versusOptimal = isLoggedIn ? (profile.versus_optimal || 0)  : loadVersusOptimal();
  const versusHints   = isLoggedIn ? (profile.versus_hints || 0)    : loadVersusHints();
  const displayName   = isLoggedIn ? (profile.username || authUser.email) : playerName;

  function startEdit() {
    setNameInput(isLoggedIn ? (profile.username || "") : playerName);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }
  async function confirmEdit() {
    const n = nameInput.trim();
    if (n) {
      if (isLoggedIn) {
        await supabase.from("profiles").update({ username: n }).eq("id", authUser.id);
        onProfileRefresh?.();
      } else {
        savePlayerName(n);
        setPlayerName(n);
      }
    }
    setEditing(false);
  }
  function handleKeyDown(e) {
    if (e.key === "Enter") confirmEdit();
    if (e.key === "Escape") setEditing(false);
  }

  const soloRank   = isLoggedIn ? getRankInfo(profile.solo_score   ?? 800,  SOLO_RANKS)   : null;
  const versusRank = isLoggedIn ? getRankInfo(profile.versus_elo ?? 0, VERSUS_RANKS) : null;

  const sectionLabel = { fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 14, fontWeight: 600 };
  const statRow = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.hairline}` };
  const statLabel = { fontSize: 13, color: C.inkSoft, fontWeight: 500 };
  const statValue = { fontSize: 16, fontWeight: 800, color: C.ink, letterSpacing: -0.5 };

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
      </header>

      {/* Popup migration localStorage → compte */}
      {showMigrate && (
        <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 16, border: `1px solid ${C.amber}40` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Importer tes stats locales ?</div>
          <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>
            Des stats sont enregistrées sur cet appareil. Tu veux les importer vers ton compte ?<br/>
            <span style={{ opacity: 0.7 }}>Les rangs Elo repartent de zéro (non calculables rétroactivement).</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleMigrate} disabled={migrating}
              style={{ ...glassDark, flex: 1, borderRadius: 10, padding: "10px 0", border: "none",
                fontFamily: "inherit", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
                fontWeight: 700, cursor: "pointer", color: C.glassDarkInk }}>
              {migrating ? "…" : "Importer"}
            </button>
            <button onClick={() => { localStorage.setItem(LS_MIGRATED, "1"); setShowMigrate(false); }}
              style={{ flex: 1, borderRadius: 10, padding: "10px 0", border: `1px solid ${C.hairline}`,
                fontFamily: "inherit", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
                fontWeight: 700, cursor: "pointer", background: "transparent", color: C.inkSoft }}>
              Non merci
            </button>
          </div>
        </div>
      )}

      {/* Pseudo + Compte côte à côte */}
      {editing ? (
        <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 16 }}>
          <div style={sectionLabel}>Pseudo Versus</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input ref={inputRef} value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={handleKeyDown} maxLength={20}
              style={{ flex: 1, background: "transparent", border: `1px solid ${C.hairline}`,
                borderRadius: 10, padding: "10px 14px", fontFamily: "inherit",
                fontSize: 15, fontWeight: 700, color: C.ink, outline: "none" }} />
            <button onClick={confirmEdit}
              style={{ ...glassDark, borderRadius: 10, padding: "10px 16px", border: "none",
                fontFamily: "inherit", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
                fontWeight: 700, cursor: "pointer", color: C.glassDarkInk, whiteSpace: "nowrap" }}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {/* Pseudo */}
          <div style={{ ...glass, borderRadius: 22, padding: 16, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 100 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, marginBottom: 8 }}>Pseudo</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, letterSpacing: -0.5, flex: 1, wordBreak: "break-word" }}>
              {displayName || <span style={{ color: C.inkMute, fontWeight: 500, fontSize: 13 }}>Non défini</span>}
            </div>
            <button onClick={startEdit}
              style={{ background: "transparent", border: `1px solid ${C.hairline}`, borderRadius: 999,
                padding: "6px 12px", fontFamily: "inherit", fontSize: 10, letterSpacing: 1.2,
                textTransform: "uppercase", fontWeight: 700, color: C.inkSoft, cursor: "pointer",
                marginTop: 12, alignSelf: "center" }}>
              Modifier
            </button>
          </div>
          {/* Compte */}
          <div style={{ ...glass, borderRadius: 22, padding: 16, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 100 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 600, marginBottom: 8 }}>Compte</div>
            <div style={{ fontSize: 12, color: C.inkSoft, flex: 1, wordBreak: "break-all" }}>
              {isLoggedIn ? authUser.email : <span style={{ color: C.inkMute }}>Non connecté</span>}
            </div>
            {isLoggedIn ? (
              <button onClick={onLogout}
                style={{ background: "transparent", border: `1px solid ${C.hairline}`, borderRadius: 999,
                  padding: "6px 12px", fontFamily: "inherit", fontSize: 10, letterSpacing: 1.2,
                  textTransform: "uppercase", fontWeight: 700, color: C.inkSoft, cursor: "pointer",
                  marginTop: 12, alignSelf: "center", whiteSpace: "nowrap", fontSize: 9 }}>
                Déconnexion
              </button>
            ) : (
              <button onClick={onOpenAuth}
                style={{ ...glassDark, borderRadius: 999, padding: "6px 12px", border: "none",
                  fontFamily: "inherit", fontSize: 10, letterSpacing: 1.2,
                  textTransform: "uppercase", fontWeight: 700, cursor: "pointer",
                  color: C.glassDarkInk, marginTop: 12, alignSelf: "center" }}>
                Connexion
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats Solo */}
      <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 16 }}>
        <div style={sectionLabel}>Solo</div>
        {soloRank && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: -0.5 }}>{soloRank.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft }}>{profile.solo_score ?? 800} pts</span>
            </div>
            <div style={{ height: 5, borderRadius: 99, background: C.hairline, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 99, background: C.ink,
                width: `${Math.round(soloRank.progress * 100)}%`, transition: "width .4s" }} />
            </div>
            {soloRank.nextMin && (
              <div style={{ fontSize: 10, color: C.inkMute, marginTop: 4, textAlign: "right" }}>
                {soloRank.nextMin - (profile.solo_score ?? 800)} pts pour {SOLO_RANKS.find(r => r.min === soloRank.nextMin)?.name}
              </div>
            )}
          </div>
        )}
        <div style={{ ...statRow, borderTop: `1px solid ${C.hairline}` }}>
          <span style={statLabel}>Parties solo</span>
          <span style={statValue}>{isLoggedIn ? (profile.solo_games || 0) : loadSoloDiff("easy") + loadSoloDiff("medium") + loadSoloDiff("hard") + loadSoloAbandons()}</span>
        </div>
        <div style={{ ...statRow, paddingLeft: 12 }}>
          <span style={{ ...statLabel, fontSize: 12, color: C.inkMute }}>Facile</span>
          <span style={{ ...statValue, fontSize: 14 }}>{soloEasy}</span>
        </div>
        <div style={{ ...statRow, paddingLeft: 12 }}>
          <span style={{ ...statLabel, fontSize: 12, color: C.inkMute }}>Moyen</span>
          <span style={{ ...statValue, fontSize: 14 }}>{soloMedium}</span>
        </div>
        <div style={{ ...statRow, paddingLeft: 12 }}>
          <span style={{ ...statLabel, fontSize: 12, color: C.inkMute }}>Difficile</span>
          <span style={{ ...statValue, fontSize: 14 }}>{soloHard}</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Meilleur score</span>
          <span style={statValue}>{bestSteps ? `${bestSteps} étape${bestSteps > 1 ? "s" : ""}` : "—"}</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Chemin optimal</span>
          <span style={statValue}>{soloOptimal} fois</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Abandons</span>
          <span style={{ ...statValue, color: C.amber }}>{soloAbandons}</span>
        </div>
        <div style={{ ...statRow, borderBottom: "none" }}>
          <span style={statLabel}>Indices utilisés</span>
          <span style={statValue}>{soloHints}</span>
        </div>
      </div>

      {/* Stats Versus */}
      <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 16 }}>
        <div style={sectionLabel}>Versus</div>
        {versusRank && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: -0.5 }}>{versusRank.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.inkSoft }}>{profile.versus_elo ?? 0} Elo</span>
            </div>
            <div style={{ height: 5, borderRadius: 99, background: C.hairline, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 99, background: C.versusMe,
                width: `${Math.round(versusRank.progress * 100)}%`, transition: "width .4s" }} />
            </div>
            {versusRank.nextMin && (
              <div style={{ fontSize: 10, color: C.inkMute, marginTop: 4, textAlign: "right" }}>
                {versusRank.nextMin - (profile.versus_elo ?? 0)} Elo pour {VERSUS_RANKS.find(r => r.min === versusRank.nextMin)?.name}
              </div>
            )}
          </div>
        )}
        <div style={{ ...statRow, borderTop: `1px solid ${C.hairline}` }}>
          <span style={statLabel}>Victoires</span>
          <span style={{ ...statValue, color: C.green }}>{versusWins}</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Défaites</span>
          <span style={{ ...statValue, color: C.amber }}>{versusLosses}</span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>Chemin optimal</span>
          <span style={statValue}>{versusOptimal} fois</span>
        </div>
        <div style={{ ...statRow, borderBottom: "none" }}>
          <span style={statLabel}>Indices utilisés</span>
          <span style={statValue}>{versusHints}</span>
        </div>
      </div>

      {isLoggedIn && (() => {
        const inputS = {
          width: "100%", boxSizing: "border-box", background: "transparent",
          border: `1px solid ${C.hairline}`, borderRadius: 10, padding: "11px 14px",
          fontFamily: "inherit", fontSize: 14, color: C.ink, outline: "none",
        };
        return (
          <>
            {/* Sécurité */}
            <div style={{ ...glass, borderRadius: 22, padding: 20, marginBottom: 16 }}>
              <button onClick={() => setShowSecurity(v => !v)}
                style={{ background: "none", border: "none", width: "100%", cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit" }}>
                <div style={sectionLabel}>Sécurité</div>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.inkMute} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: showSecurity ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s", flexShrink: 0, marginBottom: 14 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {showSecurity && <>
              {/* Changer l'email */}
              <form onSubmit={handleChangeEmail} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, marginBottom: 8 }}>Changer l'email</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="email" placeholder="Nouvel email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                    required style={{ ...inputS, flex: 1 }} />
                  <button type="submit"
                    style={{ ...glassDark, borderRadius: 10, padding: "0 16px", border: "none",
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      cursor: "pointer", color: C.glassDarkInk, whiteSpace: "nowrap" }}>
                    Enregistrer
                  </button>
                </div>
                {emailMsg && <div style={{ fontSize: 11, marginTop: 6, color: emailMsg.ok ? C.green : RED }}>{emailMsg.text}</div>}
              </form>
              <div style={{ height: 1, background: C.hairline, marginBottom: 16 }} />
              {/* Changer le mot de passe */}
              <form onSubmit={handleChangePwd}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, marginBottom: 8 }}>Changer le mot de passe</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ position: "relative" }}>
                    <input type={showNewPwd ? "text" : "password"} placeholder="Nouveau mot de passe"
                      value={newPwd} onChange={e => setNewPwd(e.target.value)}
                      required minLength={6} autoComplete="new-password"
                      style={{ ...inputS, paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowNewPwd(v => !v)}
                      style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                      <EyeIcon visible={showNewPwd} color={C.inkMute} size={16} />
                    </button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input type={showNewPwd ? "text" : "password"} placeholder="Confirmer"
                      value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                      required minLength={6} autoComplete="new-password"
                      style={{ ...inputS, paddingRight: 40,
                        borderColor: confirmPwd && confirmPwd !== newPwd ? RED : C.hairline }} />
                    <button type="button" onClick={() => setShowNewPwd(v => !v)}
                      style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                      <EyeIcon visible={showNewPwd} color={C.inkMute} size={16} />
                    </button>
                  </div>
                  <button type="submit"
                    style={{ ...glassDark, borderRadius: 10, padding: "10px 0", border: "none",
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      cursor: "pointer", color: C.glassDarkInk }}>
                    Enregistrer
                  </button>
                </div>
                {pwdMsg && <div style={{ fontSize: 11, marginTop: 6, color: pwdMsg.ok ? C.green : RED }}>{pwdMsg.text}</div>}
              </form>
              <div style={{ height: 1, background: `${RED}30`, margin: "16px 0" }} />
              {/* Zone dangereuse */}
              <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: RED, fontWeight: 600, marginBottom: 10 }}>Zone dangereuse</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
                Supprimer définitivement ton compte et toutes tes données. Cette action est irréversible.
              </div>
              <input placeholder='Tape "SUPPRIMER" pour confirmer' value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                style={{ ...inputS, marginBottom: 10, borderColor: `${RED}50` }} />
              <button onClick={handleDeleteAccount}
                disabled={deleteConfirm !== "SUPPRIMER" || deleting}
                style={{ width: "100%", borderRadius: 10, padding: "10px 0", border: "none",
                  fontFamily: "inherit", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                  cursor: deleteConfirm !== "SUPPRIMER" || deleting ? "not-allowed" : "pointer",
                  background: deleteConfirm === "SUPPRIMER" ? RED : C.hairline,
                  color: deleteConfirm === "SUPPRIMER" ? "#fff" : C.inkMute,
                  opacity: deleting ? 0.6 : 1 }}>
                {deleting ? "…" : "Supprimer mon compte"}
              </button>
              </>}
            </div>
          </>
        );
      })()}

      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 2, color: C.inkMute, marginTop: 8, textTransform: "uppercase", fontWeight: 500 }}>
        {isLoggedIn ? "Stats synchronisées sur ton compte" : "Stats enregistrées sur cet appareil · Connecte-toi pour les sauvegarder"}
      </div>
    </div>
  );
}