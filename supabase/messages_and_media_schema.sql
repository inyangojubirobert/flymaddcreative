-- Historical bootstrap schema. Do not run against the existing database.
-- The auth.uid() policies below assume Supabase Auth identities, which the
-- current participant backend does not use. This is not its reconciliation path.
-- For existing tables, add_messages_media_columns.sql adds only is_read if
-- missing, preserving existing data, indexes, foreign keys, and RLS policies.
-- See docs/MESSAGES_MEDIA_SCHEMA_AUDIT.md for the current backend audit.

-- Messages table for storing chat messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_urls JSONB DEFAULT NULL, -- Store Cloudinary URLs as array
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Media table for tracking Cloudinary uploads
CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  cloudinary_url TEXT NOT NULL,
  cloudinary_public_id TEXT NOT NULL,
  media_type VARCHAR(50), -- 'image', 'video', 'document', etc.
  file_name VARCHAR(255),
  file_size INTEGER, -- in bytes
  created_at TIMESTAMP DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_media_participant_id ON media(participant_id);
CREATE INDEX idx_media_created_at ON media(created_at);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own messages (sent or received)
CREATE POLICY messages_read_policy ON messages
  FOR SELECT
  USING (auth.uid()::text = sender_id::text OR auth.uid()::text = receiver_id::text);

-- RLS Policy: Users can only insert messages they send
CREATE POLICY messages_insert_policy ON messages
  FOR INSERT
  WITH CHECK (auth.uid()::text = sender_id::text);

-- RLS Policy: Users can only update their own messages
CREATE POLICY messages_update_policy ON messages
  FOR UPDATE
  USING (auth.uid()::text = sender_id::text)
  WITH CHECK (auth.uid()::text = sender_id::text);

-- RLS Policy: Users can only delete their own messages
CREATE POLICY messages_delete_policy ON messages
  FOR DELETE
  USING (auth.uid()::text = sender_id::text);

-- RLS Policy: Users can only read their own media
CREATE POLICY media_read_policy ON media
  FOR SELECT
  USING (auth.uid()::text = participant_id::text);

-- RLS Policy: Users can only insert their own media
CREATE POLICY media_insert_policy ON media
  FOR INSERT
  WITH CHECK (auth.uid()::text = participant_id::text);

-- RLS Policy: Users can only delete their own media
CREATE POLICY media_delete_policy ON media
  FOR DELETE
  USING (auth.uid()::text = participant_id::text);
