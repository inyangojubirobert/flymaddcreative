// Runs a SQL file against a local PostgreSQL (PGlite) that imitates the
// production catalogue state, as the non-superuser owner role.
//   cd scripts/local-listing-engine-check && npm install --no-save @electric-sql/pglite
//   node run-local-dry-run.mjs ../../supabase/dry_run_dynamic_listing_engine.sql
// Optional second argument: extra SQL file run (as owner) BEFORE the target,
// e.g. to create a bad-data scenario. It is a local emulation, not Supabase:
// the real dry run in the Supabase SQL editor is still required.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || join(here, '..', '..', 'supabase', 'dry_run_dynamic_listing_engine.sql'));
const setup = process.argv[3] ? resolve(process.argv[3]) : null;

const db = new PGlite();
await db.exec(readFileSync(join(here, 'base-schema.sql'), 'utf8'));
const v = await db.query('select version() as v');
console.log(v.rows[0].v.split(',')[0]);

if (setup) {
  await db.exec('set role app_owner');
  await db.exec(readFileSync(setup, 'utf8'));
  await db.exec('reset role');
}

await db.exec('set role app_owner');
try {
  await db.exec(readFileSync(target, 'utf8'));
  console.log('COMPLETED WITHOUT ERROR (a dry run should always end in its deliberate error)');
} catch (err) {
  console.log(String(err.message));
}
await db.close();
process.exit(0);
