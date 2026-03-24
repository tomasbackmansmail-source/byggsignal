-- Migration 011: Add document URL columns for future use
-- Run in Supabase SQL Editor

ALTER TABLE procurements
ADD COLUMN IF NOT EXISTS document_urls text[],
ADD COLUMN IF NOT EXISTS document_fetched_at timestamp;
