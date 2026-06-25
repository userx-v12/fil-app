# Session Log — Fil App

> Ce fichier est mis à jour à la fin de chaque session Claude Code.
> Il doit être lu en priorité au début de chaque nouvelle session.

---

## Prompt de fin de session (à coller dans Claude Code avant de fermer)

```
Avant de fermer : mets à jour SESSION_LOG.md à la racine avec un résumé complet de cette session. Structure :

## Session du [date]
### Ce qu'on a fait
### Bugs corrigés (bug → cause → fix exact avec fichier + ligne)
### État actuel du code (version + ce qui marche)
### Ce qui reste à faire
### Pièges à éviter (ce qu'il ne faut JAMAIS remettre à l'ancienne version)

Sois précis et factuel. Ce fichier sera la première chose lue à la prochaine session.
```

## Prompt de début de session (à coller dans Claude Code au démarrage)

```
Lis CLAUDE.md et SESSION_LOG.md. Dis-moi en 3 lignes où on en est et ce qu'on avait prévu de faire.
```

---

## Session du 2026-06-25 — v5.25

### Ce qu'on a fait

**Sujet 3 — Suppression du bouton d'installation PWA**
- Supprimé : 3 states (`installPrompt`, `installType`, `showInstallPopup`), le useEffect de capture `beforeinstallprompt`/détection iOS, la fonction `handleInstallClick`, le `TopRoundButton position="center"`, et la popup entière (overlay + contenu)
- `manifest.json`, `sw.js` et les icônes PNG conservés intacts — la PWA reste installable via le navigateur

**Sujet 1 — Supabase Auth (comptes email/password)**

Migration DB préalable exécutée par Mathieu dans Supabase :
- Nouvelle table `profiles` (FK vers `auth.users`) avec colonnes stats solo/versus + `versus_elo` / `solo_score` (Elo, pour le sujet 2 à venir) + `filter_preset` JSONB
- Colonne `user_id UUID REFERENCES auth.users(id)` ajoutée dans `match_players` (nullable)
- RLS activé sur `profiles` : lecture publique, écriture sur son propre profil uniquement

Code ajouté dans `src/App.jsx` :
1. **`pushStatsToProfile(userId)`** (top-level, l.~1271) — lit depuis localStorage, pousse vers `profiles` via UPDATE
2. **`syncProfile(user)`** (top-level) — upsert avec `ignoreDuplicates: true` pour créer la ligne si absente, puis SELECT
3. **États `authUser` / `profile`** dans App + useEffect auth : `getSession()` au mount + listener `onAuthStateChange`
4. **`AuthScreen`** (nouveau composant, juste avant `AccountScreen`) — email/password, toggle login/inscription, écran de confirmation d'email après inscription
5. **`AccountScreen` refondu** — carte "Compte" (email + bouton Déconnexion si connecté, bouton "Se connecter" sinon) ; stats lues depuis `profiles` si connecté, localStorage sinon ; popup de migration localStorage → compte (déclenchée au premier login si données locales présentes, flag `fil-migrated` en LS pour ne pas reproposer) ; pseudo éditable synchronisé vers `profiles.username` si connecté ; texte de bas de page adapté
6. **Sync stats DB** après chaque partie : `pushStatsToProfile` appelé dans l'useEffect `isAtEnd` de `Game` (solo fin), dans le handler abandon solo, et dans l'useEffect `statsTracked` de `VersusEndScreen`
7. **`joinMatch`** étendu à `(matchId, playerName, slot, userId = null)` — remplit `match_players.user_id` si connecté ; appelé depuis `handleCreateVersusRoom` (App) et `VersusJoinScreen`
8. Nouveau screen `"auth"` câblé dans App, `VersusJoinScreen` reçoit `authUserId` prop

**CLAUDE.md mis à jour** : règle "mettre à jour le numéro de version dans le menu avant chaque commit" ajoutée dans "TOUJOURS faire" et dans le workflow étape 8.

### Bugs corrigés

Aucun bug — uniquement features + suppression.

(Rattrapage : version affichée dans le menu était restée à `v5.24` après le premier commit `0782d82` → corrigée en `v5.25` dans le commit suivant `749000b`.)

### État actuel du code

- **Version affichée : v5.25**
- Commits pushés sur `main` : `0782d82` (Auth + suppression PWA), `749000b` (fix version + CLAUDE.md)
- Fichiers modifiés : `src/App.jsx`, `CLAUDE.md`
- Mathieu a testé et confirmé : connexion, inscription, stats, tout fonctionne

### Ce qui reste à faire (backlog v5.26+)

1. **Système Elo + Rangs** (dépend de l'auth — prêt à implémenter) : colonnes `versus_elo` et `solo_score` déjà créées dans `profiles`. Plan validé :
   - Versus Elo : classique K=32, départ 1000
   - Solo Score : cumulatif par partie (abandon -3/-5/-5, fini +5/+10/+15, optimal +12/+22/+35 selon Facile/Moyen/Difficile), plancher 800
   - Rangs : Figurant / Second Rôle / Premier Rôle / Vedette / Légende (seuils séparés Solo et Versus)
   - Affichage : écran Compte + fin de partie Versus (+/- Elo) + badge lobby
2. Redesign visuel (en cours séparément sur Figma)
3. `character_name` dans `credits` — migration DB
4. `original_title` dans `works` — migration DB
5. Phase 6 : App iOS via Capacitor

### Pièges à éviter

- **`pushStatsToProfile` lit depuis localStorage** — elle est appelée juste après les `inc*` / `add*` localStorage, donc les valeurs sont déjà à jour au moment de l'appel. Ne pas inverser l'ordre.
- **`syncProfile` utilise `ignoreDuplicates: true`** — c'est voulu : insert si absent, rien si déjà là. Ne pas remplacer par un upsert qui écraserait les stats existantes.
- **`LS_MIGRATED = "fil-migrated"`** : clé localStorage qui évite de reproposer la migration à chaque login. Ne pas la supprimer.
- **La popup migration est déclenchée dans AccountScreen** (useEffect sur `authUser + profile`), pas dans App. Si on refactorise AccountScreen, conserver ce useEffect.
- **`match_players.user_id` est nullable** — les guests sans compte continuent de fonctionner avec `player_token` uniquement. Ne pas rendre la colonne NOT NULL.
- **Mettre à jour `v5.X` dans le menu avant chaque commit** (grep `v5.` dans App.jsx, l.~1862).

---

## Session du 2026-06-16 — v5.20 → v5.24

### Ce qu'on a fait

**Refonte complète du mode Versus** (gros chantier en un seul passage, demandé explicitement "tout d'un coup" par Mathieu) :

1. **Salons persistants (v5.20)** — la revanche ne crée plus un nouveau match/code : reset en place du même salon (`matches.id` inchangé). Helpers ajoutés : `getPlaceholderWork()` (l.614), `saveCustomPick()` (l.647), `resetMatchPlayersForNewRound()` (l.679). `startMatch` étendu à `(matchId, victoryCondition, customStart, customEnd)` (l.597).

2. **Refonte UI Versus (v5.21)** :
   - `VersusCreateScreen` et `VersusJoinManualScreen` supprimés. "Créer une partie" crée le salon instantanément (`handleCreateVersusRoom`, l.1584) et affiche le code direct ; pseudo éditable en haut, réglages réordonnés (Condition de victoire / Type de partie / Mode / Difficulté / Options du défi).
   - `VersusJoinScreen` (l.4143) fusionné : pseudo + code en un seul écran.
   - Mode Standard : suppression du système propose/accepte/refuse. N'importe quel joueur peut rafraîchir départ/arrivée/les deux à tout moment (`applyNewDefi`, l.747), ce qui remet les 2 "OK pour moi" à zéro (`setReadySlot`, l.762, fusionne dans `pending_change` au lieu d'écraser).
   - Auto-démarrage (countdown) dès que les 2 joueurs sont "OK" — plus de bouton "Démarrer" créateur, ni en Standard ni en Sur-mesure.
   - Sur-mesure (renommé depuis "Personnalisé") : rôles départ/arrivée tirés au hasard à chaque manche, choix simultané des 2 joueurs.
   - Revanche "écran vierge" : `resetMatchDefi()` (l.622) remet `start_id = end_id` (placeholder) + `pending_change = null`, le lobby affiche un bouton "Tirer un défi" plutôt que de relancer un défi automatiquement.
   - Mode Temps : arrêt forcé de l'adversaire dès qu'un joueur finit (logique affinée v5.23, voir plus bas).
   - Série de victoires consécutives en mémoire (pas de DB), affichée sur l'écran de fin à partir de 2.

3. **Design Sur-mesure (v5.24)** : les labels révélaient le rôle tiré au hasard ("Tu choisis le départ/l'arrivée") → remplacés par "Ton film" / "Film de {adversaire}" (l.4741, l.4791) pour garder le suspense. Faux titre flouté ("Titre mystère" / "20XX") ajouté à côté de l'affiche floutée de l'adversaire pour renforcer l'illusion de dissimulation.

### Bugs corrigés

1. **Affiche de son propre choix invisible en Sur-mesure** (v5.22)
   - Cause : `pending_change.startPick`/`endPick` ne stocke que `{id, type}` (pas de titre/affiche), donc le `<Poster>` du joueur affichait une carte vide.
   - Fix : ajout d'un fetch dédié `myPickWork` (effect autour de l.4370, miroir de `opponentPickWork`) qui va chercher le titre/affiche complets via `getWorksByPairs`.

2. **Pas de confirmation "OK pour moi" en Sur-mesure** (v5.22)
   - Cause : l'auto-démarrage se lançait dès que les 2 joueurs avaient choisi leur film, sans étape de validation (contrairement au mode Standard).
   - Fix : ajout du même mécanisme `readySlots` qu'en Standard, gating l'auto-start sur `bothPicked && bothOk` (effect "Auto-start" dans `VersusLobbyScreen`).

3. **Revanche qui relance le même défi en ~1s avec "gagné" pour les deux** (v5.22) — **bug le plus sérieux de la session**
   - Cause racine : `matches.status` n'était **jamais** mis à `"finished"` nulle part dans le code. La revanche réclame le reset via `.eq("status", "finished")` → ce claim échouait silencieusement à 100% du temps → `match_players` jamais réinitialisé, `matches.status` restait `"playing"` → le lobby retombait sur l'ancien statut et relançait directement l'ancienne partie avec des données `match_players` périmées (chaque joueur voyait l'adversaire "déjà fini" avec son ancien temps, d'où le double "gagné").
   - Fix : nouvelle fonction `finishMatch(matchId)` (l.694, `UPDATE matches SET status='finished' WHERE status='playing'`), appelée dans l'effet de fin de manche de `VersusEndScreen` dès que `bothDone`.

4. **`setReadySlot` écrasait `pending_change`** (v5.22)
   - Cause : l'update remplaçait tout l'objet JSONB par `{readySlots: [...]}`, effaçant `phase`/`startSlot`/`endSlot`/`startPick`/`endPick` du mode Sur-mesure dès qu'on cliquait "OK pour moi".
   - Fix : merge (`{ ...base, readySlots: next }`) au lieu d'écraser (l.762-770).

5. **Bouton Revanche qui disparaît pour l'un des deux joueurs** (v5.23)
   - Cause : `resetMatchPlayersForNewRound` (appelé par la revanche) remet `finished=false` sur les 2 lignes `match_players` — le joueur encore sur son écran de fin (qui n'a pas cliqué "Revanche") reçoit cet update en Realtime, son `opponentFinished` repasse à `false`, donc `bothDone` aussi → les 3 variantes du bouton Revanche (toutes gatées sur `bothDone`) disparaissent, ne laissant que "Menu".
   - Fix : `bothDoneAchievedRef` (l.2247) dans `Game` — une fois que `finished && opponentFinished` ont été vrais une fois, on gèle la prise en compte des updates `match_players` suivants (l.2304 `if (bothDoneAchievedRef.current) return;`). Les updates légitimes (suivi live de l'adversaire pendant qu'il joue encore) continuent de passer puisque le gel n'intervient qu'après la conclusion réelle des 2 manches.

6. **Priorité indices/temps incorrecte en mode Temps** (v5.23)
   - Cause : le verdict comparait le temps avant les indices ("temps d'abord, puis indices"), alors que la règle voulue est l'inverse — un indice est une pénalité qui doit passer avant le temps.
   - Fix : inversion de l'ordre dans le calcul du verdict (l.3498) et dans les 2 calculs `winner` des `VersusPlayerCard` (recherche `victoryCondition === "time"` dans le fichier). L'arrêt forcé du 2e joueur (l.2359-2369) ne se déclenche plus immédiatement dès que le 1er finit : seulement si le 1er a fini avec 0 indice ; sinon le 2e continue jusqu'à atteindre/dépasser le nombre d'indices du 1er (`if (hintsUsed < opponentHintsUsed) return;`).

### État actuel du code

- **Version affichée : v5.24**
- Commits (tous pushés sur `main`) : `40a7e8a` (v5.20), `d448268` (version bump), `9e2257f` (v5.21 refonte), `ce52e5c` (v5.22 fixes), `92df818` (v5.23 fixes), `900ebbb` (v5.24 design)
- Fichier modifié : `src/App.jsx` uniquement, aucune migration DB (tout repose sur les colonnes JSONB existantes, réutilisées avec des clés différentes selon le contexte : `pending_change.readySlots` en Standard, `pending_change.{phase, startSlot, endSlot, startPick, endPick, readySlots}` en Sur-mesure)
- Mathieu a testé en local et confirmé : **tout fonctionne nickel** (Standard + Sur-mesure : création, lobby, double consentement, picking sur-mesure, revanche, mode Temps, design flouté).
- Pas de tests automatisés — validation faite manuellement par Mathieu (2 onglets navigateur).

### Ce qui reste à faire (backlog v5.25+)

1. Supabase Auth — comptes réels, stats cross-device (priorité haute, projet 1-2 jours)
2. `character_name` dans `credits` — nom du personnage joué dans le casting
3. `original_title` dans `works` — recherche cross-langue
4. Phase 6 : App iOS via Capacitor
5. (Mineur, non demandé) Les filtres avancés (Mode Films/Mix/Séries, Difficulté, eras/rating/langues/genres) restent en state local `versusPrefs` côté créateur uniquement — si l'invité clique "Nouveau défi" en Standard, il utilise ses propres filtres par défaut (pas ceux du créateur), puisque rien n'est synchronisé en DB pour ces réglages-là. Comportement préexistant, pas corrigé dans cette session (uniquement `victory_condition` et `custom_mode` ont été rendus live en DB).

### Pièges à éviter

- **NE JAMAIS retirer `finishMatch(matchId)` de l'effet `bothDone` dans `VersusEndScreen`.** Sans ça, `matches.status` ne repasse jamais à `"finished"` et toute la mécanique de revanche (atomic claim `.eq("status","finished")`) échoue silencieusement à 100% du temps. C'était LE bug racine de la v5.21 → v5.22.
- **NE JAMAIS faire `pending_change: {...nouvelObjet}` sans merge.** Le JSONB `pending_change` est multi-usage (proposition standard obsolète maintenant supprimée, `readySlots` standard, `{phase, startSlot, endSlot, startPick, endPick, readySlots}` en sur-mesure). Toujours `{ ...base, ...champsModifiés }`. Exception volontaire : `applyNewDefi` et le tirage des rôles font un remplacement complet intentionnel (reset volontaire d'une nouvelle phase).
- **NE JAMAIS retirer le `bothDoneAchievedRef` gate dans `Game`** (l.2304) sur la subscription `match_players`. Sans lui, le reset de la revanche fait revivre `opponentFinished=false` chez le joueur qui regarde encore son écran de fin, et le bouton Revanche disparaît pour lui.
- **NE JAMAIS revenir à "temps d'abord, puis indices" dans le mode Temps.** La règle voulue par Mathieu est indices d'abord (pénalité), puis temps, puis étapes — décision explicite prise dans cette session, pas une erreur à corriger.
- **NE JAMAIS réafficher "départ"/"arrivée" dans l'UI Sur-mesure pendant la phase de choix.** C'est une décision de design délibérée pour garder le suspense (le rôle est tiré au hasard et ne doit pas être révélé avant le lancement). Toujours utiliser un libellé neutre ("Ton film" / "Film de X").
- **Le mode Standard démarre toujours "vierge"** (pas de défi auto-tiré, ni à la création ni à la revanche) — c'est un choix délibéré pour unifier les deux flux sous le même mécanisme (`start_id === end_id` comme sentinel "pas de défi"). Si Mathieu veut un jour revenir à l'auto-pick immédiat à la création (pas à la revanche), il faudra distinguer les deux cas — actuellement ils partagent le même chemin de code.
- **`startMatch` a maintenant un guard atomique `.eq("status", "waiting")`** et retourne `null` (pas une erreur) si 0 lignes affectées — c'est volontaire (claim atomique anti-double-lancement). Ne pas remettre `.single()` qui throw sur 0 lignes.

---

## Session du 2026-06-14 — v5.19 (fin de session)

### Ce qu'on a fait

**3 corrections UI (tâche autonome)**

1. **Barre d'actions en bas pendant les parties** (`src/App.jsx` l.~2686)
   - Fond quasi-opaque : `rgba(250,250,250,0.97)` light / `rgba(10,14,24,0.97)` dark — remplace `...glass` semi-transparent
   - `backdropFilter: blur(20px) saturate(140%)` conservé
   - `transform: translateZ(0)` ajouté → GPU layer, corrige le bug `position: fixed` qui scrollait avec la page sur iOS Safari

2. **Stabilité du titre Filmographie / Casting** (`src/App.jsx` l.~2906 ActorPicker, l.~3013 MoviePicker)
   - "Trier · Popularité" est plus large que "Trier · Rôle" / "Trier · Date" → le titre dérivait à gauche au clic
   - Fix : `minWidth: 95` sur le `div` wrapper du bouton de tri dans les deux pickers

3. **Taille des images** (`src/App.jsx` l.~2947 et l.~3058)
   - `ActorPhoto` : 56 → 68px (grille 3 colonnes dans ActorPicker)
   - `Poster` : 42 → 52px, `rounded` 7 → 8 (liste dans MoviePicker)

**Version bump**
- Numéro v5.18 → v5.19 dans le menu (`src/App.jsx` l.~1920)

### Bugs corrigés
Aucun — corrections UI et polish uniquement.

### État actuel du code
- **Version affichée : v5.19**
- Commits : `a61a50b` (UI fixes), `46e29df` (version bump), pushés sur `main`
- Vercel auto-deploy déclenché
- Fichier modifié : `src/App.jsx` uniquement

### Ce qui reste à faire (backlog v5.20+)
1. Supabase Auth — comptes réels, stats cross-device (priorité haute, projet 1-2 jours)
2. `character_name` dans `credits` — nom du personnage joué dans le casting
3. `original_title` dans `works` — recherche cross-langue
4. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- **Barre du bas** : NE PAS repasser à `...glass`. Le `glassBg` est rgba 55-65%, le contenu défile visible derrière. Toujours utiliser les rgba opaques explicites `(250,250,250,0.97)` light / `(10,14,24,0.97)` dark.
- **Mode personnalisé Versus** : `pending_change` est réutilisé pour stocker `{ custom_end_id, custom_end_type, invitee_ready: true }` — mutuellement exclusif avec le système de proposition normal. Ne pas mélanger les deux.
- **`startMatch`** a 3 params : `(matchId, victoryCondition, customEnd)`. Ne pas oublier `customEnd` si on retouche cette fonction.
- **Condition de victoire** : le mode "Étapes" est stocké `hybrid` en DB, le mode "Temps" est `time`. Ne pas renommer en DB.

---

## Session du 2026-06-14 — v5.19

### Ce qu'on a fait

**Sujet 3 — Mode Versus personnalisé (Option A)**
- Toggle "Standard / Personnalisé" dans VersusCreateScreen (Type de partie)
- En mode personnalisé : créateur choisit son film de départ via search inline (debounce 250ms, même pattern que CustomScreen)
- `createMatch` : `custom_mode = true`, `start_id = film choisi`, `end_id = start_id` (placeholder), `difficulty = "custom"`, `optimalSteps = 0`
- Dans le lobby (créateur) : voit son film + "✓ Film choisi" / "En attente" selon `match.pending_change.invitee_ready`
- Dans le lobby (invité) : voit "🎬 Mystère" pour le départ + search inline pour choisir son film d'arrivée
- Invité valide → `saveCustomInviteeFilm(matchId, film)` → UPDATE `pending_change = { custom_end_id, custom_end_type, invitee_ready: true }`
- Créateur voit le ✓ via Realtime (subscription matches déjà en place)
- "Démarrer" désactivé tant que `!match.pending_change?.invitee_ready`
- `handleStart` : extrait `customEnd` depuis `pending_change`, passe à `startMatch`
- `startMatch` accepte `customEnd` → UPDATE atomique `end_id + end_type + status + victory_condition`
- Filtres Mode/Difficulté/Options + système de proposition masqués en mode personnalisé
- `customCreatorFilm` hydraté au chargement du lobby (getWorksByPairs sur start_id)
- `customCreatorFilm` se refresh si start_id change (useEffect sur `match.start_id`)
- Fonctions ajoutées : `updateCustomStartFilm`, `saveCustomInviteeFilm` (top-level)
- Colonne DB ajoutée par Mathieu : `custom_mode BOOLEAN DEFAULT false`
- Commit : `34e283f`

### Bugs corrigés
Aucun bug — uniquement features.

### État actuel du code
- Version affichée : v5.18 (menu non mis à jour — à faire), commit `34e283f`, pushé `main`
- Fichier modifié : `src/App.jsx` uniquement

### Ce qui reste à faire (backlog v5.20+)
1. Supabase Auth (priorité haute)
5. `character_name` dans `credits`
6. `original_title` dans `works`
7. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- En mode personnalisé : `pending_change` est **réutilisé** pour stocker le choix de l'invité `{ custom_end_id, custom_end_type, invitee_ready: true }` — NE PAS confondre avec le système de proposition normal (proposedBySlot, new_start, new_end). Les deux sont mutuellement exclusifs (`custom_mode = true` désactive la proposition).
- `startMatch` a maintenant 3 params : `(matchId, victoryCondition, customEnd)`. Le `customEnd` est extrait de `match.pending_change` dans `handleStart`. Ne pas oublier ce troisième paramètre si on touche à `startMatch`.
- En mode personnalisé, `end_id` dans la DB vaut `start_id` jusqu'au lancement (placeholder). C'est l'UPDATE dans `startMatch` qui fixe le vrai `end_id`. Ne pas interpréter ce placeholder comme une erreur.
- `customCreatorFilm` (state dans VersusLobbyScreen) est uniquement visible par le créateur (slot 1) — l'invité voit "🎬 Mystère".

---

## Session du 2026-06-14 — v5.18 (suite)

### Ce qu'on a fait

**Sujet 1 — Règles de victoire Versus (indices comme pénalité)**
- Nouvelle priorité : étapes → indices (pénalité) → temps
- Si égalité d'étapes : celui avec moins d'indices gagne, même s'il est plus lent
- Si égalité d'étapes ET d'indices : le plus rapide gagne
- Fichier : `src/App.jsx`
  - Verdict texte : l.~3436 (bloc `else` de l'égalité d'étapes)
  - Prop `winner` VersusPlayerCard joueur : ajout condition `myHintsUsed < opponentHintsUsed`
  - Prop `winner` VersusPlayerCard adversaire : symétrique

**Sujet 4 — Suivi live du parcours adversaire après avoir fini**
- Quand un joueur a fini mais l'adversaire joue encore → PathStrip de l'adversaire en direct
- Nouveau state `opponentLivePath` (raw IDs) dans Game, alimenté par la subscription Realtime existante sur `match_players` (champ `current_path`)
- Nouveau state `opponentLiveHydrated` dans VersusEndScreen, hydraté via useEffect à chaque update de `opponentLivePath`
- Affiché dans le bloc `!bothDone` avec bordure `versusOpponent` et label "Parcours de X en direct"
- Fichier : `src/App.jsx`
  - `opponentLivePath` state : l.~2258
  - Realtime capture : l.~2318 (`setOpponentLivePath(p.current_path)` si `!p.finished`)
  - Prop passée à VersusEndScreen : l.~2553
  - `opponentLiveHydrated` state + useEffect hydration : dans VersusEndScreen, juste avant l'useEffect `bothDone`
  - Affichage : dans le bloc `!bothDone`, après les deux VersusPlayerCard

**Sujet 2 — Condition de victoire configurable**
- 2 modes : **Étapes** (DB : `hybrid`) et **Temps** (DB : `time`)
- Mode Étapes : étapes → indices → temps (comportement historique)
- Mode Temps : temps → indices → étapes → égalité parfaite (inverse)
- Colonne `victory_condition` déjà présente en DB (VARCHAR, DEFAULT `'hybrid'`)
- Toggle 2 boutons dans VersusCreateScreen (entre Difficulté et Options du défi)
- Toggle 2 boutons dans VersusLobbyScreen (créateur uniquement, dans le bloc `iAmCreator`)
- `createMatch` accepte `victoryCondition` → INSERT dans DB
- `startMatch` accepte `victoryCondition` → UPDATE dans DB au lancement (écrase la valeur de création)
- `prepareAndStartVersusGame` lit `match.victory_condition` → stocké dans `versusContext.victoryCondition`
- VersusEndScreen reçoit `victoryCondition` en prop → verdict branché (if `"time"` / else `"hybrid"`)
- Label "Mode Temps" / "Mode Étapes" affiché sous "Versus" en fin de partie
- `versusPrefs` initialisé avec `victoryCondition: "hybrid"` (l.~1285)
- Revanche : passe aussi `victoryCondition` à `createMatch`

**Numéro de version**
- Menu mis à jour : `v5.17` → `v5.18` (l.1903)
- Commit pushé : `c8533c7`

### Bugs corrigés
Aucun bug — uniquement des features.

### État actuel du code
- Version affichée : v5.18, commit `c8533c7`, pushé sur `main`
- Fichiers modifiés cette session : `src/App.jsx` uniquement + `package.json` / `package-lock.json` (déjà modifiés avant)
- Tout compilé sans erreur

### Ce qui reste à faire (backlog v5.19+)
1. Sujet 3 — Versus personnalisé : créateur choisit le départ, invité choisit l'arrivée (Option A validée) — mode optionnel, pas le défaut
2. Supabase Auth — comptes réels, liste d'amis, stats cross-device (priorité haute)
3. `character_name` dans `credits` — migration DB pour afficher le rôle joué dans le casting
4. `original_title` dans `works` — migration DB pour recherche cross-langue
5. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- **`victory_condition` est sauvegardée 2 fois** : à `createMatch` (INSERT) ET à `startMatch` (UPDATE). C'est voulu — le lobby peut changer la valeur entre création et lancement. Ne pas supprimer le UPDATE dans `startMatch`.
- **Mode Étapes = valeur DB `hybrid`** — ne pas confondre avec un hypothétique `steps` qui n'existe pas et n'a jamais été implémenté
- **`opponentLivePath` ne se met à jour que si `!p.finished`** — intentionnel : une fois fini, c'est `opponentPath` (hydraté depuis DB) qui prend le relais
- **L'hydration live repart à zéro à chaque update du path** — pas de cache incrémental. Si performances problématiques un jour, ajouter un ref-cache des IDs déjà fetché
- Le verdict dans VersusEndScreen ET les props `winner` des VersusPlayerCard doivent rester synchronisés — si on touche l'un, toucher l'autre
- NE JAMAIS remettre un fetch handler dans `sw.js` (Safari cassé)
- `getStoredPlayerName` (pas `loadPlayerName`)
- `versusContext.opponentPlayerId` peut être null

---

## Session du 2026-06-13 — v5.18

### Ce qu'on a fait

**PWA — Raccourci écran d'accueil** (session précédente, contexte compressé)
- `public/manifest.json` : name "Fil — Relie les films", short_name "Fil", display standalone, icons 192/512/maskable
- `public/sw.js` : service worker (install/activate/fetch)
- `public/icon.svg` : 512x512, fond `#0f1729`, foudre `#863bff` (`translate(64,72) scale(8)`)
- `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` : générés via `@resvg/resvg-js` + `scripts/generate-icons.mjs`
- `index.html` : lang="fr", manifest, theme-color, apple-touch-icon, apple-mobile-web-app-*, enregistrement SW
- Bouton install centré (`TopRoundButton position="center"`) dans le menu — toujours visible (pas conditionné à `installType`)
- Popup d'install adaptative :
  - Android (`installType === "android"`) → bouton "Installer l'app" déclenche le prompt natif via `deferredPromptRef`
  - iOS (`installType === "ios"`) → instruction "⬆ en bas de Safari → Sur l'écran d'accueil"
  - Autre/desktop (`installType === null`) → instruction Chrome ⋮
- Commits dans cet ordre : `b0f3186` (bouton toujours visible), `7b2322c` (popup adaptative + docs), `9c3caac` (fix SW Safari)

**Fix popup install** (cette session)
- Ancienne version : popup conditionnée à `showInstallPopup && installType` → ne s'affichait pas si `installType` était null
- Nouvelle version : popup conditionnée à `showInstallPopup` uniquement — s'affiche toujours, contenu adapté selon `installType`

**Fix critique SW Safari**
- SW original avait un fetch handler cache-first sur TOUS les GET → interceptait les appels Supabase, les mettait en cache et servait des données périmées
- Chrome tolérait ça, Safari cassait complètement l'app (page blanche ou données bloquées)
- Fix : SW sans fetch handler — il existe juste pour satisfaire le prérequis PWA (manifest + SW = installable), ne touche à aucune requête

### Bugs corrigés

**Bug critique — Fil cassé sur Safari (iOS + macOS)**
- Symptôme : app ne fonctionnait plus sur Safari (mobile et desktop), seulement sur Chrome
- Cause : `public/sw.js` interceptait tous les GET requests avec `e.respondWith(caches.match(...))` — les appels Supabase (`xjfxezwtwjhudrbtbpnv.supabase.co`) étaient cachés au premier appel, puis servis depuis le cache au lieu du réseau
- Fix : suppression totale du `fetch` handler dans `public/sw.js`. SW réduit à install (skipWaiting) + activate (purge des anciens caches + claim). Commit `9c3caac`

### État actuel du code
- Version : v5.18, commit `9c3caac`, pushé sur `main`
- Fichiers PWA : `public/sw.js`, `public/manifest.json`, `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `scripts/generate-icons.mjs`
- `index.html` : manifest + SW enregistrement
- `src/App.jsx` : bouton install + popup + states `installType` / `showInstallPopup` / `deferredPromptRef`
- Tout fonctionne : Safari iOS, Safari macOS, Chrome, install PWA validé par Mathieu

### Ce qui reste à faire (backlog v5.19+)
1. Supabase Auth — comptes réels, liste d'amis, stats cross-device (priorité haute, Mathieu veut ça)
2. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits`)
3. `original_title` dans `works` pour recherche cross-langue
4. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- **NE JAMAIS remettre un fetch handler dans `sw.js`** — même "network-first", même "navigation only" — le jeu est 100% online, le SW ne doit rien cacher. La dernière fois ça a cassé Safari complètement.
- Le bouton install s'affiche TOUJOURS sur le menu (pas de condition `installType &&` sur le bouton ni sur la popup) — ne pas remettre ce gate
- `installType` est null par défaut, devient "android" si `beforeinstallprompt` se déclenche, "ios" si userAgent iOS détecté au mount
- `public/icon-*.png` sont générés via `node scripts/generate-icons.mjs` (requiert `@resvg/resvg-js` en devDependency)
- Si on modifie l'icône SVG, relancer `node scripts/generate-icons.mjs` et committer les PNG mis à jour

---

## Session du 2026-06-13 — v5.16

### Ce qu'on a fait

**Gestion déconnexion adversaire en Versus**
- Presence channel Supabase par match (`presence:game-${matchId}`) : chaque joueur track `{ playerId }` à l'entrée en jeu
- Détection instantanée via event `leave` → state `opponentDisconnectedAt` (timestamp)
- Reconnexion silencieuse via event `join` → reset `opponentDisconnectedAt` à null
- Grace period 30s : l'useEffect de victoire tourne via le timer `elapsed` existant (100ms), pas de setInterval supplémentaire
- Victoire : `finishPlayer(myPlayerId, { abandoned: false })` + `finishPlayer(opponentPlayerId, { abandoned: true })` → déclenche le flow Realtime existant vers VersusEndScreen
- Chrono préservé sur reconnexion : `startTime` stocké en localStorage (`vs_start:{matchId}:{myPlayerId}`), restauré au remount
- Bannière ambre en jeu : "X s'est déconnecté — victoire dans Ns" avec countdown (se met à jour via `elapsed`)

**Synchronisation affiches dans le lobby Versus**
- `defiWorks` useEffect gated sur `bothReady` : les affiches ne chargent que quand les deux joueurs sont présents → découverte simultanée
- Quand `!bothReady`, la card "Le défi" affiche un placeholder texte au lieu d'affiches
- Quand `pendingChange` actif, la section défi affiche `pendingChange.new_start/new_end` pour les DEUX joueurs (au lieu de `defiWorks` côté proposeur) → plus d'asymétrie

### Bugs corrigés
Aucun bug — uniquement des features.

### État actuel du code
- Version : v5.16 (committée et pushée sur `main`, commit `6744780`)
- Fichiers modifiés : `src/App.jsx` uniquement
- Tout testé et validé par Mathieu

### Ce qui reste à faire (backlog v5.17+)
1. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits`) — à faire quand décidé
2. `original_title` dans `works` pour recherche cross-langue — migration DB séparée
3. Phase 6 : App iOS via Capacitor
4. Countdown avant lancement (les deux joueurs commencent vraiment en même temps) — explicitement reporté

### Pièges à éviter
- Ne PAS accepter les modifications automatiques de Claude Code sans plan validé au préalable
- Ne PAS réécrire App.jsx en entier même si demandé
- Les tableaux vides `[]` sont truthy en JS — toujours vérifier `.length > 0` avant de considérer un cache comme valide
- Ne PAS oublier de passer `opponentHintsUsed` dans toutes les VersusPlayerCard (bug v5.12)
- Le numéro de version affiché dans le menu (l.1794 de App.jsx) doit être mis à jour manuellement à chaque release — ne pas oublier avant de push
- `filterMode` est toujours `"include"` dans toute l'app — ne PAS remettre le toggle ni passer en `"exclude"` par défaut
- `TopRoundButton` a 3 positions : `"left"` (bouton ?), `"left2"` (thème), `"right"` (compte)
- `versusContext.opponentPlayerId` peut être null si l'adversaire n'a pas encore rejoint — toujours vérifier avant d'appeler `finishPlayer` sur lui
- Le Presence channel utilise `String(playerId)` comme clé — les UUIDs sont des strings, ne pas comparer sans cast
- Les affiches du lobby ne chargent qu'une fois `bothReady === true` — c'est voulu, ne pas enlever ce gate

---

## Session du 2026-06-13 — v5.17 (suite)

### Ce qu'on a fait

**Stats compte — abandons + indices**
- 3 nouvelles clés localStorage : `fil-solo-abandons`, `fil-solo-hints`, `fil-versus-hints`
- `incSoloAbandons()` + `addSoloHints(hintsUsed)` dans `handleAbandonClick` (solo uniquement)
- `addSoloHints(hintsUsed)` dans le useEffect `isAtEnd` (victoire solo)
- `addVersusHints(myHintsUsed)` dans le useEffect `statsTrackedRef` de VersusEndScreen
- AccountScreen : "Abandons" (ambre) + "Indices utilisés" dans solo ; "Indices utilisés" dans Versus

**Countdown avant lancement Versus**
- State `countdown` (null → 3 → 2 → 1 → 0) + `matchToStartRef` dans `VersusLobbyScreen`
- useEffect status "playing" déclenche `setCountdown(3)` au lieu de `onStartGame` directement
- useEffect décompte via `setTimeout` 1s, appelle `onStartGame` quand countdown atteint 0
- Overlay `position: fixed, zIndex: 200` : gros chiffre centré (144px), "GO !" en vert (96px)

**Écran Compte — Pseudo modifiable + stats locales**
- Bug corrigé au passage : `loadPlayerName` → `getStoredPlayerName` (nom réel de la fonction)
- Pseudo Versus : affiché + bouton "Modifier" → input inline, Entrée/Échap/bouton Enregistrer
- Stats Solo : parties jouées + détail par difficulté (Facile/Moyen/Difficile, indentés) + meilleur score + chemin optimal (nb de fois)
- Stats Versus : Victoires (vert) + Défaites (ambre) + chemin optimal (nb de fois)
- Note bas de page : "Stats enregistrées sur cet appareil · Comptes bientôt disponibles"
- Nouveaux localStorage : `fil-solo-easy/medium/hard`, `fil-solo-optimal`, `fil-versus-optimal`
- Tracking solo dans `isAtEnd` useEffect du composant Game (difficulté + optimal)
- Tracking Versus dans `VersusEndScreen` statsTracked useEffect (optimal + hints)
- Parties "custom" non comptées dans les catégories difficulté

### Bugs corrigés
- `loadPlayerName` inexistant → crash page blanche AccountScreen. Fix : `getStoredPlayerName`

### État actuel du code
- Version : v5.17 (committée et pushée, commit `d61ab77`)
- Fichiers modifiés : `src/App.jsx` uniquement

### Ce qui reste à faire (backlog v5.18+)
1. Supabase Auth — comptes réels, liste d'amis, stats cross-device (projet 1-2 jours)
2. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits`)
3. `original_title` dans `works` pour recherche cross-langue — migration DB séparée
4. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- `getStoredPlayerName` (pas `loadPlayerName`) pour lire le pseudo depuis localStorage
- Les parties "custom" ont `difficultyUsed === "custom"` → ne pas les compter dans les stats par difficulté
- `statsTrackedRef` dans VersusEndScreen empêche le double-comptage — ne pas retirer ce ref
- Le numéro de version (l.1794) doit être mis à jour manuellement AVANT chaque push
- Ne PAS réécrire App.jsx en entier même si demandé

---

## Session du 2026-06-12 — v5.14 + v5.15

### Ce qu'on a fait

**Backlog / nettoyage**
- Supprimé "Casting : séparer visuellement Casting du toggle de tri" du backlog (non-problème, purement cosmétique sans valeur réelle)
- Confirmé que `original_title` n'est pas en DB (table `works` ne stocke pas ce champ) → feature cross-langue mise en backlog comme migration séparée
- Confirmé que `character_name` n'est pas en DB non plus → migration DB requise, mis en backlog

**v5.14 — Polish OptionsScreen + refonte genres**
- Les 4 sections filtres (Époques, Note minimale, Langues, Genres) enveloppées dans une card glass (`borderRadius: 16, padding: 16`) style VersusFiltersPanel
- Boutons filtres réduits : `padding: "6px 12px"`, `fontSize: 11`, `letterSpacing: 2` (au lieu de 8/14, 12, 3)
- Section Genres : suppression du toggle Inclure/Exclure, remplacé par bouton "Tout cocher"/"Tout décocher" (même pattern que Langues)
- Même changement dans `VersusFiltersPanel`
- `DEFAULT_PREFS` migré : `filterMode: "include"`, `includeGenres: [28,12,35,80,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37]` (tous sauf Animation 16 et Documentaire 99), `excludeGenres: []`

**v5.15 — Bouton ? + recherche fuzzy**
- `TopRoundButton` : ajout d'une position `"left2"` (`left: max(62px, calc(50% - 240px + 62px))`)
- Bouton "?" ajouté à `position="left"`, ouvre `InfoModal` via `setShowInfo(true)`
- Bouton thème déplacé de `"left"` → `"left2"` (décalé de 46px à droite)
- Prop `onOpenInfo` retirée du composant `Menu` et de son call site (plus utilisée)
- Lien "Comment jouer ?" supprimé du JSX du `Menu`
- `import Fuse from "fuse.js"` ajouté (`npm install fuse.js`)
- `ActorPicker` : state `showSearch` + `searchQuery` + `searchRef`, icône loupe toggle l'input, fuzzy search sur `name` (threshold 0.4), "Voir plus" masqué pendant la recherche
- `MoviePicker` : même pattern, fuzzy search sur `title`
- Version affichée dans le menu corrigée : `v5.12` → `v5.15` (l.1794)

### Bugs corrigés
Aucun bug cette session — uniquement des features.

### État actuel du code
- Version : v5.15 (committée et pushée sur `main`)
- Fichiers modifiés : `src/App.jsx` uniquement + `package.json` / `package-lock.json` (fuse.js)
- Tout fonctionne : OptionsScreen, VersusFiltersPanel, bouton ?, recherche fuzzy casting + filmo

### Ce qui reste à faire (backlog v5.16+)
1. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits` + relance import 944k lignes) — à faire quand décidé
2. Gestion déconnexion adversaire (Supabase Presence channels)
3. `original_title` dans `works` pour recherche cross-langue (ex: "Star Wars" ↔ titre localisé) — migration DB séparée
4. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- Ne PAS accepter les modifications automatiques de Claude Code sans plan validé au préalable
- Ne PAS réécrire App.jsx en entier même si demandé
- Les tableaux vides `[]` sont truthy en JS — toujours vérifier `.length > 0` avant de considérer un cache comme valide
- Ne PAS oublier de passer `opponentHintsUsed` dans toutes les VersusPlayerCard (bug v5.12)
- Le numéro de version affiché dans le menu (l.1794 de App.jsx) doit être mis à jour manuellement à chaque release
- `filterMode` est maintenant toujours `"include"` dans toute l'app — ne PAS remettre le toggle Inclure/Exclure ni repasser en `"exclude"` par défaut
- `TopRoundButton` a 3 positions : `"left"` (loupe ?), `"left2"` (thème), `"right"` (compte) — ne pas confondre

### Ce qu'on a fait
- Audit et fix du bug "filmographie vide" (acteur sans films alors qu'il en a après refresh)
- Fix du même bug pour le casting (film avec 2 acteurs au lieu de 15)
- Augmentation MAX_TRIES pour mode Difficile (10 → 25)
- Ajout des boutons "Recharger le casting" / "Recharger la filmographie" toujours visibles sous les listes
- Ajout du compteur d'acteurs/films dans le titre des panneaux (ex: `CASTING · INCEPTION · 15`)

### Bugs corrigés

**Bug 1 — Filmographie vide (cache poisoning)**
- Cause : `getActorMoviesBatch` (l.361) lance une requête batch avec `.limit(50000)`. Si un acteur n'est pas dans les résultats (coupure par la limite), il stocke `[]` dans `filmoCache`. Or `[]` est truthy en JS, donc `getActorMovies` (l.311) voit `if (cached)` → true → retourne `[]` sans faire de requête individuelle.
- Fix : dans `getActorMoviesBatch`, ne stocker dans le cache que si `films.length > 0` (l.377).

**Bug 2 — Casting incomplet (même cause)**
- Cause : identique dans `getMovieCastsBatch` (l.349) → `setCachedCast` avec `[]` → `getMovieCast` (l.296) court-circuite la requête individuelle.
- Fix : même pattern dans `getMovieCastsBatch`, ne cacher que si `actors.length > 0` (l.351).

**Bug 3 — MAX_TRIES trop bas en mode Difficile**
- Cause : `MAX_TRIES = 10` fixe pour toutes les difficultés, mais le mode Difficile (5+ étapes) est rare à trouver en 10 essais.
- Fix : `const MAX_TRIES = forHard ? 25 : 10;` aux deux endroits où la recherche de défi est lancée (l.1324 et l.1388).

### Nouvelles features

**Boutons de rechargement forcé**
- Deux states ajoutés : `castReloadEmpty` et `filmoReloadEmpty` (bool, reset au changement de film/acteur)
- Deux fonctions : `reloadCast()` et `reloadFilmo()` — vident le cache de l'entrée courante puis relancent une requête individuelle
- UI : bouton toujours visible sous la liste ; si reload retourne encore vide → texte "Données manquantes"

**Compteur dans le titre**
- `title={`Casting · ${currentMovie.title} · ${castOfCurrent.length}`}`
- `title={`Filmographie · ${selectedActor.name} · ${filmoOfActor.length}`}`

### État actuel du code
- Version : v5.15 (committée et pushée)
- Tous les changements dans `src/App.jsx` uniquement
- Dépendance ajoutée : `fuse.js` (fuzzy search)

### Ce qui reste à faire (backlog v5.16+)
1. Nom du personnage joué dans Casting — migration DB (`character_name` dans `credits` + relance import 944k lignes) — à faire quand décidé
2. Gestion déconnexion adversaire (Supabase Presence channels)
3. `original_title` dans `works` pour recherche cross-langue (Star Wars ↔ La Guerre des étoiles) — migration DB séparée
4. Phase 6 : App iOS via Capacitor

### Pièges à éviter
- Ne PAS accepter les modifications automatiques de Claude Code sans plan validé au préalable
- Ne PAS réécrire App.jsx en entier même si demandé
- Les tableaux vides `[]` sont truthy en JS — toujours vérifier `.length > 0` avant de considérer un cache comme valide
- Ne PAS oublier de passer `opponentHintsUsed` dans toutes les VersusPlayerCard (bug v5.12)
- Le numéro de version affiché dans le menu doit être mis à jour manuellement à chaque release (l.1794)

---

## Session du 2026-06-12 — Migration vers Claude Code

### Ce qu'on a fait
- Migration complète du workflow de claude.ai vers Claude Code CLI
- Installation Claude Code v2.1.175
- Création et mise en place du CLAUDE.md enrichi (stack, schéma DB, règles strictes, méthodologie 3 modes)
- Refus de la modification automatique non validée sur prepareAndStartVersusGame (initialPath, initialHintsUsed, etc.)

### Bugs corrigés
- **Bug écran noir fin de partie Versus** : `opponentHintsUsed` utilisé dans le JSX de VersusEndScreen mais absent de la destructuration des props → crash React silencieux → écran vide couleur du thème. Fix : ajouter `opponentHintsUsed` dans la liste des props destructurées (ligne ~3061 dans App.jsx).

### État actuel du code
- Version : v5.12
- Claude Code opérationnel dans ~/Desktop/M.V/fil/fil-app
- CLAUDE.md enrichi en place et vérifié (Claude Code le lit correctement)
- App.jsx : ~4750 lignes, monofichier React + Vite

### Ce qui reste à faire (backlog v5.13)
1. Audit "acteur retiré de filmo" (comportement incohérent)
2. Casting : séparer visuellement "Casting" du toggle de tri
3. Bouton refresh in-game si filmo n'a pas chargé
4. Nom du personnage joué dans Casting (vérifier si dispo en DB)
5. Polish OptionsScreen avec VersusFiltersPanel
6. MAX_TRIES augmenté pour mode Difficile

### Pièges à éviter
- Ne PAS accepter les modifications automatiques de Claude Code sans plan validé au préalable
- Ne PAS réécrire App.jsx en entier même si demandé
- Ne PAS oublier de passer `opponentHintsUsed` dans toutes les VersusPlayerCard (bug v5.12)
- La feature "rechargement de page en plein Versus" (initialPath, etc.) est dans le backlog mais PAS encore implémentée — ne pas l'ajouter sans plan validé
