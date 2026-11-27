// Copies the accounts and pieces of learn-estv into this app's database.
//   node dist/scripts/import-learn.js <learn.db> [--replace]
// The database is saved first (data/backups). Without --replace, refuses to
// touch a database that already has accounts or pieces.
import path from 'node:path';
import { config } from '../config.js';
import { hasData, importLearn, openLearn } from '../db/importLearn.js';
import { openDatabase } from '../db/index.js';
import { prepareDatabase } from '../db/prepare.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const [source] = args.filter((a) => !a.startsWith('--'));
if (!source) {
  console.error('Usage : import-learn <learn.db> [--replace]');
  process.exit(1);
}

try {
  const learn = openLearn(source);
  const db = openDatabase();
  try {
    if (hasData(db) && !replace) throw new Error('La base du piano a déjà des comptes ou des morceaux : relance avec --replace pour les remplacer.');
    const backup = await prepareDatabase(config.dbPath, 'avant-import', () => {});
    if (backup) console.log(`Base du piano sauvegardée avant la copie : backups/${path.basename(backup)}`);
    const n = importLearn(db, learn);
    console.log(`Copié depuis learn-estv : ${n.users} comptes, ${n.folders} dossiers, ${n.pieces} morceaux, ${n.takes} prises, ${n.days} jours de pratique.`);
  } finally {
    db.close();
    learn.close();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
