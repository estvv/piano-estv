// Saves the database and rehearses the update on a copy (see db/prepare.ts).
//   node dist/scripts/prepare-db.js <label>
import { config } from '../config.js';
import { prepareDatabase } from '../db/prepare.js';

const label = (process.argv[2] ?? 'manuel').replace(/[^\w-]/g, '');
try {
  await prepareDatabase(config.dbPath, label);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
