import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let database;
export async function closeSubscriptionTestStore() {
  if (database) await database.close();
}
export async function subscriptionTestStore(participantIds) {
  if (!database) {
    database = new PGlite();
    await database.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table participants (id uuid primary key);
    `);
    for (const name of ['create_ai_business_assistant.sql', 'add_ai_provider_subscriptions.sql']) {
      const sql = await fs.readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
      // PGlite's PostgreSQL already has gen_random_uuid; it does not ship the
      // otherwise unused pgcrypto extension requested by the original schema.
      await database.exec(sql.replace('create extension if not exists pgcrypto;', ''));
    }
  }
  await database.exec('truncate participants cascade');
  for (const id of participantIds) await database.query('insert into participants values ($1)', [id]);
  return {
    sql: database,
    from(table) {
      if (!['ai_provider_subscriptions', 'participants'].includes(table)) throw new Error('Unexpected test table');
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async maybeSingle() {
          const where = filters.map(([key], i) => `${key} = $${i + 1}`).join(' and ');
          const { rows } = await database.query(`select * from ${table} where ${where}`, filters.map(([, value]) => value));
          return { data: rows[0] || null, error: null };
        },
      };
      return query;
    },
    async rpc(name, input) {
      try {
        const { rows } = name === 'sync_ai_provider_subscription'
          ? await database.query('select sync_ai_provider_subscription($1::jsonb) as data', [JSON.stringify(input.p_input)])
          : await database.query('select get_ai_subscription_entitlement($1::uuid) as data', [input.p_participant_id]);
        return { data: rows[0].data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}
