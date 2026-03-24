-- Migration 010: Add parsed fields for procurement descriptions
-- Run in Supabase SQL Editor

ALTER TABLE procurements
ADD COLUMN IF NOT EXISTS estimated_value_parsed numeric,
ADD COLUMN IF NOT EXISTS contact_name text,
ADD COLUMN IF NOT EXISTS contact_email text,
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS parsed_requirements text[],
ADD COLUMN IF NOT EXISTS parsed_at timestamp;
