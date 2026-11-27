# piano-estv

Le piano, seul : on se connecte et on arrive sur le clavier. Jeu libre (clavier à l'écran, clavier d'ordinateur, MIDI, micro) et ses morceaux en notes qui tombent, en chiffres, en boucle, avec paroles. Spécification : [`docs/PROJECT.md`](docs/PROJECT.md).

Sorti de learn-estv : comptes et morceaux s'y copient avec un script, voir [`docs/MIGRATION.md`](docs/MIGRATION.md).

Pas d'invités : sans session, la page de connexion. Les comptes sont créés par l'admin.

## Stack

- npm workspaces : `shared/` (notes, morceaux, partitions en chiffres, schémas Zod utilisés par le front et le back), `backend/`, `frontend/`
- Backend : Node, Express 5, better-sqlite3, bundlé avec esbuild
- Frontend : React 19, Vite, Tailwind v4, Tone.js (piano Salamander), pitchy (micro), Web MIDI. Le piano est dans `frontend/src/piano/`.

## Mise en route sur le VPS

```bash
cd ~/projects && git clone git@github.com:estvv/piano-estv.git && cd piano-estv
cp .env.example .env          # reprendre les clés IA du .env de learn-estv
docker compose up -d --build
```

Puis ajouter le bloc de `Caddyfile.snippet` dans le Caddyfile, recharger Caddy, et ajouter l'app dans `home-estv`. Comptes : copiés depuis learn-estv (`deploy/import-from-learn.sh`), ou un admin neuf avec `docker compose exec backend npm run create-admin -- <identifiant>`.

## Déploiement automatique

Chaque push sur `main` est testé, puis mis en ligne sur le VPS avec la base de données (sauvegarde, répétition sur une copie, retour automatique en cas d'échec). Mise en place : `deploy/setup.sh`, tutoriel dans [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Dev local

Sur l'hôte (Node ≥ 22) :

```bash
npm install
npm run dev -w backend    # API sur :3015, base dans data/piano.db
npm run dev -w frontend   # http://localhost:5173
npm run create-admin -w backend -- estv
```

Ou avec Docker : `cp docker-compose.override.example.yml docker-compose.override.yml && docker compose up` → http://127.0.0.1:8096.

Tests et typage : `npm test` et `npm run typecheck`.

## Partition → MIDI

`tools/sheet2midi.py` lit une partition (PDF, photo/scan, ou MusicXML) et produit un `.mid` à importer dans **Morceaux**, plus le `.musicxml` reconnu (importable aussi, garde mieux les deux mains). Il faut [uv](https://docs.astral.sh/uv/) ; les dépendances s'installent toutes seules.

```sh
uv run tools/sheet2midi.py partition.pdf               # -> partition.mid + partition.musicxml
uv run tools/sheet2midi.py p1.jpg p2.jpg -o morceau.mid --bpm 90
```

Moteur : [Audiveris](https://github.com/Audiveris/audiveris/releases) s'il est installé (le plus fiable), sinon oemer (premier lancement : ~150 Mo de modèles).

## Crédits

Samples de piano : [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) par Alexander Holm, licence CC-BY 3.0 (version allégée de Tone.js).
