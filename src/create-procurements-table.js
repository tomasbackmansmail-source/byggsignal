/**
 * Skapar procurements-tabellen i Supabase
 * Kör en gång: node src/create-procurements-table.js
 */
require('dotenv').config();
const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS procurements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    municipality text NOT NULL,
    title text NOT NULL,
    description text,
    deadline date,
    published_date date,
    location text,
    estimated_value_sek numeric,
    category text,
    source_url text,
    source text DEFAULT 'kommersannons',
    created_at timestamptz DEFAULT now(),
    UNIQUE(municipality, title, deadline)
  )`,
  `ALTER TABLE procurements ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_all' AND tablename = 'procurements') THEN
      CREATE POLICY "service_all" ON procurements FOR ALL TO service_role USING (true);
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read' AND tablename = 'procurements') THEN
      CREATE POLICY "anon_read" ON procurements FOR SELECT TO anon, authenticated USING (true);
    END IF;
  END $$`,
];

async function execSQL(sql) {
  // Use the Supabase pg_net/query endpoint
  const resp = await axios.post(
    `${SUPABASE_URL}/rest/v1/rpc/`,
    {},
    {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  ).catch(() => null);

  // If RPC doesn't work, try the pg module with DB password
  const { Client } = require('pg');
  const ref = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

  // Try with DB password from env, or prompt user
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    console.log('Ingen SUPABASE_DB_PASSWORD hittad i .env');
    console.log('Alternativ 1: Lägg till SUPABASE_DB_PASSWORD=<ditt lösenord> i .env');
    console.log('Alternativ 2: Kör SQL:et manuellt i Supabase Dashboard > SQL Editor:\n');
    console.log(STATEMENTS.join(';\n\n') + ';');
    return;
  }

  const client = new Client({
    connectionString: `postgresql://postgres.${ref}:${dbPassword}@aws-0-eu-north-1.pooler.supabase.com:6543/postgres`,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    for (const stmt of STATEMENTS) {
      await client.query(stmt);
    }
    console.log('✅ Tabell "procurements" skapad med RLS-policies');
    await client.end();
  } catch (err) {
    console.error('❌ Fel:', err.message);
    await client.end().catch(() => {});
  }
}

execSQL();
