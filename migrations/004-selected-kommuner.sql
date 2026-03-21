-- Ensure selected_kommuner column exists on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS selected_kommuner jsonb DEFAULT '[]'::jsonb;

-- Ensure updated_at column exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
