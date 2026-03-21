-- Add applicant column to permits_v2
-- Also ensure profiles has the company fields (idempotent)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE permits_v2 ADD COLUMN IF NOT EXISTS applicant text;
