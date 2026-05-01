import type { APIRoute } from 'astro';
import { env as cfGlobalEnv } from 'cloudflare:workers';

const MAX_TEXT_SIZE = 500_000;
const MAX_CHUNKS = 50;
const ingestRateLimits = new Map<string, { count: number; reset: number }>();

export const POST: APIRoute = async ({ request, locals }) => {
  let cfEnv: any = {};
  try { if (cfGlobalEnv) cfEnv = { ...(cfGlobalEnv as any) }; } catch (e) {}
  try { const rEnv = (locals as any)?.runtime?.env; if (rEnv) for (const [k, v] of Object.entries(rEnv)) { if (v != null && !cfEnv[k]) cfEnv[k] = v; } } catch (e) {}
  if (typeof process !== 'undefined' && process.env) { for (const [k, v] of Object.entries(process.env)) { if (v && !cfEnv[k]) cfEnv[k] = v; } }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  const now = Date.now();
  const rl = ingestRateLimits.get(ip);
  if (rl && now < rl.reset) {
    if (rl.count >= 5) return new Response(JSON.stringify({ error: 'Rate limit', message: 'Too many uploads. Wait a minute.' }), { status: 429 });
    rl.count++;
  } else {
    ingestRateLimits.set(ip, { count: 1, reset: now + 60_000 });
  }

  try {
    if (Number(request.headers.get('content-length') || '0') > MAX_TEXT_SIZE + 1024) {
      return new Response(JSON.stringify({ error: 'File too large', message: 'File exceeds 1MB limit.' }), { status: 413 });
    }

    const body = await request.json();
    const { text, fileName, sessionId } = body;

    if (!text || !sessionId) {
      return new Response(JSON.stringify({ error: 'Missing content or session', message: 'No text or session ID provided.' }), { status: 400 });
    }

    const safeText = String(text).slice(0, MAX_TEXT_SIZE);
    if (!safeText.trim()) {
      return new Response(JSON.stringify({ error: 'Empty content', message: 'The file appears to be empty.' }), { status: 400 });
    }

    const chunkSize = 500;
    const overlap = 100;
    const chunks: string[] = [];

    for (let i = 0; i < safeText.length && chunks.length < MAX_CHUNKS; i += chunkSize - overlap) {
      chunks.push(safeText.slice(i, i + chunkSize));
    }

    if (!cfEnv.AI) {
      return new Response(JSON.stringify({ error: 'Embedding service unavailable', message: 'AI embedding service not available.' }), { status: 503 });
    }

    const allEmbeddings: number[][] = [];
    const batchSize = 5;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const aiResponse = await cfEnv.AI.run('@cf/baai/bge-small-en-v1.5', {
        text: batch,
      });

      if (!aiResponse?.data) {
        return new Response(JSON.stringify({ error: 'Embedding generation failed', message: 'Could not generate embeddings for this document.' }), { status: 502 });
      }

      allEmbeddings.push(...aiResponse.data);
    }

    const supabaseUrl = cfEnv.SUPABASE_URL || 'https://vstxlstksrtiskyuxdjt.supabase.co';
    const supabaseKey = cfEnv.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return new Response(JSON.stringify({ error: 'Storage unavailable', message: 'Database credentials not configured.' }), { status: 503 });
    }

    const rows = chunks.map((chunk, i) => ({
      user_id: '00000000-0000-0000-0000-000000000000',
      session_id: sessionId,
      title: `${String(fileName || 'document')} (Part ${i + 1})`,
      content: chunk,
      embedding: allEmbeddings[i],
      metadata: { fileName, part: i + 1, totalParts: chunks.length },
    }));

    const insertRes = await Promise.race([
      fetch(`${supabaseUrl}/rest/v1/notes`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(rows),
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);

    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => 'unknown');
      console.log(JSON.stringify({ event: 'ingest_insert_error', status: insertRes.status, body: errText.slice(0, 200) }));
      return new Response(JSON.stringify({ error: 'Storage write failed', message: `Database error: ${insertRes.status}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, count: chunks.length, message: `Uploaded ${chunks.length} chunks` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.log(JSON.stringify({ event: 'ingest_failure', message: error.message?.slice(0, 200) }));
    return new Response(JSON.stringify({ error: 'Processing failed', message: error.message || 'Upload failed.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};