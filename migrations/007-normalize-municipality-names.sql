-- Migration 007: Normalize municipality names in permits_v2
-- RUN AFTER 006-create-municipalities-table.sql
-- NOTE: This migration was already executed programmatically on 2026-03-23

-- Step 1: Remove "kommun" suffix duplicates (delete dupes, rename rest)
-- Bollebygds kommun -> Bollebygd (6 rows deleted as dupes)
-- Eslövs kommun -> Eslöv (8 dupes deleted, 12 renamed)
-- Finspångs kommun -> Finspång (14 dupes deleted, 1 conflict-deleted)
-- Norbergs kommun -> Norberg (5 renamed)

-- Step 2: Fix misspelled names (ASCII -> proper Swedish)
-- Ovanaker -> Ovanåker (2 renamed)
-- Grastorp -> Grästorp (4 conflict-deleted, had exact dupes)
-- Toreboda -> Töreboda (5 conflict-deleted, had exact dupes)

-- Step 3: Remove non-municipality entries
-- Västra Mälardalens Myndighetsförbund (10 rows deleted)

-- Step 4: Fill missing län from municipality->county mapping
-- 12 municipalities had NULL län, 18 rows total fixed
-- After: 0 rows with NULL län

-- Results: 5516 total permits, 51 unique municipalities, 0 NULL län
