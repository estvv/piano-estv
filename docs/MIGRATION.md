# Sortir le piano de learn-estv

Le piano vivait dans learn-estv (`learn.estv.fr/s/piano/pratique`). Il passe sur `piano.estv.fr`, avec les comptes et les morceaux déjà créés.

## Ce qui est copié

`deploy/import-from-learn.sh` (sur le VPS) → `backend/src/db/importLearn.ts` :

| Copié | Détail |
|---|---|
| Comptes | identifiant, nom affiché, photo, **mot de passe** (même hash), admin, désactivé |
| Dossiers | ceux du piano, avec leurs sous-dossiers et leur ordre |
| Morceaux | tout : notes, partitions en chiffres, parties, numéros, paroles, niveaux, pochettes… **avec les mêmes ids** : `?morceau=12` mène au même morceau |
| Prises et pratique | étoiles du mode attente, temps joué par jour |

Pas copié :

- **Les sessions** : les cookies appartiennent à `learn.estv.fr`, chacun se reconnecte une fois.
- **Ce qui est gardé dans le navigateur**, propre à chaque adresse : réglages (couleurs des mains, style des notes, volume, MIDI, micro), couleurs par morceau, vidéo, tempo progressif, et **les fichiers de voix** (IndexedDB). À refaire sur `piano.estv.fr` ; ils restent disponibles sur `learn.estv.fr` tant qu'on ne vide pas le navigateur.

learn-estv n'est jamais modifié : sa base est lue par son propre conteneur (copie cohérente même pendant qu'il tourne), et ses tables de morceaux restent en place. La copie peut donc être refaite autant de fois que nécessaire.

## Étapes

1. **Mettre piano-estv en ligne** (voir le README) : clone, `.env` (reprendre `GEMINI_API_KEY`, `MISTRAL_API_KEY`… de learn-estv), `docker compose up -d --build`, bloc Caddy, DNS `piano.estv.fr`.

2. **Première copie**, pour vérifier :

   ```bash
   cd ~/projects/piano-estv && deploy/import-from-learn.sh
   ```

   Se connecter sur `piano.estv.fr` avec ses identifiants habituels et ouvrir quelques morceaux.

3. **Bascule de learn-estv** : pousser la version de learn-estv sans le piano. Ses anciennes adresses (`/s/piano/…`) renvoient alors vers `piano.estv.fr`, en gardant `?morceau=…`.

4. **Copie finale**, pour reprendre ce qui a été fait sur learn entre l'étape 2 et l'étape 3 :

   ```bash
   deploy/import-from-learn.sh --replace
   ```

   ⚠ `--replace` remplace les comptes et morceaux de piano-estv : à faire avant que quelqu'un ne crée quelque chose sur `piano.estv.fr`. La base d'avant est sauvegardée dans `data/backups/piano-…-avant-import.db` (`deploy/restore.sh` pour la remettre).

5. Ajouter Piano dans `home-estv/config.json`.

## Après

Les comptes vivent séparément dans chaque app : un compte créé ou un mot de passe changé sur l'une ne change rien sur l'autre.
