import { createClient } from '@supabase/supabase-js';

// Helper to initialize the Supabase client from Cloudflare environment variables
export function getSupabase(env: any) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY; // Using service role since worker handles auth and isolation

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables not set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Function to store an embedded note chunk (supports session isolation)
export async function storeNoteChunk(env: any, sessionId: string, title: string, content: string, embedding: number[], metadata: any = {}) {
  const supabase = getSupabase(env);
  
  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: '00000000-0000-0000-0000-000000000000', // System user or dummy for public sandbox
      session_id: sessionId,
      title,
      content,
      embedding,
      metadata
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

// Function to retrieve context (RAG) filtered by session
export async function retrieveRelevantContext(env: any, sessionId: string, queryEmbedding: number[], limit: number = 5) {
  const supabase = getSupabase(env);

  const { data, error } = await supabase.rpc('match_notes', {
    query_embedding: queryEmbedding,
    match_threshold: 0.4, // Lowered from 0.7 for better recall
    match_count: limit,
    p_session_id: sessionId
  });

  if (error) throw error;
  return data;
}
