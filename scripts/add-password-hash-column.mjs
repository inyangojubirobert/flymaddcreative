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

dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('\nERROR: No database URL found.');
  console.error('Set DATABASE_URL (or SUPABASE_DB_URL) in your environment before running this script.');
  process.exit(1);
}

async function run() {
  const client = new pg.Client({ connectionString });

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
