import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  const cfEnv = env as any;

  console.log("[Ingest] Request received. Env keys:", Object.keys(cfEnv));

  try {
    const body = await request.json();
    const { text, fileName, sessionId } = body;

    if (!text || !sessionId) {
      return new Response(JSON.stringify({ error: 'Missing content or session', message: 'Missing content or session' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Chunking logic
    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];
    
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    console.log(`[Ingest] Processing ${chunks.length} chunks for ${fileName}`);

    // 2. Generate Embeddings in Batches
    if (!cfEnv.AI) {
      throw new Error('Cloudflare AI binding is missing. Please ensure your wrangler.json has the "ai" binding.');
    }

    const allEmbeddings: number[][] = [];
    const batchSize = 20;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      console.log(`[Ingest] Generating embeddings for batch ${Math.floor(i/batchSize) + 1}...`);
      
      const aiResponse = await cfEnv.AI.run('@cf/baai/bge-small-en-v1.5', {
        text: batch
      });

      if (!aiResponse || !aiResponse.data) {
        throw new Error(`AI Embedding service failed at batch ${Math.floor(i/batchSize) + 1}`);
      }
      
      allEmbeddings.push(...aiResponse.data);
    }

    console.log(`[Ingest] Generated ${allEmbeddings.length} embeddings total.`);

    // 3. Lazy-load Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = cfEnv.SUPABASE_URL || 'https://vstxlstksrtiskyuxdjt.supabase.co';
    const supabaseKey = cfEnv.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Please add it to your Cloudflare Dashboard > Settings > Functions > Variables.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const rows = chunks.map((chunk, i) => ({
      user_id: '00000000-0000-0000-0000-000000000000',
      session_id: sessionId,
      title: `${fileName} (Part ${i + 1})`,
      content: chunk,
      embedding: allEmbeddings[i],
      metadata: { fileName, part: i + 1, totalParts: chunks.length }
    }));

    console.log(`[Ingest] Inserting ${rows.length} rows into Supabase...`);
    const { error: insertError } = await supabase.from('notes').insert(rows);
    
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, count: chunks.length }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("[Ingest API] Fatal Error:", error);
    return new Response(JSON.stringify({ 
      error: 'Ingestion failed', 
      message: error.message || String(error)
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
