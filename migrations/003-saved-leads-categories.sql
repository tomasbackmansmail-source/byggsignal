-- Add saved_leads (array of strings like "permit:123" or "uph:456")
-- and categories (array of strings like "Nybyggnad", "Tillbyggnad")
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS saved_leads text[] DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}';
