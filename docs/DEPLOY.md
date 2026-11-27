# CI/CD : déployer automatiquement

Chaque push sur `main` :

1. **GitHub** installe, vérifie les types, lance les tests et le build. Un échec s'arrête là.
2. **Le VPS** construit les images, pendant que le site actuel continue de tourner.
3. **La base** est sauvegardée (`data/backups/`, les 10 dernières), puis sa mise à jour est **répétée sur une copie** : tables et colonnes. Si quelque chose coince, rien n'est touché.
4. **Bascule** : le nouveau backend démarre et met à jour la vraie base (`backend/src/db/`). Comptes, morceaux et pratique sont gardés.
5. **Contrôle** : le site doit répondre avec le bon commit. Sinon, retour automatique à la version précédente.

Les pull requests ne font que l'étape 1.

## Mise en place (une fois)

### 1. Pousser la CI/CD sur GitHub

```bash
git add -A && git commit -m "feat: ci/cd" && git push
```

Les tests se lancent, mais rien ne se déploie encore. Si le push est refusé avec « workflow scope » : `gh auth refresh -s workflow`.

### 2. Lancer l'assistant

```bash
deploy/setup.sh
```

Il te faut : `gh` connecté (`gh auth login`), et ton accès SSH habituel au VPS. Il crée la clé, l'installe, enregistre les secrets et lance le premier déploiement. C'est tout. La suite ne sert que pour le faire à la main.

## À la main

Remplace `UTILISATEUR`, `IP` et `DOSSIER`. `UTILISATEUR` est celui qui lance `docker compose` sur le VPS. Pour trouver `DOSSIER`, sur le VPS :

```bash
docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' piano-backend-estv
```

**1. Mettre à jour les fichiers du VPS** (sans relancer les conteneurs) :

```bash
ssh UTILISATEUR@IP 'git -C DOSSIER pull --ff-only'
```

**2. Créer la clé**, sur ton ordinateur :

```bash
ssh-keygen -t ed25519 -N '' -C piano-estv-deploy -f /tmp/piano-deploy
```

**3. L'autoriser sur le VPS**, seulement pour déployer. Ajoute cette ligne (en un seul morceau) à `~/.ssh/authorized_keys` de `UTILISATEUR` :

```
command="DOSSIER/deploy/deploy.sh",restrict <contenu de /tmp/piano-deploy.pub>
```

Essai : `ssh -i /tmp/piano-deploy -o IdentitiesOnly=yes UTILISATEUR@IP id` doit répondre « Commande refusée ».

**4. Les secrets et variables** : GitHub → dépôt → Settings → Secrets and variables → Actions.

| Onglet | Nom | Valeur |
|---|---|---|
| Secrets | `VPS_IP` | adresse du VPS |
| Secrets | `VPS_SSH_KEY` | contenu de `/tmp/piano-deploy` (la clé **privée**, en entier) |
| Secrets | `VPS_KNOWN_HOSTS` | résultat de `ssh-keygen -F IP \| grep -v '^#'` |
| Variables | `VPS_USER` | `UTILISATEUR` |
| Variables | `VPS_PORT` | port SSH, si ce n'est pas 22 |
| Variables | `SITE_URL` | `https://piano.estv.fr` (contrôle final, facultatif) |
| Variables | `DEPLOY_ENABLED` | `true` : l'interrupteur, à mettre en dernier |

Ou avec `gh` :

```bash
gh secret set VPS_IP --body IP
gh secret set VPS_SSH_KEY < /tmp/piano-deploy
ssh-keygen -F IP | grep -v '^#' | gh secret set VPS_KNOWN_HOSTS
gh variable set VPS_USER --body UTILISATEUR
gh variable set SITE_URL --body https://piano.estv.fr
gh variable set DEPLOY_ENABLED --body true
rm /tmp/piano-deploy /tmp/piano-deploy.pub
```

**5. Déployer** : `gh workflow run deploy.yml`, puis `gh run watch`.

`MISTRAL_API_KEY` et `COOKIE_SECURE` restent dans le `.env` du VPS : la CI n'en a pas besoin.

## Au quotidien

| | |
|---|---|
| Déployer | `git push` |
| Redéployer sans changement | `gh workflow run deploy.yml` |
| Suivre | `gh run watch` |
| Revenir en arrière | `git revert <commit> && git push` |
| Suspendre les déploiements | `gh variable set DEPLOY_ENABLED --body false` |
| Savoir ce qui est en ligne | `curl https://piano.estv.fr/health` |
| Déployer depuis le VPS | `deploy/deploy.sh` |
| Lister les sauvegardes (VPS) | `deploy/restore.sh` |
| Restaurer (VPS) | `deploy/restore.sh piano-….db` |

Le retour automatique remet l'ancien **code**, pas l'ancienne base : les mises à jour ne font qu'ajouter des tables et des colonnes, que l'ancien code ignore. Rien de ce qui a été fait entre-temps n'est donc perdu.

Les sauvegardes restent sur le VPS : elles protègent d'une mauvaise mise à jour, pas de la perte du serveur.

## Changer la base

- **Nouvelle table** : `CREATE TABLE IF NOT EXISTS` dans `backend/src/db/schema.ts`.
- **Nouvelle colonne** : dans `schema.ts` **et** dans `addedColumns` (`backend/src/db/index.ts`).

Ne supprime et ne renomme ni table, ni colonne : le retour en arrière ne marcherait plus.

## En cas de problème

| Message | Cause |
|---|---|
| `SSH_KEY manque` (ou autre) | secret ou variable absent |
| `Host key verification failed` | `VPS_KNOWN_HOSTS` faux, ou serveur réinstallé : relance `deploy/setup.sh` |
| `Permission denied (publickey)` | ligne absente de `authorized_keys`, ou mauvais `VPS_USER` |
| `Connection timed out` | pare-feu, ou mauvais port |
| `Des fichiers suivis ont été modifiés sur le VPS` | `git status` sur le VPS ; rien n'est écrasé |
| `Le VPS a des commits absents de GitHub` | quelqu'un a commité sur le VPS |
| `La nouvelle version ne répond pas` | `docker logs piano-backend-estv` ; l'ancienne version est revenue |

Pour retirer l'accès : enlève la ligne `piano-estv-deploy` de `authorized_keys`.
