-- Migration 008: Add notification columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_frequency text DEFAULT 'weekly';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- Migrate existing notis_frequency values if column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'notis_frequency') THEN
    UPDATE profiles SET notification_frequency = notis_frequency WHERE notis_frequency IS NOT NULL;
  END IF;
END $$;
