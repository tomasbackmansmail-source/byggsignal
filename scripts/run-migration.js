require('dotenv').config();
const { Client } = require('pg');

// Alla kolumner profiles behöver (idempotent — ADD COLUMN IF NOT EXISTS)
const SQL = `
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email            text;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_used_trial   boolean NOT NULL DEFAULT false;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS selected_kommuner text[] DEFAULT '{}';
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

  -- Trigger: updated_at
  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END;
  $$;

  DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
  CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  -- Trigger: auto-skapa rad vid ny auth-användare
  CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

  -- Policies (service role + users)
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='service role full access') THEN
      CREATE POLICY "service role full access" ON profiles FOR ALL USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='users read own profile') THEN
      CREATE POLICY "users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
    END IF;
  END $$;
`;

async function run() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('Saknar SUPABASE_DB_URL i .env');
    console.error('\nKör följande SQL manuellt i Supabase SQL Editor:\n');
    console.error(SQL);
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(SQL);
  await client.end();
  console.log('Migration klar.');
}

run().catch(e => {
  console.error('FEL:', e.message);
  process.exit(1);
});
