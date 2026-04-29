import type { APIRoute } from 'astro';
import { routeChat } from '../../lib/zen-router';

let cfWorkerEnv: any = null;
try {
  const mod = await import('cloudflare:workers');
  cfWorkerEnv = mod.env || {};
} catch (e) {
  // not in CF Workers runtime (local dev without wrangler)
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count++;
  return true;
}

function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    return input.slice(0, 8000).replace(/[\x00-\x1F\x7F]/g, '');
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (input && typeof input === 'object') {
    const sanitized: any = {};
    for (const key of Object.keys(input)) {
      if (['role', 'content', 'name'].includes(key)) {
        sanitized[key] = sanitizeInput(input[key]);
      }
    }
    return sanitized;
  }
  return input;
}

export const POST: APIRoute = async (context) => {
  const { request, locals } = context;

  // Primary: cloudflare:workers env (proven working on CF Pages)
  let env: any = cfWorkerEnv ? { ...cfWorkerEnv } : {};

  // Fallback: Astro locals (for other adapters)
  if ((locals as any)?.runtime?.env) {
    for (const [k, v] of Object.entries((locals as any).runtime.env)) {
      if (v !== undefined && v !== null && !env[k]) env[k] = v;
    }
  }

  // Fallback: Node.js process.env (local dev)
  if (typeof process !== 'undefined' && process.env) {
    for (const [k, v] of Object.entries(process.env)) {
      if (v && !env[k]) env[k] = v;
    }
  }

  // Last resort: .env file (local dev)
  if (!env.CEREBRAS_API_KEY) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split(/\r?\n/).forEach((line: string) => {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            const key = line.substring(0, eqIdx).trim();
            const val = line.substring(eqIdx + 1).trim();
            if (val && !env[key]) env[key] = val;
          }
        });
      }
    } catch (e) {}
  }

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED', details: 'Too many requests. Please try again later.' }), { status: 429 });
  }

  try {
    const body = await request.json().catch(e => {
      throw new Error(`Failed to parse request JSON: ${e.message}`);
    });

    const { messages, intent } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST', details: 'The "messages" field is missing or not an array.' }), { status: 400 });
    }

    const sanitizedMessages = sanitizeInput(messages);
    return await routeChat(intent || 'chat-fast', sanitizedMessages, locals, env);
  } catch (error: any) {
    console.error("[Chat API] Fatal Error:", error);
    return new Response(JSON.stringify({ 
      error: 'INTERNAL_ERROR', 
      details: error.message || 'An unexpected error occurred.'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
