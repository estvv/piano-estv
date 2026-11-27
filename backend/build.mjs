// Bundles the backend with the TypeScript sources of @piano/shared; every
// other dependency stays external and is loaded from node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@piano/shared');
const sharedPkg = JSON.parse(readFileSync(new URL('../shared/package.json', import.meta.url), 'utf8'));
external.push(...Object.keys(sharedPkg.dependencies ?? {}));

await build({
  entryPoints: ['src/index.ts', 'src/scripts/create-admin.ts', 'src/scripts/prepare-db.ts', 'src/scripts/import-learn.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});
