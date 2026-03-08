-- Kör denna i Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text,
  plan             text NOT NULL DEFAULT 'free',   -- free | pro_trial | bas | pro
  trial_expires_at timestamptz,
  has_used_trial   boolean NOT NULL DEFAULT false,
  stripe_customer_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Trigger: fyll i email + skapa rad automatiskt när ny användare registreras
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

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: användare kan bara läsa sin egna rad
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

-- Service role kan göra allt (webhook-server använder service role)
CREATE POLICY "service role full access"
  ON profiles FOR ALL USING (auth.role() = 'service_role');
