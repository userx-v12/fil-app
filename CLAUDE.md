# Fil — Jeu de connexion films/séries

## ⚡ À LIRE EN PREMIER

Lis aussi SESSION_LOG.md à la racine — il contient les bugs récemment corrigés et l'état de la dernière session.

Ce fichier est ta source de vérité pour ce projet. Lis-le entièrement avant toute action.

**Trois règles non-négociables** :
1. **Avant de modifier `src/App.jsx`, lis le bloc concerné.** Le fichier fait ~4750 lignes. Ne le réécris JAMAIS en entier.
2. **Avant d'écrire du code, propose un plan textuel.** J'accepte ou je refuse. Pas de coding "by surprise".
3. **Une modification = une raison explicite que j'ai validée.** Pas de refactors "esthétiques" non demandés.

---

## 🎯 Description du projet

**Fil** est un jeu web inspiré de "Six Degrees of Kevin Bacon". Le joueur part d'un film A et doit arriver à un film B en passant uniquement par les acteurs/actrices qui ont joué dans les œuvres traversées. Le but est de trouver le chemin le plus court (en étapes) ou le plus rapide (en temps).

**Liens** :
- Prod : https://fil-app.vercel.app
- Repo : https://github.com/userx-v12/fil-app
- Tagline : "Relie les films"

**Public** : francophones, joueurs casual de jeux de connexion (cinéphiles ou non).

---

## 🛠️ Stack technique

| Composant | Détail |
|-----------|--------|
| Frontend | React + Vite (mono-fichier `src/App.jsx`) |
| Backend | Supabase (PostgreSQL + Realtime) |
| Déploiement | Vercel auto-deploy depuis `main` |
| Data import | Scripts Python dans `fil-setup/` (dossier voisin) |
| Source externe | TMDb API v3 |
| URL Supabase | `xjfxezwtwjhudrbtbpnv.supabase.co` |

**Variables d'environnement** (`.env.local`) :
- `VITE_SUPABASE_URL` : URL de l'instance Supabase
- `VITE_SUPABASE_ANON` : clé publique anon

Côté scripts Python : `SUPABASE_SERVICE_KEY` (pas `SUPABASE_SECRET_KEY`).

---

## 🗄️ Schéma Supabase

### Table `works` (~45k entrées : 33k films + 12k séries)
- `id` (int), `type` ("movie" ou "tv"), `title`, `year`, `poster_path`
- `popularity` (float, min 30 pour être importé)
- `vote_average`, `vote_count`, `original_language`, `genre_ids` (JSONB)

### Table `actors` (~384k entrées)
- `id` (int), `name`, `profile_path`, `popularity`

### Table `credits` (~944k entrées, relation N:N)
- `actor_id`, `work_id`, `work_type` ("movie" ou "tv")
- Utilise `work_id`, pas `movie_id`

### Table `matches` (parties Versus)
- `id` (UUID), `code` (VARCHAR 12, en pratique 6 chiffres)
- `start_id`, `start_type`, `end_id`, `end_type`
- `optimal_steps` (int), `difficulty` ("easy", "medium", "hard")
- `status` ("waiting", "playing", "finished")
- `started_at`, `finished_at`
- `rematch_code` (VARCHAR 12, nullable) — pour la revanche bilatérale
- `pending_change` (JSONB) — proposition de changement de défi en attente

### Table `match_players`
- `id`, `match_id` (FK vers matches), `slot` (1 ou 2)
- `player_name` (VARCHAR), `player_token` (VARCHAR, identifiant anonyme localStorage)
- `current_path` (JSONB) — chemin actuel en jeu
- `current_steps` (int), `finished` (bool), `abandoned` (bool)
- `final_steps`, `final_time_ms`, `hints_used`
- `joined_at`, `finished_at`
- Contrainte UNIQUE : `(match_id, player_token)` — un joueur peut être dans plusieurs matchs distincts

### Realtime
Tables avec Realtime activé : `matches`, `match_players`, `works`, `actors`, `credits`.

### RLS
Policies `anon` et `auth` : SELECT + INSERT + UPDATE sur les 5 tables (pas de DELETE direct).

---

## 🎮 Modes de jeu

### Solo

**Modes de défi** :
- Défi aléatoire : tirage random d'une paire de films
- Sur Mesure : le joueur choisit start et end manuellement
- Refresh sélectif : bouton refresh sur chaque affiche (Départ / Arrivée) avant de jouer

**Difficultés** (strictes par nombre d'étapes du chemin optimal) :
- Facile : 1 à 2 étapes
- Moyen : 3 à 4 étapes
- Difficile : 5 étapes ou plus

**Pondération aléatoire** (mode "Aléatoire") : 40% Facile / 40% Moyen / 20% Difficile

**Filtres disponibles** :
- Mode : Films / Mix / Séries (Mix au milieu)
- Époques (par décennie)
- Langues (en, fr, es, etc.)
- Note minimale TMDB (en étoiles, valeur par défaut : 3.5 sur 5)
- Genres : Inclure ou Exclure (19 genres TMDb)

**Preset utilisateur** : possibilité de sauvegarder/restaurer une config de filtres (localStorage, clé `LS_USER_PRESET`).

### Versus (multijoueur temps réel)

**Création** :
- Pseudo + filtres Versus (indépendants des prefs solo)
- Match créé en DB avec code à 6 chiffres
- URL partageable : `?versus=XXXXXX`

**Lobby** :
- Code en gros + bouton "Copier le code" + "Copier le lien"
- Liste des joueurs (slot 1 = créateur, slot 2 = invité)
- Affichage du défi : 2 affiches Départ vers Arrivée
- Filtres modifiables (créateur uniquement, dépliable via "Options du défi")
- Bouton refresh sur chaque affiche + "Nouveau défi" : proposition validée par l'autre joueur via `pending_change` JSONB
- Bouton "Réinitialiser par défaut" (pas de save preset comme en solo)

**Validation des changements de défi** :
- Système Option A (validation explicite)
- J1 propose, J2 voit "X propose de changer le départ" avec bouton Accepter/Refuser
- J1 peut annuler sa proposition
- Atomic via UPDATE Supabase

**Gameplay temps réel** :
- Banner du haut : étapes + indices de chacun, couleurs `versusMe` / `versusOpponent`
- Broadcast à chaque coup via `updatePlayerProgress` (current_path light = IDs uniquement)
- Subscribe Realtime sur `match_players` pour voir l'adversaire

**Fin de partie** :
- Verdict : étapes prioritaires, temps en départage en cas d'égalité
- Cas spéciaux : double abandon, victoire par abandon de l'adversaire
- Affichage des 3 chemins : mon parcours (bleu), adversaire (rose), optimal (gris)

**Revanche** :
- Bilatérale : les deux peuvent cliquer "Revanche"
- Atomic claim via `rematch_code` (premier wins, l'autre rejoint la nouvelle partie)
- Nouvelle partie créée avec les mêmes prefs courants du créateur de la revanche

---

## 💡 Indices

- Bouton ampoule disponible en jeu
- Débloque après 15 secondes (anti-spam)
- Indicateur visuel : cercle SVG qui se dessine progressivement
- Surligne l'acteur ou le film à choisir
- Compté dans `hints_used` côté DB en Versus
- En Versus : indices visibles des 2 côtés (banner in-game + cards en fin de partie)

---

## 🎨 Style graphique

- Minimaliste, deux thèmes (light / dark)
- Police : Manrope
- Couleurs :
  - `ink` : texte principal fort
  - `inkSoft` / `inkMute` : textes secondaires
  - `green` : succès
  - `amber` : warning / abandon
  - `versusMe` : bleu — `#2563eb` (light) / `#60a5fa` (dark)
  - `versusOpponent` : rose — `#db2777` (light) / `#f472b6` (dark)
- Pas d'animations gratuites, garder sobre

---

## 📋 Règles strictes pour Claude

### NE JAMAIS faire
- Réécrire tout `src/App.jsx` même si je demande "refactor"
- Casser des fonctionnalités existantes pour des refactors esthétiques
- Inventer des colonnes ou tables Supabase qui n'existent pas
- Modifier le schéma DB sans demander explicitement
- Push sur `main` sans mon accord
- Lancer `npm install <package>` sans m'avoir prévenu d'abord
- Supprimer du code sans expliquer pourquoi
- Modifier d'autres fichiers que ce que j'ai demandé
- Faire du "scope creep" (ajouter des features pendant un bug fix)
- Utiliser les symboles `≥` ou `≤` (Mathieu n'aime pas, préférer "au moins X" ou "plus de X")

### TOUJOURS faire
- Lire les fichiers concernés AVANT de proposer des modifs
- Présenter les changements en mini-blocs séparés (un Edit / str_replace à la fois)
- Expliquer brièvement chaque changement
- Pour les gros str_replace, montrer `old_str` et `new_str` pour validation
- Tester la syntaxe (parenthèses / accolades équilibrées) après chaque gros changement
- Conserver les commentaires en français (le projet est francophone)
- Préserver le style du code existant
- Si tu hésites entre deux approches, propose-moi le choix au lieu de deviner
- Si tu n'as pas l'info, demande-moi avant d'inventer
- **Mettre à jour le numéro de version dans le menu avant chaque commit** (chercher `v5.` dans App.jsx, incrémenter le patch)

### Économie de tokens
- Pas de recap complet de chaque message si je ne le demande pas
- Quand je dis "ok ça marche", on passe directement au suivant
- Pas de répétitions inutiles de code dans les explications
- Pas de méta-commentaire ("Je vais maintenant...", "Comme tu as demandé...")
- Direct et concis

---

## 🗣️ Style de communication

- Français casual, tutoiement
- Pas de `≥` ou `≤` : Mathieu n'aime pas ces symboles, préférer "au moins X" / "X ou plus"
- Pas de meta-commentary ("Je vais maintenant...", "Permets-moi de...")
- Direct et concis
- Pas de flatterie ("Excellente question !", "Bien vu !")
- Si t'es pas sûr, dis "je sais pas" plutôt que d'inventer
- Si la demande est ambiguë, pose UNE question avant de coder

---

## 🐛 Bugs résolus récemment

- v5.17 : `loadPlayerName` inexistant → crash page blanche AccountScreen. Fix : `getStoredPlayerName`.
- v5.15 : Cache poisoning filmographie/casting — `[]` truthy en JS stocké dans le cache → ne cacher que si `length > 0`.
- v5.15 : MAX_TRIES trop bas en mode Difficile → `const MAX_TRIES = forHard ? 25 : 10`.
- v5.12 : `opponentHintsUsed` manquait dans la destructuration des props de `VersusEndScreen` → écran vide.

---

## 📦 Version actuelle : v5.18

**Nouveautés majeures depuis le début** :
- Refonte difficulté avec plages strictes
- Refresh sélectif des films en solo
- Note TMDB en étoiles (défaut 3.5)
- Indicateur visuel de chargement de l'indice (ring 15s)
- Mode Versus complet avec lobby, temps réel, fin de partie
- Revanche bilatérale (atomic claim sur `rematch_code`)
- Filtres modifiables dans le lobby Versus + bouton "Réinitialiser par défaut"
- Système de proposition de changement de défi (`pending_change` JSONB) avec validation
- Indices visibles des deux côtés
- Couleurs distinctes joueur / adversaire
- Bouton ? + recherche fuzzy dans casting et filmographie (fuse.js)
- Gestion déconnexion adversaire : Presence channel + victoire auto à 30s + reconnexion silencieuse
- Affiches lobby révélées simultanément (gate sur `bothReady`) + pending_change visible des deux côtés
- Countdown 3-2-1-GO avant lancement Versus
- Écran Compte : pseudo modifiable + stats locales (solo par difficulté, meilleur score, optimaux, abandons, indices, V/D Versus)
- PWA : manifest.json + service worker + icône SVG/PNG + bouton install centré dans le menu (popup adaptatif iOS/Android/desktop)

---

## 📋 Backlog prioritaire (v5.19+)

1. Supabase Auth — comptes réels, liste d'amis, stats cross-device (projet 1-2 jours)
2. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits`)
3. `original_title` dans `works` pour recherche cross-langue — migration DB séparée
4. Phase 6 : App iOS via Capacitor

## 🗺️ Roadmap long terme

- Phase 6 : App iOS via Capacitor (Apple Developer ~99€/an)
- Phase 7 : Mode "Défi du jour" type Wordle, leaderboard mondial
- Phase 8 : Tracker interne "vu / pas vu" + import CSV Letterboxd
- Phase 9 : Comptes utilisateurs Supabase Auth

---

## 🔄 Méthodologie de travail

Je travaille en 3 modes. Adapte ton comportement selon le mode :

### 1. Brainstorming (déclencheurs : "réfléchis d'abord", "qu'est-ce que tu en penses", "options ?")
- Tu ne touches pas au code
- Tu listes 2-3 options avec pros/cons
- Tu poses des questions si nécessaire
- Tu attends ma décision avant de proposer du code

### 2. Implémentation (déclencheurs : "code", "fais-le", "go", "applique")
- Tu fragmentes en mini-incréments logiques
- Tu présentes le plan AVANT le diff
- Tu utilises des Edit / str_replace ciblés
- Tu testes la syntaxe après les gros changements
- Tu me dis quand c'est prêt à tester

### 3. Audit / Vérification (déclencheurs : "vérifie", "audit", "check")
- Tu ne modifies rien
- Tu lis les fichiers concernés
- Tu rapportes en sections avec sévérité 🔴 / 🟡 / 🟢
- Tu attends ma demande explicite pour corriger

Si tu n'es pas sûr de mon intention, demande-moi.

---

## 🚦 Workflow typique pour un changement

1. Je décris ce que je veux
2. Tu poses 1-2 questions de clarification si nécessaire
3. Tu proposes un plan textuel (fichiers touchés, approche, risques)
4. Je valide ou ajuste
5. Tu codes en mini-incréments, je vois chaque diff
6. Je teste en local (`npm run dev` sur `localhost:5174`)
7. Je dis "OK ça marche" ou "il y a un bug, voilà"
8. **Avant le commit : mettre à jour le numéro de version dans le menu** (recherche `v5.` dans App.jsx pour trouver la ligne exacte)
9. On commit + push si tout va bien

---

## 🧪 Comment je teste

- En local : `npm run dev` sur `http://localhost:5174`
- Pour le Versus : 2 onglets (un normal, un privé) avec 2 pseudos différents
- Je vérifie visuellement ET fonctionnellement
- Si bug, je copie-colle le message d'erreur de la console JS

---

## ⚡ Règles de sortie (économie de tokens)

Ces règles s'appliquent à TOUTES les réponses sauf si je dis explicitement le contraire.

- Pas de préambule ("Voici ce que je vais faire...", "Comme demandé...", "Bien sûr !")
- Pas de reformulation de ma question avant de répondre
- Pas de résumé à la fin sauf si je le demande
- Pas de sycophantie ("Excellente question !", "Très bon point !")
- Réponse directe : code ou explication, pas les deux sauf si nécessaire
- Si c'est du code : le code seul, commentaires uniquement si non-évidents
- Si c'est une explication : texte dense, pas de listes à puces inutiles
- "Je ne sais pas" plutôt qu'une réponse inventée
- Les instructions de Mathieu écrasent toujours ces règles

---

## 🚀 Déploiement

- Push sur `main` → Vercel auto-deploy
- Pas de tests automatisés en CI (encore)
- Je vérifie en local AVANT de push
- Si bug en prod, on rollback via Vercel ou révert Git
