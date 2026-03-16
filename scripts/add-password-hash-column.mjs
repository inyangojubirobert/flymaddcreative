#!/usr/bin/env node
/**
 * Migration helper: ensure referral_merchants has a password_hash column.
 *
 * Usage:
 *   node scripts/add-password-hash-column.mjs
 *
 * Required env vars:
 *   - DATABASE_URL (preferred)
 *   - SUPABASE_DB_URL (fallback)
 *
 * This script is safe to run multiple times and will not overwrite existing column.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { promises as dns } from 'dns';

dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('\nERROR: No database URL found.');
  console.error('Set DATABASE_URL (or SUPABASE_DB_URL) in your environment before running this script.');
  process.exit(1);
}

// If the password contains special URL characters like "@", it must be URL-encoded.
// A common failure mode is using a password like "@13Dec8891" directly in the URL.
// In that case, the string becomes: postgres://postgres:@13Dec8891@host..., which is invalid.
if ((connectionString.match(/@/g) || []).length > 1) {
  console.error('\nERROR: Your DATABASE_URL contains multiple "@" characters.');
  console.error('If your password contains an "@", URL-encode it (e.g., "@" → "%40").');
  console.error('Example: postgres://postgres:%4013Dec8891@db.pjtuisyvpvoswmcgxsfs.supabase.co:5432/postgres');
  process.exit(1);
}

async function run() {
  // pg's built-in resolver can fail when the hostname only has AAAA (IPv6) records.
  // In that case, resolve the host ourselves and connect using the IPv6 address.
  const url = new URL(connectionString);
  const cfg = {
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ''),
    port: url.port ? Number(url.port) : 5432,
    host: url.hostname,
    ssl: url.protocol === 'postgresql:' || url.protocol === 'postgres:' ? { rejectUnauthorized: false } : false
  };

  try {
    const v4 = await dns.resolve4(cfg.host).catch(() => []);
    if (!v4.length) {
      const v6 = await dns.resolve6(cfg.host).catch(() => []);
      if (v6.length) {
        cfg.host = v6[0];
      }
    }
  } catch (e) {
    // If DNS resolution fails, we'll still try using the raw host value and let pg report the error.
  }

  const client = new pg.Client(cfg);

  try {
    await client.connect();

    console.log('Connected to database. Checking referral_merchants schema...');

    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'referral_merchants' AND column_name = 'password_hash'`);

    if (rows.length > 0) {
      console.log('✅ Column password_hash already exists on referral_merchants. No action needed.');
      return;
    }

    console.log('Adding password_hash column to referral_merchants...');
    await client.query(`ALTER TABLE public.referral_merchants ADD COLUMN IF NOT EXISTS password_hash text;`);

    console.log('✅ password_hash column added successfully.');
    console.log('\nNext step: if you have existing merchants, you should prompt them to reset their password.');

  } catch (err) {
    console.error('Error running migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
