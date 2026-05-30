# 🧵 Fil — Roadmap

> Relie les films par leurs acteurs en commun. Six Degrees of Kevin Bacon, version moderne.

Document vivant. Coche les cases au fur et à mesure, ajoute des notes en cours de route.

---

## ✅ État actuel (v2.1 — Mai 2026)

- [x] Concept et identité (nom, logo, design system liquid glass)
- [x] Base Supabase : 10 000 films + 50 000 acteurs + 112 000 crédits
- [x] Enrichissement : langue d'origine + genres (filtres possibles)
- [x] Frontend React + Vite déployé sur Vercel
- [x] Mode "Jouer" aléatoire avec calcul du chemin optimal (BFS bidirectionnel)
- [x] Mode "Sur Mesure" (choisir le film de départ et d'arrivée)
- [x] Sélecteur de difficulté (Aléatoire / Facile / Moyen / Dur)
- [x] Filtres avancés (langues + genres exclus)
- [x] Boutons Réessayer / Nouvelle partie / Abandonner
- [x] Écran de fin avec chemin optimal et verdict (vert si optimal)
- [x] App déployée sur https://fil-app.vercel.app
- [x] Repo GitHub public : userx-v12/fil-app

---

## 📦 Phase 3 — Contenu (priorité actuelle)

**Objectif** : enrichir massivement le catalogue pour que les parties soient toujours intéressantes.

### 3.1 — Séries TV (la grosse pièce)

- [ ] Refonte du schéma Supabase : table `movies` → `works` avec colonne `type` ("movie" / "tv")
- [ ] Migration de la table `credits` (movie_id reste valide pour les anciennes lignes)
- [ ] Mise à jour du script Python pour importer aussi `/tv/popular` (10 000 séries)
- [ ] Adaptation du frontend pour distinguer films/séries (petit badge visuel ?)
- [ ] Test en profondeur (parties mixtes, filmographies, BFS)

**Estimation** : 2-3 séances · **Bloque** : tout le reste

### 3.2 — Plus de films

- [ ] Passer de 10 000 à 20 000 films (top 1000 pages × 20 = 20 000)
- [ ] Re-run du script Python (~2-3h en arrière-plan)
- [ ] Vérification de la qualité (les films obscurs sont-ils trop bizarres ?)

**Estimation** : 1 séance + import auto · **Optionnel mais utile**

### 3.3 — Records personnels

- [ ] Nouvelle table Supabase `player_records` (paire de films → meilleur temps, meilleurs clics)
- [ ] Affichage du record précédent à l'écran de fin si la paire a déjà été jouée
- [ ] Mention "Nouveau record !" si battu
- [ ] Stockage par appareil (localStorage) en attendant les comptes utilisateur

**Estimation** : 1 séance · **Prépare** la Phase 5 (comptes)

---

## ⚡ Phase 4 — Performance

**Objectif** : que le jeu soit instantané et fluide, même avec 30 000 œuvres.

- [ ] Cache des castings côté client (éviter de reload le casting de Brad Pitt 10x dans une partie)
- [ ] Pré-calcul du chemin optimal pour les paires les plus populaires (cache Supabase)
- [ ] Affichage du défi dès que possible (ne pas attendre le BFS)
- [ ] Calcul du BFS en arrière-plan pendant que le joueur joue
- [ ] Optimisation des requêtes Supabase (limit, index, pagination)
- [ ] Lazy loading des images (TMDb posters)

**Estimation** : 2 séances · **Améliore** considérablement l'expérience

---

## 👥 Phase 5 — Multijoueur

**Objectif** : pouvoir jouer entre amis. La feature la plus excitante.

### 5.1 — Système de comptes (prérequis)

- [ ] Login Supabase (email magic link ou Apple/Google)
- [ ] Profil minimal : pseudo, avatar (initial coloré ou photo)
- [ ] Migration des records locaux → comptes
- [ ] Page "Compte" remplie (stats, historique)

**Estimation** : 2 séances

### 5.2 — Multijoueur asynchrone

- [ ] "Défier un ami" → génère un lien partageable avec une paire de films pré-calculée
- [ ] L'ami ouvre le lien, joue, son score est enregistré
- [ ] Écran de comparaison (toi vs lui)
- [ ] Notification quand un ami a joué un défi que tu lui as envoyé

**Estimation** : 2-3 séances

### 5.3 — Multijoueur temps réel

- [ ] Salons de jeu avec code à partager (genre `FIL-A4B7`)
- [ ] Supabase Realtime pour synchroniser les actions
- [ ] Voir l'avancée de l'autre en live (sans spoiler son chemin)
- [ ] Verdict simultané à la fin
- [ ] Mode tournoi à 3-4 joueurs ?

**Estimation** : 3-4 séances

---

## 📱 Phase 6 — App native iPhone

**Objectif** : Fil disponible sur l'App Store, vraie installation, icône sur l'écran d'accueil.

- [ ] Setup Capacitor (envelopper l'app web)
- [ ] Adaptations iOS (safe areas, comportements natifs)
- [ ] Icône d'app et splash screen
- [ ] Compte développeur Apple (99$/an)
- [ ] Captures d'écran et description App Store
- [ ] Validation Apple (1-3 semaines d'attente)
- [ ] Bonus : notifications push (défi du jour)
- [ ] Bonus : partage natif iOS
- [ ] Bonus : Haptic feedback (vibrations légères au touch)

**Estimation** : 3-4 séances + 1-3 semaines d'attente Apple · **Investissement** : 99$/an

---

## 🏆 Phase 7 — Fonctionnalités solo avancées

**Objectif** : la rétention sur le long terme.

- [ ] **Défi quotidien** : même paire pour tout le monde chaque jour, classement journalier
- [ ] **Succès / achievements** : 20-30 défis à débloquer ("10 parties optimales", "Une étape", "Le Bacon Number"...)
- [ ] **Historique** : voir toutes ses parties passées avec stats
- [ ] **Statistiques perso** : streak, % d'optimal, films/acteurs préférés, temps moyen
- [ ] **Mode entraînement** : choisir un acteur cible, explorer sa filmo librement
- [ ] **Heatmap des films joués** : visualiser quels films tu as utilisés le plus

**Estimation** : 3-4 séances réparties

---

## 🎨 Phase 8 — Identité et polish final

**Objectif** : le détail qui fait la différence avant un lancement plus large.

- [ ] Logo retravaillé (variations, animations subtiles)
- [ ] Onboarding pour les nouveaux joueurs (3 écrans de tutoriel)
- [ ] Animations plus poussées (transitions, micro-interactions, easter eggs)
- [ ] Mode sombre / clair automatique
- [ ] Page "À propos" et crédits TMDb
- [ ] Page de partage (Open Graph pour les liens partagés)
- [ ] Sons légers et optionnels (clic, validation, victoire)
- [ ] Accessibilité : navigation clavier, contrastes, lecteurs d'écran

**Estimation** : 2-3 séances réparties

---

## 💡 Idées en vrac (pour plus tard)

À noter ici toute idée qui te traverse l'esprit. On triera plus tard.

- [ ] Mode "exploration" sans objectif, juste pour parcourir l'arbre des films
- [ ] Mode "histoire" : redécouvre les classiques via un chemin imposé
- [ ] Co-création de défis communautaires
- [ ] API publique pour que d'autres puissent faire des trucs avec
- [ ] Version anglaise (`fil-app.vercel.app/en`)
- [ ] Stats globales : "Le film le plus joué cette semaine"
- [ ] Achievements rares basés sur des films cultes
- [ ] Mode "anti-Bacon" : éviter Kevin Bacon dans son parcours 😄

---

## 💰 Question du financement (un jour)

Tu as exclu pub et abonnement, ce qui est cohérent. Pistes possibles si l'app décolle :

- Donations ponctuelles (Buy Me a Coffee, Ko-fi)
- GitHub Sponsors (open source friendly)
- Vente d'une version "soirée d'entreprise" en B2B
- Merchandising
- Conférences/écriture autour du projet
- Sponsoring par TMDb ou un acteur du milieu cinéma (si visibilité)

**Pas de décision pressante.** L'important c'est que l'app reste pure.

---

## 📝 Notes de session

À remplir au fil du temps quand tu fais des choses notables.

### Mai 2026

- 22-23 mai : setup initial, base Supabase, frontend Vite, déploiement Vercel
- 26 mai : Vague 2 (difficulté + filtres), enrichissement TMDb langue/genres
- 26 mai : déploiement public, premiers tests utilisateurs validés ✅
