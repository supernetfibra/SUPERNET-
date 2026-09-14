-- Add photo columns to install_requests
-- Photos stored as base64 data URLs (compressed client-side to ~500KB max)

ALTER TABLE install_requests
  ADD COLUMN IF NOT EXISTS photo_house_front TEXT,
  ADD COLUMN IF NOT EXISTS photo_street TEXT,
  ADD COLUMN IF NOT EXISTS photo_id_front TEXT,
  ADD COLUMN IF NOT EXISTS photo_id_back TEXT;
