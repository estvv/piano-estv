import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root in dev, found from this file (src/, src/scripts/ or dist/). In
// Docker, DB_PATH is set explicitly.
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'shared')) && fs.existsSync(path.join(dir, 'backend'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const repoRoot = findRepoRoot();

export const config = {
  // Deployed commit, shown by /health so a deploy can check itself.
  commit: process.env.APP_COMMIT || 'dev',
  port: Number(process.env.PORT ?? 3015),
  dbPath: process.env.DB_PATH ?? path.join(repoRoot, 'data/piano.db'),
  cookieSecure: process.env.COOKIE_SECURE !== '0' && process.env.NODE_ENV === 'production',
  mistralApiKey: process.env.MISTRAL_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  // Empty: the best one whose free quota is not used up.
  geminiModel: process.env.GEMINI_MODEL ?? '',
  // Reads images; empty: the best one the subscription allows.
  mistralVisionModel: process.env.MISTRAL_VISION_MODEL ?? '',
};
