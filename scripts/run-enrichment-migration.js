/**
 * Skapar enrichment-tabeller via Supabase Management API.
 * Koers: node scripts/run-enrichment-migration.js
 *
 * Om SUPABASE_DB_URL finns: koer via pg direkt.
 * Annars: koer via Management API (kraver SUPABASE_ACCESS_TOKEN).
 * Sista utvaeg: skriver ut SQL:en att koeera manuellt.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '002-enrichment-tables.sql'),
  'utf8'
);

async function viaPostgres() {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(SQL);
  await client.end();
  console.log('Migration klar via pg.');
}

async function viaManagementApi() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_URL.match(/https:\/\/(\w+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('Saknar SUPABASE_ACCESS_TOKEN');

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Management API ${res.status}: ${text}`);
  }

  console.log('Migration klar via Management API.');
}

async function main() {
  if (process.env.SUPABASE_DB_URL) {
    await viaPostgres();
  } else if (process.env.SUPABASE_ACCESS_TOKEN) {
    await viaManagementApi();
  } else {
    console.log('Saknar SUPABASE_DB_URL och SUPABASE_ACCESS_TOKEN.');
    console.log('Koer foeljande SQL manuellt i Supabase SQL Editor:\n');
    console.log(SQL);
    console.log('\nSupabase SQL Editor: https://supabase.com/dashboard/project/abnlmxkgdkyyvbagewgf/sql');
  }
}

main().catch(e => {
  console.error('FEL:', e.message);
  process.exit(1);
});
