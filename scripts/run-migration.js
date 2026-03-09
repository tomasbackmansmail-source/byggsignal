require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SQL = `
  CREATE TABLE IF NOT EXISTS profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free','bas','pro','enterprise')),
    trial_expires_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='read own'
    ) THEN
      CREATE POLICY "read own" ON profiles FOR SELECT USING (auth.uid() = id);
    END IF;
  END $$;
`;

async function runViaPg() {
  // Bygg connection string från Supabase URL
  // Format: postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
  const url = process.env.SUPABASE_URL;
  const ref = url.replace('https://', '').replace('.supabase.co', '');
  const dbUrl = process.env.SUPABASE_DB_URL ||
    `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${ref}.supabase.co:5432/postgres`;

  if (!process.env.SUPABASE_DB_URL && !process.env.SUPABASE_DB_PASSWORD) {
    console.error('Saknar SUPABASE_DB_URL eller SUPABASE_DB_PASSWORD i .env');
    console.error('Lägg till en av dem och kör igen, eller kör SQL manuellt i Supabase SQL Editor.');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(SQL);
  await client.end();
  console.log('Klar — profiles-tabellen skapad.');
}

runViaPg().catch(e => {
  console.error('FEL:', e.message);
  process.exit(1);
});
