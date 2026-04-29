import type { APIRoute } from 'astro';
import { routeChat } from '../../lib/zen-router';

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

  let env: Record<string, string> = {};
  try {
    env = (locals as any)?.runtime?.env || (locals as any)?.env || {};
  } catch (e) {}

  console.log("[Chat API] Initial env keys:", Object.keys(env));

  // Try to get secrets from import.meta.env
  const importEnv = (import.meta as any).env || {};
  console.log("[Chat API] import.meta.env keys:", Object.keys(importEnv));

  // Merge secrets from import.meta.env
  const secretsToCheck = ['TURNSTILE_SECRET_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY'];
  for (const key of secretsToCheck) {
    if (!env[key] && importEnv[key]) {
      env[key] = importEnv[key];
    }
  }

  console.log("[Chat API] Final env keys:", Object.keys(env));

  const clientIP = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (!checkRateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED', details: 'Too many requests. Please try again later.' }), { status: 429 });
  }

  // Bot protection is handled by Cloudflare's infrastructure-level Bot Management.
  // No application-level Turnstile needed; this removes user friction and token expiry issues.

  try {
    const body = await request.json();
    const { messages, intent } = body;

    const sanitizedMessages = sanitizeInput(messages);
    console.log(`[Chat API] Routing intent: ${intent || 'chat-fast'}`);
    return await routeChat(intent || 'chat-fast', sanitizedMessages, env);
  } catch (error: any) {
    console.error("[Chat API] Fatal Error:", error);
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', details: 'An unexpected error occurred.' }), { status: 500 });
  }
};
