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
const LS_PLAYER_TOKEN = "fil-player-token"; // Identifiant unique du joueur (anonyme, persistant)
const LS_PLAYER_NAME  = "fil-player-name";  // Pseudo réutilisé entre les parties Versus

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

async function createMatch({ startWork, endWork, optimalSteps, difficulty }) {
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

async function joinMatch(matchId, playerName, slot) {
  const token = getPlayerToken();

  // Si ce token a déjà rejoint ce match (refresh page), on retourne le joueur existant
  const { data: existing } = await supabase
    .from("match_players")
    .select("*")
    .eq("match_id", matchId)
    .eq("player_token", token)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("match_players")
    .insert({
      match_id: matchId,
      slot,
      player_name: playerName,
      player_token: token,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function startMatch(matchId) {
  const { data, error } = await supabase
    .from("matches")
    .update({ status: "playing", started_at: new Date().toISOString() })
    .eq("id", matchId)
    .select()
    .single();
  if (error) throw error;
  return data;
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

// Crée un nouveau match comme "revanche" du précédent, et marque l'ancien avec rematch_code
async function createRematch({ previousMatchId, startWork, endWork, optimalSteps, difficulty }) {
  const newMatch = await createMatch({ startWork, endWork, optimalSteps, difficulty });
  await supabase
    .from("matches")
    .update({ rematch_code: newMatch.code })
    .eq("id", previousMatchId);
  return newMatch;
}

// Régénère le défi d'un match existant (start/end/optimal_steps/difficulty) et lance la partie
// en un seul UPDATE atomique. Utilisé quand le créateur clique "Démarrer" depuis le lobby
// (les filtres du lobby ont pu changer entre la création initiale et le lancement).
async function regenerateAndStartMatch(matchId, prefs, difficulty) {
  const isRandomMode = difficulty === "random";
  let target = difficulty;
  if (isRandomMode) target = pickWeightedDifficulty();
  const targetRange = DIFFICULTIES[target]?.range;
  const forHard = target === "hard";

  let chosen = null;
  let lastAttempt = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { start, end } = await pickRandomPair(prefs, forHard);
    const optimal = await findOptimalPath(start, end, 5);
    if (!optimal || optimal.length < 3) continue;
    const steps = Math.floor((optimal.length - 1) / 2);
    lastAttempt = { start, end, steps };
    if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
      chosen = lastAttempt; break;
    }
  }
  if (!chosen) chosen = lastAttempt;
  if (!chosen) throw new Error("Aucun défi trouvé avec ces filtres.");

  // Single UPDATE atomique pour éviter les races avec les autres clients
  const { data, error } = await supabase
    .from("matches")
    .update({
      start_id: chosen.start.id, start_type: chosen.start.type,
      end_id: chosen.end.id, end_type: chosen.end.type,
      optimal_steps: chosen.steps, difficulty: target,
      status: "playing",
      started_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .select()
    .single();
  if (error) throw error;
  return data;
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

// Propose un changement de défi à l'autre joueur via pending_change JSONB
async function proposeMatchChange(matchId, { proposedBySlot, target, newStart, newEnd, optimalSteps, difficulty }) {
  // On stocke des versions allégées des œuvres pour pouvoir les afficher chez l'autre sans nouveau fetch
  const lightWork = (w) => ({
    id: w.id, type: w.type, title: w.title, year: w.year,
    poster_path: w.poster_path,
  });
  const payload = {
    proposed_by_slot: proposedBySlot,
    target,
    new_start: lightWork(newStart),
    new_end: lightWork(newEnd),
    optimal_steps: optimalSteps,
    difficulty,
    timestamp: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("matches")
    .update({ pending_change: payload })
    .eq("id", matchId);
  if (error) throw error;
  return payload;
}

// Applique une proposition acceptée (UPDATE start/end + clear pending_change atomiquement)
async function acceptPendingChange(matchId, pendingChange) {
  const { error } = await supabase
    .from("matches")
    .update({
      start_id: pendingChange.new_start.id, start_type: pendingChange.new_start.type,
      end_id: pendingChange.new_end.id,     end_type: pendingChange.new_end.type,
      optimal_steps: pendingChange.optimal_steps,
      difficulty: pendingChange.difficulty,
      pending_change: null,
    })
    .eq("id", matchId);
  if (error) throw error;
}

// Annule / refuse une proposition (clear simple)
async function clearPendingChange(matchId) {
  const { error } = await supabase
    .from("matches")
    .update({ pending_change: null })
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
    : position === "left2"
    ? { left: "max(62px, calc(50% - 240px + 62px))" }
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
  const [versusCode, setVersusCode] = useState(null); // Code de partie Versus en cours
  const [versusContext, setVersusContext] = useState(null); // Contexte du jeu Versus { matchId, code, myPlayerId, mySlot, myName, opponentName, opponentPlayerId }
  const [versusPrefs, setVersusPrefs] = useState(() => ({ ...DEFAULT_PREFS })); // Prefs Versus indépendantes des prefs globales, partagées entre Create et Lobby

  useEffect(() => { savePrefs(prefs); }, [prefs]);
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

  function exitVersus() {
    clearVersusFromURL();
    setVersusCode(null);
    setVersusContext(null);
    setChallenge(null);
    setScreen("menu");
  }

  // Lance une revanche : créateur du match précédent → crée un nouveau match avec mêmes prefs et l'autre est invité
  // Revanche bilatérale : n'importe quel joueur peut cliquer "Revanche".
  // Premier qui clique gagne (atomic claim sur rematch_code), l'autre rejoint automatiquement.
  async function requestRematch(previousMatch) {
    setLoadingChallenge(true);
    setLoadingLabel("Préparation de la revanche…");
    setError(null);
    try {
      // 1. Vérifie l'état actuel : peut-être que l'autre a déjà créé la revanche
      const { data: refreshed } = await supabase
        .from("matches").select("rematch_code").eq("id", previousMatch.id).maybeSingle();
      if (refreshed?.rematch_code) {
        return await joinExistingRematch(refreshed.rematch_code);
      }

      // 2. Pas encore créée : on tente de la créer
      const isRandomMode = prefs.difficulty === "random";
      let target = prefs.difficulty;
      if (isRandomMode) target = pickWeightedDifficulty();
      const targetRange = DIFFICULTIES[target]?.range;
      const forHard = target === "hard";

      let chosen = null;
      let lastAttempt = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { start, end } = await pickRandomPair(prefs, forHard);
        const optimal = await findOptimalPath(start, end, 5);
        if (!optimal || optimal.length < 3) continue;
        const steps = Math.floor((optimal.length - 1) / 2);
        lastAttempt = { start, end, steps };
        if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
          chosen = lastAttempt; break;
        }
      }
      if (!chosen) chosen = lastAttempt;
      if (!chosen) throw new Error("Aucun défi trouvé pour la revanche.");

      // 3. Crée le nouveau match
      const newMatch = await createMatch({
        startWork: chosen.start, endWork: chosen.end,
        optimalSteps: chosen.steps, difficulty: target,
      });

      // 4. Tente de poser le rematch_code sur l'ancien match de façon atomique
      const { data: claimed } = await supabase
        .from("matches")
        .update({ rematch_code: newMatch.code })
        .eq("id", previousMatch.id)
        .is("rematch_code", null)
        .select();

      if (claimed && claimed.length > 0) {
        // On a gagné la course → on devient le créateur (slot 1)
        const myName = getStoredPlayerName() || "Joueur";
        await joinMatch(newMatch.id, myName, 1);

        setVersusCode(newMatch.code);
        setVersusInURL(newMatch.code);
        setVersusContext(null);
        setChallenge(null);
        setScreen("versus-lobby");
      } else {
        // L'autre joueur nous a doublés : on rejoint sa revanche (notre match créé devient orphelin, pas grave)
        const { data: winner } = await supabase
          .from("matches").select("rematch_code").eq("id", previousMatch.id).maybeSingle();
        if (winner?.rematch_code) {
          await joinExistingRematch(winner.rematch_code);
        } else {
          throw new Error("Impossible de rejoindre la revanche.");
        }
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoadingChallenge(false);
    }
  }

  async function joinExistingRematch(rematchCode) {
    const newMatch = await getMatchByCode(rematchCode);
    if (!newMatch) throw new Error("Revanche introuvable.");

    const myToken = getPlayerToken();
    const players = await getMatchPlayers(newMatch.id);
    const me = players.find(p => p.player_token === myToken);

    if (!me) {
      // On choisit le slot libre (l'autre a pris 1, on prend 2 ; sinon 1)
      const usedSlots = players.map(p => p.slot);
      const mySlot = usedSlots.includes(1) ? 2 : 1;
      const myName = getStoredPlayerName() || "Joueur";
      await joinMatch(newMatch.id, myName, mySlot);
    }

    setVersusCode(newMatch.code);
    setVersusInURL(newMatch.code);
    setVersusContext(null);
    setChallenge(null);
    setScreen("versus-lobby");
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
              themeColors={C} glass={glass} glassDark={glassDark} theme={theme} />
      )}
      {screen === "custom" && <CustomScreen onBack={() => setScreen("menu")} onStart={startCustom}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "multi" && <VersusScreen
                                onBack={() => setScreen("menu")}
                                onCreate={() => { setVersusPrefs({ ...prefs }); setScreen("versus-create"); }}
                                onJoinManual={() => setScreen("versus-join-manual")}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-create" && <VersusCreateScreen
                                onBack={() => setScreen("multi")}
                                onCreated={(code) => { setVersusCode(code); setVersusInURL(code); setScreen("versus-lobby"); }}
                                versusPrefs={versusPrefs} setVersusPrefs={setVersusPrefs}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-lobby" && versusCode && <VersusLobbyScreen
                                code={versusCode}
                                onBack={() => { clearVersusFromURL(); setVersusCode(null); setScreen("multi"); }}
                                onStartGame={prepareAndStartVersusGame}
                                versusPrefs={versusPrefs} setVersusPrefs={setVersusPrefs}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-join" && versusCode && <VersusJoinScreen
                                code={versusCode}
                                onBack={() => { clearVersusFromURL(); setVersusCode(null); setScreen("menu"); }}
                                onJoined={() => setScreen("versus-lobby")}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
      {screen === "versus-join-manual" && <VersusJoinManualScreen
                                onBack={() => setScreen("multi")}
                                onCodeReady={(code) => { setVersusCode(code); setVersusInURL(code); setScreen("versus-join"); }}
                                themeColors={C} glass={glass} glassDark={glassDark} />}
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

function Menu({ onNavigate, onPlay, prefs, setPrefs, themeColors, glass, glassDark, gamesPlayed }) {
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

      <div style={{ textAlign: "center", fontSize: 10, letterSpacing: 3, color: C.inkMute, marginTop: 24, textTransform: "uppercase", fontWeight: 500 }}>v5.15</div>
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

function Game({ challenge, onExit, onReplay, onRetry, onFinished, onRefreshPart, versusContext, onStartRematch, onJoinRematch, themeColors, glass, glassDark, theme }) {
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
        const p = payload.new || payload.old;
        if (!p || p.id === versusContext.myPlayerId) return;
        if (payload.eventType === "DELETE") return;
        setOpponentSteps(p.current_steps || 0);
        setOpponentFinished(!!p.finished);
        setOpponentAbandoned(!!p.abandoned);
        setOpponentFinalSteps(p.final_steps);
        setOpponentFinalTimeMs(p.final_time_ms);
        setOpponentHintsUsed(p.hints_used || 0);
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
            optimalSteps={challenge.optimal ? Math.max(0, Math.floor((challenge.optimal.length - 1) / 2)) : null}
            optimalPath={challenge.optimal}
            startWork={challenge.start} endWork={challenge.end}
            onExit={onExit}
            onStartRematch={onStartRematch}
            onJoinRematch={onJoinRematch}
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
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
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
              <ActorPhoto actor={a} size={56} highlight={active} highlightColor={hColor} themeColors={C} />
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
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
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
  opponentFinalSteps, opponentFinalTimeMs, opponentHintsUsed,
  optimalSteps, optimalPath,
  startWork, endWork,
  onExit, onStartRematch, onJoinRematch,
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
  const [rematchCode, setRematchCode] = useState(null);
  const [requestingRematch, setRequestingRematch] = useState(false);

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

  // Realtime : écoute si le créateur lance une revanche (rematch_code dans le match)
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    // Fetch initial : peut-être que la revanche est déjà créée
    (async () => {
      const { data } = await supabase.from("matches").select("rematch_code").eq("id", matchId).maybeSingle();
      if (!cancelled && data?.rematch_code) setRematchCode(data.rematch_code);
    })();

    const channel = supabase.channel(`end-${matchId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "matches",
        filter: `id=eq.${matchId}`,
      }, (payload) => {
        if (!cancelled && payload.new?.rematch_code) setRematchCode(payload.new.rematch_code);
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
    } else if (mySteps < (opponentFinalSteps ?? Infinity)) {
      verdict = "🏆 Tu gagnes"; verdictColor = C.green;
    } else if (mySteps > (opponentFinalSteps ?? Infinity)) {
      verdict = `${opponentName} gagne`; verdictColor = C.amber;
    } else {
      if (myTimeMs < (opponentFinalTimeMs ?? Infinity)) {
        verdict = "🏆 Tu gagnes (au temps)"; verdictColor = C.green;
      } else if (myTimeMs > (opponentFinalTimeMs ?? Infinity)) {
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
      // onStartRematch et onJoinRematch pointent tous deux vers requestRematch en v5.11
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
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkMute, marginBottom: 12, fontWeight: 600 }}>Versus</div>

      {bothDone ? (
        <>
          <div style={{ fontWeight: 800, fontSize: 32, lineHeight: 1.05, color: verdictColor, marginBottom: 24, letterSpacing: -1.2 }}>
            {verdict}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <VersusPlayerCard
              name={myName} isMe
              steps={mySteps} timeMs={myTimeMs}
              abandoned={myAbandoned} hintsUsed={myHintsUsed}
              winner={!myAbandoned && (
                opponentAbandoned ||
                mySteps < (opponentFinalSteps ?? Infinity) ||
                (mySteps === (opponentFinalSteps ?? Infinity) && myTimeMs < (opponentFinalTimeMs ?? Infinity))
              )}
              themeColors={C} glass={glass} />
            <VersusPlayerCard
              name={opponentName}
              steps={opponentFinalSteps ?? opponentSteps}
              timeMs={opponentFinalTimeMs}
              abandoned={opponentAbandoned}
              hintsUsed={opponentHintsUsed}
              winner={!opponentAbandoned && !myAbandoned && (
                (opponentFinalSteps ?? Infinity) < mySteps ||
                ((opponentFinalSteps ?? Infinity) === mySteps && (opponentFinalTimeMs ?? Infinity) < myTimeMs)
              )}
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
        </>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
        <button onClick={onExit} style={btnSecondary}>Menu</button>

        {/* REVANCHE BILATÉRALE :
            - Si personne n'a encore demandé : bouton "Revanche" pour les 2
            - Si l'autre a déjà demandé (rematch_code apparu) : bouton vert "X propose une revanche !"
        */}
        {bothDone && !rematchCode && (
          <button onClick={handleRequestRematch} disabled={requestingRematch} style={btnPrimary}>
            {requestingRematch ? <>Préparation<AnimatedDots color="#fff" /></> : "Revanche"}
          </button>
        )}

        {bothDone && rematchCode && !requestingRematch && (
          <button onClick={handleRequestRematch}
            style={{ ...btnPrimary, background: C.green, boxShadow: `0 4px 14px ${C.green}66` }}>
            {`${opponentName} propose une revanche !`}
          </button>
        )}

        {bothDone && rematchCode && requestingRematch && (
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

function VersusCreateScreen({ onBack, onCreated, versusPrefs, setVersusPrefs, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [playerName, setPlayerName] = useState(getStoredPlayerName());
  const [creating, setCreating] = useState(false);
  const [statusLabel, setStatusLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleCreate() {
    const name = playerName.trim();
    if (!name) { setErrorMsg("Choisis un pseudo."); return; }
    if (name.length > 20) { setErrorMsg("Pseudo trop long (20 max)."); return; }
    savePlayerName(name);

    setCreating(true);
    setErrorMsg(null);

    // Choisit une difficulté cible (même logique que startRandom)
    const isRandomMode = versusPrefs.difficulty === "random";
    let target = versusPrefs.difficulty;
    if (isRandomMode) target = pickWeightedDifficulty();
    const targetRange = DIFFICULTIES[target]?.range;
    const targetLabel = DIFFICULTIES[target]?.label || "défi";
    const forHard = target === "hard";

    setStatusLabel(`Recherche d'un défi ${targetLabel.toLowerCase()}…`);

    try {
      // Cherche une paire qui matche la difficulté (10 essais)
      let chosen = null;
      let lastAttempt = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { start, end } = await pickRandomPair(versusPrefs, forHard);
        const optimal = await findOptimalPath(start, end, 5);
        if (!optimal || optimal.length < 3) continue;
        const steps = Math.floor((optimal.length - 1) / 2);
        lastAttempt = { start, end, steps };
        if (!targetRange || (steps >= targetRange[0] && steps <= targetRange[1])) {
          chosen = lastAttempt;
          break;
        }
      }
      if (!chosen) chosen = lastAttempt;
      if (!chosen) throw new Error("Aucun défi trouvé. Élargis tes critères.");

      setStatusLabel("Création de la partie…");

      const match = await createMatch({
        startWork: chosen.start,
        endWork: chosen.end,
        optimalSteps: chosen.steps,
        difficulty: target,
      });

      // Le créateur rejoint en slot 1
      await joinMatch(match.id, name, 1);

      onCreated(match.code);
    } catch (e) {
      console.error(e);
      setErrorMsg(e.message || "Erreur lors de la création.");
      setCreating(false);
    }
  }

  const inputStyle = {
    width: "100%", background: C.cardBg, border: `1px solid ${C.hairline}`,
    outline: "none", borderRadius: 14, padding: "12px 16px",
    fontSize: 16, fontFamily: "inherit", color: C.ink, fontWeight: 600,
  };

  // Indicateur si les options avancées sont actives (différentes des defaults)
  const hasActiveAdvanced =
    (versusPrefs.eras?.length || 0) > 0 ||
    (versusPrefs.minRating || 0) > 0 ||
    (versusPrefs.languages?.length || 0) !== DEFAULT_PREFS.languages.length ||
    JSON.stringify((versusPrefs.languages || []).slice().sort()) !== JSON.stringify(DEFAULT_PREFS.languages.slice().sort()) ||
    (versusPrefs.filterMode || "exclude") !== DEFAULT_PREFS.filterMode ||
    JSON.stringify((versusPrefs.includeGenres || []).slice().sort()) !== JSON.stringify((DEFAULT_PREFS.includeGenres || []).slice().sort()) ||
    JSON.stringify((versusPrefs.excludeGenres || []).map(Number).sort()) !== JSON.stringify((DEFAULT_PREFS.excludeGenres || []).map(Number).sort());

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} disabled={creating} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: creating ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none", opacity: creating ? 0.5 : 1 }}>← Retour</button>
      </header>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Créer</div>
        <h2 style={{ fontWeight: 800, fontSize: 32, margin: 0, letterSpacing: -1.2, lineHeight: 1, color: C.ink }}>Ton pseudo</h2>
      </div>

      <div style={{ marginBottom: 22 }}>
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Mathieu, Kévin…" maxLength={20}
          disabled={creating}
          style={inputStyle} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 10 }}>Mode</div>
        <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
          {Object.entries(MODES).map(([key, m]) => {
            const active = versusPrefs.mode === key;
            return (
              <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, mode: key }))} disabled={creating}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 999, border: "none",
                  background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: "uppercase",
                  cursor: creating ? "not-allowed" : "pointer", transition: "background .15s",
                  opacity: creating ? 0.6 : 1 }}>{m.label}</button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 10 }}>Difficulté</div>
        <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
          {Object.entries(DIFFICULTIES).map(([key, d]) => {
            const active = versusPrefs.difficulty === key;
            return (
              <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, difficulty: key }))} disabled={creating}
                style={{ flex: 1, padding: "9px 4px", borderRadius: 999, border: "none",
                  background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                  letterSpacing: 0.4, textTransform: "uppercase",
                  cursor: creating ? "not-allowed" : "pointer", transition: "background .15s",
                  opacity: creating ? 0.6 : 1 }}>{d.label}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: C.inkMute, marginTop: 6, fontWeight: 500 }}>{DIFFICULTIES[versusPrefs.difficulty].sub}</div>
      </div>

      {/* Options avancées (collapsible) */}
      <div style={{ marginBottom: 22 }}>
        <button onClick={() => setShowAdvanced(s => !s)} disabled={creating}
          style={{ ...glass, borderRadius: 999, padding: "10px 18px", border: "none",
            width: "100%", cursor: creating ? "not-allowed" : "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            color: C.ink, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
            opacity: creating ? 0.5 : 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Options du défi
            {hasActiveAdvanced && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />}
          </span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: showAdvanced ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showAdvanced && (
          <div style={{ marginTop: 8 }}>
            <VersusFiltersPanel
              versusPrefs={versusPrefs} setVersusPrefs={setVersusPrefs}
              disabled={creating} themeColors={C} glass={glass} />
          </div>
        )}
      </div>

      {errorMsg && (
        <div style={{ ...glassDark, borderRadius: 14, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      {creating && (
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <Spinner label={statusLabel} themeColors={C} />
        </div>
      )}

      <button onClick={handleCreate} disabled={creating || !playerName.trim()}
        style={{ ...glassDark, borderRadius: 999, padding: "14px 22px",
          fontSize: 13, letterSpacing: 1.3, textTransform: "uppercase",
          cursor: (creating || !playerName.trim()) ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontWeight: 700,
          border: "none", width: "100%",
          opacity: (creating || !playerName.trim()) ? 0.4 : 1 }}>
        {creating ? <>Création<AnimatedDots /></> : "Lancer la partie"}
      </button>
    </div>
  );
}

function VersusJoinManualScreen({ onBack, onCodeReady, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleSubmit() {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) { setErrorMsg("Le code fait 6 chiffres."); return; }
    setChecking(true);
    setErrorMsg(null);
    try {
      const match = await getMatchByCode(clean);
      if (!match) { setErrorMsg("Aucune partie avec ce code."); setChecking(false); return; }
      if (match.status === "finished") { setErrorMsg("Cette partie est terminée."); setChecking(false); return; }
      onCodeReady(clean);
    } catch (e) {
      setErrorMsg("Erreur de vérification. Réessaie.");
      setChecking(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Retour</button>
      </header>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Rejoindre</div>
        <h2 style={{ fontWeight: 800, fontSize: 32, margin: 0, letterSpacing: -1.2, lineHeight: 1, color: C.ink }}>Code de la partie</h2>
        <p style={{ fontSize: 13, color: C.inkSoft, marginTop: 8, fontWeight: 500 }}>
          Demande le code à ton ami : 6 chiffres.
        </p>
      </div>

      <input value={formatMatchCode(code.replace(/\D/g, ""))}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000 000" inputMode="numeric" maxLength={7}
        style={{ width: "100%", background: C.cardBg, border: `1px solid ${C.hairline}`,
          outline: "none", borderRadius: 14, padding: "16px 20px",
          fontSize: 26, fontFamily: "inherit", color: C.ink, fontWeight: 800,
          letterSpacing: 4, textAlign: "center",
          fontVariantNumeric: "tabular-nums" }} />

      {errorMsg && (
        <div style={{ ...glassDark, borderRadius: 14, padding: "10px 14px", marginTop: 14, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      <button onClick={handleSubmit} disabled={checking || code.replace(/\D/g, "").length !== 6}
        style={{ ...glassDark, borderRadius: 999, padding: "14px 22px",
          fontSize: 13, letterSpacing: 1.3, textTransform: "uppercase",
          cursor: (checking || code.replace(/\D/g, "").length !== 6) ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontWeight: 700,
          border: "none", width: "100%", marginTop: 18,
          opacity: (checking || code.replace(/\D/g, "").length !== 6) ? 0.4 : 1 }}>
        {checking ? "Vérification…" : "Continuer"}
      </button>
    </div>
  );
}

function VersusJoinScreen({ code, onBack, onJoined, themeColors, glass, glassDark }) {
  const C = themeColors;
  const [match, setMatch] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [playerName, setPlayerName] = useState(getStoredPlayerName());
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getMatchByCode(code);
        if (cancelled) return;
        if (!m) { setErrorMsg("Aucune partie avec ce code."); setLoading(false); return; }
        if (m.status === "finished") { setErrorMsg("Cette partie est terminée."); setLoading(false); return; }
        const ps = await getMatchPlayers(m.id);
        if (cancelled) return;

        // Si on est déjà dans cette partie (token), on passe direct au lobby
        const myToken = getPlayerToken();
        const me = ps.find(p => p.player_token === myToken);
        if (me) { onJoined(); return; }

        // Si la partie est pleine (2 joueurs et pas nous) → refus
        if (ps.length >= 2) {
          setErrorMsg("Cette partie est complète.");
          setLoading(false);
          return;
        }

        setMatch(m);
        setPlayers(ps);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setErrorMsg("Erreur de chargement."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [code, onJoined]);

  async function handleJoin() {
    const name = playerName.trim();
    if (!name) { setErrorMsg("Choisis un pseudo."); return; }
    if (name.length > 20) { setErrorMsg("Pseudo trop long (20 max)."); return; }
    savePlayerName(name);

    setJoining(true);
    setErrorMsg(null);
    try {
      const slot = players.length === 0 ? 1 : 2;
      await joinMatch(match.id, name, slot);
      onJoined();
    } catch (e) {
      console.error(e);
      setErrorMsg(e.message || "Erreur en rejoignant.");
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
        </header>
        <Spinner label="Chargement de la partie…" themeColors={C} />
      </div>
    );
  }

  if (errorMsg && !match) {
    return (
      <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <button onClick={onBack} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none" }}>← Menu</button>
        </header>
        <div style={{ ...glass, borderRadius: 22, padding: 40, textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8, color: C.ink }}>Partie inaccessible</div>
          <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.5 }}>{errorMsg}</div>
        </div>
      </div>
    );
  }

  const creator = players[0];

  return (
    <div style={{ minHeight: "100vh", padding: "70px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
        <button onClick={onBack} disabled={joining} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: joining ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none", opacity: joining ? 0.5 : 1 }}>← Annuler</button>
      </header>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Invitation</div>
        <h2 style={{ fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: -1, lineHeight: 1.1, color: C.ink }}>
          {creator ? `${creator.player_name} t'invite` : "Tu rejoins la partie"}
        </h2>
        <p style={{ fontSize: 13, color: C.inkSoft, marginTop: 10, fontWeight: 500 }}>
          Difficulté : <strong>{DIFFICULTIES[match.difficulty]?.label || "—"}</strong>
        </p>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 10 }}>Ton pseudo</div>
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Ton pseudo" maxLength={20} disabled={joining}
          style={{ width: "100%", background: C.cardBg, border: `1px solid ${C.hairline}`,
            outline: "none", borderRadius: 14, padding: "12px 16px",
            fontSize: 16, fontFamily: "inherit", color: C.ink, fontWeight: 600 }} />
      </div>

      {errorMsg && (
        <div style={{ ...glassDark, borderRadius: 14, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      <button onClick={handleJoin} disabled={joining || !playerName.trim()}
        style={{ ...glassDark, borderRadius: 999, padding: "14px 22px",
          fontSize: 13, letterSpacing: 1.3, textTransform: "uppercase",
          cursor: (joining || !playerName.trim()) ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontWeight: 700,
          border: "none", width: "100%",
          opacity: (joining || !playerName.trim()) ? 0.4 : 1 }}>
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
  const [starting, setStarting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // États pour le défi affiché dans le lobby
  const [defiWorks, setDefiWorks] = useState({ start: null, end: null });
  // États pour la proposition de changement
  const [refreshing, setRefreshing] = useState(null); // null | "start" | "end" | "both"
  const [proposalAction, setProposalAction] = useState(null); // null | "accept" | "refuse"
  const startedRef = useRef(false);

  const myToken = useMemo(() => getPlayerToken(), []);
  const me = players.find(p => p.player_token === myToken);
  const opponent = players.find(p => p.player_token !== myToken);
  const iAmCreator = me?.slot === 1;
  const bothReady = players.length === 2;
  const pendingChange = match?.pending_change || null;
  const mySlot = me?.slot;
  const iAmProposer = pendingChange && mySlot && pendingChange.proposed_by_slot === mySlot;
  const opponentName = opponent?.player_name || "Adversaire";

  // Charge initial + subscribe realtime
  useEffect(() => {
    let cancelled = false;
    let channel = null;

    (async () => {
      try {
        const m = await getMatchByCode(code);
        if (cancelled) return;
        if (!m) { setError("Partie introuvable."); return; }
        // Si on arrive sur une partie avec un pending_change orphelin, on le purge
        // (sécurité : un client a pu fermer son onglet en plein milieu d'une proposition)
        // Seul le créateur fait ce nettoyage, pour éviter une double-update
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

  // Charge les œuvres du défi pour affichage. Gating sur bothReady : les deux joueurs
  // découvrent les affiches au même moment, dès que la partie est au complet.
  useEffect(() => {
    if (!match?.start_id || !match?.end_id || !bothReady) return;
    let cancelled = false;
    getWorksByPairs([
      { id: match.start_id, type: match.start_type },
      { id: match.end_id,   type: match.end_type   },
    ]).then(works => {
      if (!cancelled) setDefiWorks({ start: works[0], end: works[1] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [match?.start_id, match?.start_type, match?.end_id, match?.end_type, bothReady]);

  // Auto-démarre le jeu quand le match passe en "playing"
  // (déclenché pour J1 par son click, pour J2 par l'echo realtime)
  useEffect(() => {
    if (!match) return;
    if (match.status !== "playing") return;
    if (startedRef.current) return;
    startedRef.current = true;
    onStartGame(match);
  }, [match?.status, onStartGame]);

  async function handleStart() {
    if (!match || starting) return;
    setStarting(true);
    try {
      // En v5.12, les défis se modifient via le système de proposition (boutons 🔄).
      // Le "Démarrer" ne fait plus que basculer en status=playing avec les films verrouillés.
      await startMatch(match.id);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur au lancement.");
      setStarting(false);
    }
  }

  // Propose de changer le défi (un film ou les deux) à l'autre joueur via pending_change
  async function handleProposeChange(target) {
    if (!match || refreshing || pendingChange || !defiWorks.start || !defiWorks.end) return;
    setRefreshing(target);
    try {
      const result = await generateNewDefi({
        currentStart: defiWorks.start,
        currentEnd: defiWorks.end,
        target,
        versusPrefs,
      });
      await proposeMatchChange(match.id, {
        proposedBySlot: mySlot,
        target,
        newStart: result.start,
        newEnd: result.end,
        optimalSteps: result.optimalSteps,
        difficulty: result.difficulty,
      });
      // L'echo realtime fera apparaître la proposition de notre côté aussi
    } catch (e) {
      console.error(e);
      setError(e.message || "Aucun film trouvé.");
    } finally {
      setRefreshing(null);
    }
  }

  async function handleAcceptChange() {
    if (!pendingChange || proposalAction) return;
    setProposalAction("accept");
    try {
      await acceptPendingChange(match.id, pendingChange);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors de l'acceptation.");
    } finally {
      setProposalAction(null);
    }
  }

  async function handleRefuseChange() {
    if (!pendingChange || proposalAction) return;
    setProposalAction("refuse");
    try {
      await clearPendingChange(match.id);
    } catch (e) {
      console.error(e);
      setError(e.message || "Erreur lors du refus.");
    } finally {
      setProposalAction(null);
    }
  }

  async function handleCancelProposal() {
    if (!pendingChange || proposalAction) return;
    setProposalAction("refuse");
    try {
      await clearPendingChange(match.id);
    } catch (e) {
      console.error(e);
    } finally {
      setProposalAction(null);
    }
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
        <button onClick={onBack} disabled={starting} style={{ ...glass, borderRadius: 999, padding: "9px 14px", cursor: starting ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.ink, fontWeight: 600, border: "none", opacity: starting ? 0.5 : 1 }}>← Quitter</button>
      </header>

      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.inkSoft, marginBottom: 10, fontWeight: 600 }}>Versus · Salon</div>
        <h2 style={{ fontWeight: 800, fontSize: 26, margin: 0, letterSpacing: -1, lineHeight: 1.1, color: C.ink }}>
          {bothReady ? "Prêt à jouer !" : <>En attente du joueur 2<AnimatedDots /></>}
        </h2>
      </div>

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

      {/* Proposition de changement en cours (côté qui n'a pas proposé : Accepter/Refuser) */}
      {bothReady && pendingChange && !iAmProposer && (
        <PendingChangeBanner
          pendingChange={pendingChange}
          proposerName={opponentName}
          onAccept={handleAcceptChange}
          onRefuse={handleRefuseChange}
          loadingAction={proposalAction}
          themeColors={C} glass={glass} glassDark={glassDark} />
      )}

      {/* Proposition en cours (côté proposeur : Annuler) */}
      {bothReady && pendingChange && iAmProposer && (
        <div style={{ ...glass, borderRadius: 16, padding: "14px 16px", marginBottom: 20,
          border: `1px solid ${C.versusMe}40` }}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.versusMe, fontWeight: 700, marginBottom: 6 }}>
            Proposition envoyée
          </div>
          <div style={{ fontSize: 13, color: C.inkSoft, fontWeight: 500, marginBottom: 10 }}>
            En attente de {opponentName}<AnimatedDots />
          </div>
          <button onClick={handleCancelProposal} disabled={proposalAction === "refuse"}
            style={{ background: "transparent", border: `1px solid ${C.hairline}`,
              borderRadius: 999, padding: "7px 14px",
              fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
              cursor: proposalAction === "refuse" ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 700, color: C.ink,
              opacity: proposalAction === "refuse" ? 0.5 : 1 }}>
            {proposalAction === "refuse" ? <>Annulation<AnimatedDots /></> : "Annuler la proposition"}
          </button>
        </div>
      )}

      {/* Le défi en cours (affiches start/end + boutons refresh) */}
      <div style={{ ...glass, borderRadius: 22, padding: "20px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, marginBottom: 16, fontWeight: 600, textAlign: "center" }}>
          Le défi
        </div>
        {!bothReady
          ? <div style={{ padding: "16px 0", textAlign: "center", color: C.inkMute, fontSize: 13 }}>
              Les affiches seront révélées quand l'adversaire rejoindra.
            </div>
          : (() => {
              const displayStart = pendingChange ? pendingChange.new_start : defiWorks.start;
              const displayEnd   = pendingChange ? pendingChange.new_end   : defiWorks.end;
              if (!displayStart || !displayEnd) return <Spinner label="Chargement du défi…" themeColors={C} />;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <LobbyDefiSide
                      label="Départ" movie={displayStart} align="left"
                      onRefresh={!pendingChange ? () => handleProposeChange("start") : null}
                      refreshing={refreshing === "start"}
                      disabledAll={!!pendingChange || !!refreshing}
                      themeColors={C} />
                    <div style={{ flex: 1, height: 1, background: C.hairline, marginTop: 56 }} />
                    <LobbyDefiSide
                      label="Arrivée" movie={displayEnd} align="right"
                      onRefresh={!pendingChange ? () => handleProposeChange("end") : null}
                      refreshing={refreshing === "end"}
                      disabledAll={!!pendingChange || !!refreshing}
                      themeColors={C} />
                  </div>
                  {!pendingChange && (
                    <button onClick={() => handleProposeChange("both")} disabled={!!refreshing}
                      style={{ ...glass, borderRadius: 999, padding: "10px 16px",
                        border: `1px solid ${C.hairline}`, width: "100%", marginTop: 16,
                        fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
                        cursor: refreshing ? "not-allowed" : "pointer", fontFamily: "inherit",
                        color: C.ink, fontWeight: 700, opacity: refreshing ? 0.5 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      {refreshing === "both" ? (
                        <>Recherche<AnimatedDots /></>
                      ) : (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                          </svg>
                          Nouveau défi
                        </>
                      )}
                    </button>
                  )}
                </>
              );
            })()
        }
      </div>

      {/* Filtres du défi (créateur uniquement) — modifiables avant "Démarrer" */}
      {iAmCreator && versusPrefs && setVersusPrefs && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>Mode</div>
            <div style={{ display: "flex", gap: 6, ...glass, padding: 5, borderRadius: 999 }}>
              {Object.entries(MODES).map(([key, m]) => {
                const active = versusPrefs.mode === key;
                return (
                  <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, mode: key }))} disabled={starting}
                    style={{ flex: 1, padding: "9px 6px", borderRadius: 999, border: "none",
                      background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                      fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                      letterSpacing: 0.5, textTransform: "uppercase",
                      cursor: starting ? "not-allowed" : "pointer",
                      opacity: starting ? 0.6 : 1 }}>{m.label}</button>
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
                  <button key={key} onClick={() => setVersusPrefs(p => ({ ...p, difficulty: key }))} disabled={starting}
                    style={{ flex: 1, padding: "8px 4px", borderRadius: 999, border: "none",
                      background: active ? C.ink : "transparent", color: active ? C.bg : C.ink,
                      fontFamily: "inherit", fontSize: 10, fontWeight: 600,
                      letterSpacing: 0.4, textTransform: "uppercase",
                      cursor: starting ? "not-allowed" : "pointer",
                      opacity: starting ? 0.6 : 1 }}>{d.label}</button>
                );
              })}
            </div>
          </div>

          <button onClick={() => setShowFilters(s => !s)} disabled={starting}
            style={{ ...glass, borderRadius: 999, padding: "10px 18px", border: "none",
              width: "100%", cursor: starting ? "not-allowed" : "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              color: C.ink, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
              opacity: starting ? 0.5 : 1 }}>
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
                disabled={starting} themeColors={C} glass={glass} />
            </div>
          )}
        </div>
      )}

      {/* Action principale */}
      {bothReady ? (
        iAmCreator ? (
          <button onClick={handleStart} disabled={starting}
            style={{ ...glassDark, borderRadius: 999, padding: "14px 22px",
              fontSize: 13, letterSpacing: 1.3, textTransform: "uppercase",
              cursor: starting ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700,
              border: "none", width: "100%",
              opacity: starting ? 0.5 : 1 }}>
            {starting ? <>Lancement<AnimatedDots /></> : "Démarrer le défi"}
          </button>
        ) : (
          <div style={{ textAlign: "center", fontSize: 12, color: C.inkSoft, fontWeight: 500, padding: "12px 0" }}>
            En attente du créateur pour lancer la partie<AnimatedDots />
          </div>
        )
      ) : (
        <div style={{ textAlign: "center", fontSize: 12, color: C.inkMute, fontWeight: 500, padding: "12px 0" }}>
          {iAmCreator
            ? "Partage le code ou le lien à ton ami."
            : <>Partie créée. Attendons le démarrage<AnimatedDots /></>}
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

// Bannière de proposition de changement (côté de celui qui doit accepter/refuser)
function PendingChangeBanner({ pendingChange, proposerName, onAccept, onRefuse, loadingAction, themeColors, glass, glassDark }) {
  const C = themeColors;
  const targetLabel = pendingChange.target === "start" ? "le départ"
                   : pendingChange.target === "end"   ? "l'arrivée"
                                                      : "les deux films";

  return (
    <div style={{ ...glass, borderRadius: 16, padding: "16px 16px 14px", marginBottom: 20,
      border: `2px solid ${C.versusOpponent}` }}>
      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.versusOpponent, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.versusOpponent, display: "inline-block" }} />
        {proposerName} propose
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, letterSpacing: -0.3, marginBottom: 12 }}>
        Changer {targetLabel}
      </div>

      {/* Affichage des nouvelles affiches proposées */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14,
        padding: 12, background: C.bg + "60", borderRadius: 12 }}>
        <ProposalSide work={pendingChange.new_start} highlight={pendingChange.target === "start" || pendingChange.target === "both"} themeColors={C} />
        <div style={{ fontSize: 18, color: C.inkMute, fontWeight: 700 }}>↔</div>
        <ProposalSide work={pendingChange.new_end} align="right" highlight={pendingChange.target === "end" || pendingChange.target === "both"} themeColors={C} />
      </div>

      {/* Boutons Accepter / Refuser */}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onRefuse} disabled={!!loadingAction}
          style={{ ...glass, border: `1px solid ${C.hairline}`,
            borderRadius: 999, padding: "10px 16px", flex: 1,
            fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
            cursor: loadingAction ? "not-allowed" : "pointer",
            fontFamily: "inherit", fontWeight: 700, color: C.ink,
            opacity: loadingAction ? 0.5 : 1 }}>
          {loadingAction === "refuse" ? <>Refus<AnimatedDots /></> : "Refuser"}
        </button>
        <button onClick={onAccept} disabled={!!loadingAction}
          style={{ background: C.green, color: "#fff", border: "none",
            borderRadius: 999, padding: "10px 16px", flex: 1,
            fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase",
            cursor: loadingAction ? "not-allowed" : "pointer",
            fontFamily: "inherit", fontWeight: 700,
            boxShadow: `0 4px 14px ${C.green}66`,
            opacity: loadingAction ? 0.5 : 1 }}>
          {loadingAction === "accept" ? <>Validation<AnimatedDots color="#fff" /></> : "Accepter"}
        </button>
      </div>
    </div>
  );
}

function ProposalSide({ work, align = "left", highlight, themeColors }) {
  const C = themeColors;
  return (
    <div style={{ textAlign: align, maxWidth: 110, display: "flex", flexDirection: "column",
      alignItems: align === "right" ? "flex-end" : "flex-start", flex: 1 }}>
      <div style={{ position: "relative" }}>
        <Poster movie={work} size={56} rounded={8} themeColors={C} />
        {highlight && (
          <div style={{ position: "absolute", inset: -3, borderRadius: 11,
            border: `2px solid ${C.versusOpponent}`,
            pointerEvents: "none" }} />
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 11, lineHeight: 1.15, letterSpacing: -0.2,
        color: C.ink, marginTop: 6,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{work.title}</div>
      <div style={{ fontSize: 10, color: C.inkMute, marginTop: 1, fontWeight: 500 }}>{work.year}</div>
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