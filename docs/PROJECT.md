# Cahier des charges — piano-estv

Le piano, seul : on se connecte et on arrive sur le clavier. Jeu libre (clavier à l'écran, clavier d'ordinateur, MIDI, micro), et ses morceaux à jouer en notes qui tombent, en chiffres, en boucle, avec paroles.

Né dans learn-estv (le sujet « Piano »), sorti dans sa propre app en novembre 2026 : learn-estv garde les autres sujets, et renvoie ses anciennes adresses de piano ici.

Projet perso : un admin (moi), quelques comptes créés à la main. Pas d'invités, pas d'inscription publique. Quand une option est « propre mais lourde », on choisit la simple.

## 1. Utilisateurs

| Rôle | Peut faire |
|---|---|
| **Compte** (créé par l'admin) | Jouer, ses morceaux (privés : personne d'autre ne les voit), sa pratique, l'IA. |
| **Admin** | Idem + gestion des comptes (menu en haut à gauche › Comptes). |

- Sans session : la page de connexion, et rien d'autre.
- Auth : identifiant + mot de passe (scrypt), session en cookie httpOnly `piano_session`.

## 2. Pages

- `/` : le piano, plein écran. En haut à gauche, le menu du compte (Réglages, Mon compte, Comptes pour l'admin, Déconnexion) ; en haut à droite, **Morceaux**.
- `/connexion`, `/reglages` (apparence, entrées, son, notes qui tombent ; enregistrés sur l'appareil), `/compte`, `/admin`.

## 3. Morceaux

- **Affichage** : partition (portée + curseur) ou notes qui tombent vers le clavier, au choix.
- **Chiffres** : au-dessus des notes qui tombent, le morceau écrit en nombres, une suite par main, sur une grille de temps. Dans chaque partie (A, B…), la première touche jouée vaut 1, la nouvelle suivante 2…, et une touche garde son numéro ; les parties de même lettre partagent leurs numéros. Rien de tout cela n'est stocké : pistes actives, mains (réparties selon ce qui est jouable quand le fichier ne les donne pas de façon crédible, `hands.ts`), niveau et changements faits à la main donnent les notes, qui donnent les numéros (`derive.ts`). Un changement fait à un niveau simplifié reste propre à ce niveau. À ces niveaux, les mains sont revues (`settle.ts` : le même modèle à tous les niveaux, ce que deux mains peuvent faire ; la main du fichier n’est qu’un point de départ) et les numéros leur sont propres. Les parties sont trouvées automatiquement et se corrigent à la main ; les temps sont suivis un par un quand le jeu ne respecte pas le tempo du fichier.
- **Couleurs** : une par main, au choix et propres à chaque thème (clair, nuit, ou celui de l’appareil), gardées sur l’appareil (`lib/appearance.ts`). Le thème nuit retourne les palettes de Tailwind (`dark.css`) ; le clavier, lui, ne change pas, et une fausse note y est hachurée plutôt que colorée.
- **Styles des notes** (`stage/`) : classique, ou dans le noir lueur, verre, contour, traînée, avec une couleur d’ambiance (celles des mains, unies ou arc-en-ciel) qui s’éclaircit en approchant du clavier. La ligne de LED et les nuées de particules sont les mêmes pour tous : portées par un même vent qui tourne sans rassembler (`particles.ts`), moins nombreuses sur une machine lente.
- **Voix** (`voice/`) : un fichier son joué avec le morceau, gardé dans le navigateur (IndexedDB), jamais envoyé. Deux repères le calent (décalage et vitesse) ; il est décodé puis joué sur la même horloge que le piano, et n’est relancé que si le morceau saute ou si les horloges s’écartent. Aux autres vitesses il est étiré sans changer de hauteur (`stretch.ts`, dans un worker). Muet en mode attente.
- **Vidéo** (`pieces/video/`) : le morceau filmé pendant qu’il joue (canvas + son du piano, `MediaRecorder`), en 16:9 ou 9:16, avec le même dessin des notes qu’à l’écran, les paroles, le titre et un logo au choix.
- **Progrès** : en mode attente, chaque prise jouée du début à la fin est notée (justesse du premier coup, temps pour trouver) et gardée sur le compte (`takes.ts`, table `piece_takes`). Tempo progressif sur une boucle, série et temps joué par jour (`practice.ts`, table `piece_time`), coach IA sur demande (`coach.ts`).
- **Export MIDI** : le morceau tel qu’il est joué, une piste par main.
- **Façon de numéroter** (par morceau) : dans l’ordre d’apparition, par position dans chaque main (la plus grave = 1), ou fixe sur les 88 touches ; « sans parties » compte tout le morceau d’un bloc. Hors du mode habituel, les numéros choisis à la main sont mis de côté.
- **Plein écran** (F) : seulement les paroles, les notes et le clavier.
- **Modes** : *attente* (le morceau s'arrête jusqu'à la bonne note), *tempo réel + score* (justesse + timing, tempo réglable), *boucle* sur une sélection de mesures avec tempo progressif.
- **Prises** : les notes jouées sont toujours enregistrées (pas l'audio). On peut rejouer une prise et la superposer à l'original (notes en avance/retard/fausses). Le score et les conseils du coach s'appuient dessus.
- **Import** : un seul endroit, le fichier dit comment il est lu. MIDI, MusicXML ; partition PDF (symboles SMuFL lus un par un, `score-pdf/`, rien n'est envoyé) ; vidéo de notes qui tombent (clavier trouvé dans l'image, touches qui s'allument, `videoKeys.ts`), sinon son transcrit ; image ou scan lus par une IA, Gemini puis Mistral (`backend/src/ai/`) : numéros (éditeur en chiffres) ou partition (à vérifier).
- **Morceaux** : import MIDI (`@tonejs/midi`), import MusicXML (rendu OpenSheetMusicDisplay, mains et doigtés conservés), ou écrits à la main en chiffres : d'abord le numéro de chaque touche, puis les touches posées au-dessus du clavier ou enregistrées en jouant, par parties, et leur ordre (`shared/src/score.ts`). Les numéros de ces morceaux sont ceux de leur auteur. Un morceau importé se modifie dans le même éditeur (`importedScore.ts` : ses notes gardent leur place exacte, seules celles touchées changent), ou case par case. Vidéo et son : les notes sont calées sur les cases à l’import, ou plus tard dans l’éditeur (`snap.ts`). Un nouveau morceau peut être fait de quelques parties d’un autre, qui ne change pas (`extract.ts`).
- **Karaoké** : les paroles, ligne par ligne, au-dessus des notes. Cherchées sur LRCLIB (titre et artiste envoyés par le serveur, sur demande), collées ou lues dans un `.lrc`, puis calées sur le morceau : une ligne placée déplace les autres, plusieurs donnent le tempo (`lyrics.ts`). Les mots se remplissent selon leurs syllabes et le débit de la chanson : c’est une estimation.

## 4. Entrées

Bus d'événements commun : `noteOn(midi, velocity, t)` / `noteOff(midi, t)`. Clavier à l'écran (polyphonique), clavier d'ordinateur, MIDI (Web MIDI, Chrome/Edge), micro (monophonique, `pitchy`).

## 5. Architecture technique

- npm workspaces : `shared/` (notes, morceaux, partitions écrites en chiffres, lecture IA ; schémas Zod partagés), `backend/`, `frontend/`.
- **Backend** : Node, Express 5, better-sqlite3, bundlé avec esbuild.
- **Frontend** : React 19, Vite, Tailwind v4, servi par nginx qui proxifie `/api` et `/health` vers `piano-backend-estv:8080`. Le code du piano est dans `frontend/src/piano/`.
- **Audio** : Tone.js ; piano échantillonné (Salamander Grand Piano), samples servis par le frontend.
- **Déploiement** : Docker Compose sur `caddy_net`, GitHub Action → SSH → `deploy/deploy.sh` (voir [`DEPLOY.md`](DEPLOY.md)), entrée dans `home-estv`.
- **Ports dev** : backend 3015, override compose 8096.

### 5.1 Base de données

```
users(id, username, display_name, password_hash, is_admin, disabled, avatar…, created_at)
sessions(token_hash, user_id, expires_at)
piece_folders(id, user_id, name, parent_id, position, created_at)
pieces(id, user_id, title, artist, description, folder_id, difficulty, cover, tracks, level, sections,
       numbers, numbering, whole, sequence, lyrics, edits, score, source, bpm, data, note_count, duration, created_at)
piece_takes(id, user_id, piece_id, level, part, score, chords, wrong, rate, at)
piece_time(user_id, piece_id, day, seconds)
```

## 6. Direction visuelle

DA des apps estv : fond blanc, Plus Jakarta Sans, gris neutres, boutons primaires noirs, champs `rounded-lg` bordés. Couleurs uniquement là où elles portent du sens : juste/faux, main droite/main gauche. Pensé PC d'abord (grand écran, clavier, MIDI), utilisable sur tablette et téléphone.
