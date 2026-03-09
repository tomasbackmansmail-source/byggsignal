-- migrations/add-enterprise-plan.sql
-- Uppdaterar profiles-tabellen med enterprise-plan och säkerställer RLS
-- Kör i Supabase SQL Editor

-- Säkert att köra flera gånger (idempotent)

-- 1. Lägg till CHECK constraint med alla planer (inklusive enterprise)
--    Tar bort gamla om den finns
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'gratis', 'bas', 'pro', 'pro_trial', 'enterprise'));

-- 2. Säkerställ att trial_expires_at finns (om tabellen skapades utan den)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;

-- 3. RLS + policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users can read own profile'
  ) THEN
    CREATE POLICY "Users can read own profile" ON profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'service role full access'
  ) THEN
    CREATE POLICY "service role full access" ON profiles
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
