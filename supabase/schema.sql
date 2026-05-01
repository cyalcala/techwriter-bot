-- Enable the pgvector extension to work with embedding vectors
CREATE EXTENSION IF NOT EXISTS vector;

-- Entities table for preferred terminology and style guide rules
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g., 'preferred_term', 'avoid_term'
  description TEXT,
  session_id UUID, -- For sandbox isolation
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notes table for storing document chunks
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  -- 384 dimensions is standard for all-MiniLM-L6-v2 via transformers.js
  embedding vector(384),
  metadata JSONB DEFAULT '{}'::jsonb,
  session_id UUID, -- For sandbox isolation
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Links table for Obsidian-like bi-directional graph memory
CREATE TABLE links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL, -- e.g., 'semantic', 'explicit_wiki'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Function to search for notes by vector proximity
CREATE OR REPLACE FUNCTION match_notes(
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  p_session_id UUID
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  similarity float
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    notes.id,
    notes.title,
    notes.content,
    1 - (notes.embedding <=> query_embedding) AS similarity
  FROM notes
  WHERE 1 - (notes.embedding <=> query_embedding) > match_threshold
    AND (notes.session_id = p_session_id OR notes.session_id IS NULL)
  ORDER BY notes.embedding <=> query_embedding
  LIMIT match_count;
$$;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_notes" ON notes
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_insert_notes" ON notes
  FOR INSERT
  TO anon
  WITH CHECK (true);
