import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const MAX_TEXT_SIZE = 1_000_000;
const MAX_CHUNKS = 100;
const ingestRateLimits = new Map<string, { count: number; reset: number }>();

export const POST: APIRoute = async ({ request }) => {
  const cfEnv = env as any;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  const now = Date.now();
  const rl = ingestRateLimits.get(ip);
  if (rl && now < rl.reset) {
    if (rl.count >= 5) return new Response(JSON.stringify({ error: 'Rate limit' }), { status: 429 });
    rl.count++;
  } else {
    ingestRateLimits.set(ip, { count: 1, reset: now + 60_000 });
  }

  try {
    if (Number(request.headers.get('content-length') || '0') > MAX_TEXT_SIZE + 1024) {
      return new Response(JSON.stringify({ error: 'File too large' }), { status: 413 });
    }

    const body = await request.json();
    const { text, fileName, sessionId } = body;

    if (!text || !sessionId) {
      return new Response(JSON.stringify({ error: 'Missing content or session' }), { status: 400 });
    }

    const safeText = String(text).slice(0, MAX_TEXT_SIZE);
    if (!safeText.trim()) {
      return new Response(JSON.stringify({ error: 'Empty content' }), { status: 400 });
    }

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];

    for (let i = 0; i < safeText.length && chunks.length < MAX_CHUNKS; i += chunkSize - overlap) {
      chunks.push(safeText.slice(i, i + chunkSize));
    }

    if (!cfEnv.AI) {
      return new Response(JSON.stringify({ error: 'Embedding service unavailable' }), { status: 503 });
    }

    const allEmbeddings: number[][] = [];
    const batchSize = 20;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const aiResponse = await cfEnv.AI.run('@cf/baai/bge-small-en-v1.5', {
        text: batch,
      });

      if (!aiResponse?.data) {
        return new Response(JSON.stringify({ error: 'Embedding generation failed' }), { status: 502 });
      }

      allEmbeddings.push(...aiResponse.data);
    }

    if (!cfEnv.SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Storage unavailable' }), { status: 503 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      cfEnv.SUPABASE_URL || 'https://vstxlstksrtiskyuxdjt.supabase.co',
      cfEnv.SUPABASE_SERVICE_ROLE_KEY,
    );

    const rows = chunks.map((chunk, i) => ({
      user_id: '00000000-0000-0000-0000-000000000000',
      session_id: sessionId,
      title: `${String(fileName || 'document')} (Part ${i + 1})`,
      content: chunk,
      embedding: allEmbeddings[i],
      metadata: { fileName, part: i + 1, totalParts: chunks.length },
    }));

    const { error: insertError } = await supabase.from('notes').insert(rows);
    if (insertError) return new Response(JSON.stringify({ error: 'Storage write failed' }), { status: 500 });

    return new Response(JSON.stringify({ success: true, count: chunks.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Ingest]', error.message || String(error));
    return new Response(JSON.stringify({ error: 'Processing failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};