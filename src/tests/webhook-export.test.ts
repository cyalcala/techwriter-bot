import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  WEBHOOK_RETRY_BACKOFF_MS,
  createWebhookExportPayload,
  sendWebhookExport,
  validateWebhookUrl,
} from '../lib/webhook-export';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function functionBlock(file: string, name: string): string {
  const start = file.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = file.indexOf('\n  function ', start + 1);
  return next === -1 ? file.slice(start) : file.slice(start, next);
}

describe('user-invoked webhook export', () => {
  it('creates a bounded assistant response payload without transcript metadata', () => {
    const payload = createWebhookExportPayload({
      index: 1,
      now: new Date('2026-06-02T03:04:05.000Z'),
      message: {
        role: 'assistant',
        content: 'Ship this. [Doc: api.md, line 4]',
        createdAt: '2026-06-02T03:00:00.000Z',
        provider: 'groq-fast',
        searchTier: 'basic',
        sources: [{ title: 'API Guide', url: 'https://example.com/api' }],
      },
    });

    expect(payload).toEqual({
      type: 'assistant-response',
      exportedAt: '2026-06-02T03:04:05.000Z',
      messageNumber: 2,
      role: 'assistant',
      content: 'Ship this. [Doc: api.md, line 4]',
      createdAt: '2026-06-02T03:00:00.000Z',
      provider: 'groq-fast',
      searchTier: 'basic',
      sources: [{ title: 'API Guide', url: 'https://example.com/api' }],
    });
    expect(JSON.stringify(payload)).not.toContain('## Conversation');
    expect(JSON.stringify(payload)).not.toContain('## Documents');
  });

  it('accepts only HTTPS webhook URLs and rejects local/private targets', () => {
    expect(validateWebhookUrl(' https://hooks.example.com/incoming ')).toBe('https://hooks.example.com/incoming');
    expect(validateWebhookUrl('http://hooks.example.com/incoming')).toBeNull();
    expect(validateWebhookUrl('https://localhost/hook')).toBeNull();
    expect(validateWebhookUrl('https://127.0.0.1/hook')).toBeNull();
    expect(validateWebhookUrl('https://10.1.2.3/hook')).toBeNull();
    expect(validateWebhookUrl('https://192.168.0.2/hook')).toBeNull();
    expect(validateWebhookUrl('https://172.20.0.2/hook')).toBeNull();
    expect(validateWebhookUrl('not a url')).toBeNull();
  });

  it('retries transient delivery failures with the documented backoff schedule', async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 502 }))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await sendWebhookExport({
      url: 'https://hooks.example.com/incoming',
      payload: {
        type: 'assistant-response',
        exportedAt: '2026-06-02T03:04:05.000Z',
        messageNumber: 2,
        role: 'assistant',
        content: 'Ship this.',
      },
      fetchImpl,
      wait: async (ms) => { waits.push(ms); },
    });

    expect(WEBHOOK_RETRY_BACKOFF_MS).toEqual([1000, 5000, 15000]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 5000]);
    expect(result).toMatchObject({ ok: true, attempts: 3, status: 200 });
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('keeps the API route private, same-origin invoked, and storage-free', () => {
    const route = source('src/pages/api/webhook-export.ts');

    expect(route).toContain("from '../../lib/api-response'");
    expect(route).toContain("from '../../lib/csrf'");
    expect(route).toContain("const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private' }");
    expect(route).toContain('hasTrustedOrigin(request)');
    expect(route).toContain('checkCSRF(request)');
    expect(route).toContain('sendWebhookExport');
    expect(route).toContain('headers: RESPONSE_HEADERS');
    expect(route).not.toContain('localStorage');
    expect(route).not.toContain('sessionStorage');
    expect(route).not.toContain('indexedDB');
    expect(route).not.toContain('.put(');
    expect(route).not.toContain('SESSION');
  });

  it('wires a user-invoked webhook action with visible manual retry state', () => {
    const island = source('src/components/ChatIsland.svelte');
    const messages = source('src/components/ChatMessages.svelte');
    const exportMessageWebhook = functionBlock(island, 'exportMessageWebhook');
    const retryWebhookExport = functionBlock(island, 'retryWebhookExport');

    expect(island).toContain("type WebhookDeliveryState =");
    expect(island).toContain("let webhookUrl = $state('')");
    expect(island).toContain('let webhookDelivery = $state<WebhookDeliveryState | null>(null)');
    expect(island).toContain('async function exportMessageWebhook(idx: number)');
    expect(island).toContain('async function retryWebhookExport(idx: number)');
    expect(island).toContain('onExportMessageWebhook={exportMessageWebhook}');
    expect(island).toContain('onRetryWebhookExport={retryWebhookExport}');
    expect(island).toContain('{webhookDelivery}');
    expect(exportMessageWebhook).toContain("fetch('/api/webhook-export'");
    expect(exportMessageWebhook).toContain('JSON.stringify({ webhookUrl: targetUrl, index: idx, message })');
    expect(exportMessageWebhook).not.toContain('localStorage');
    expect(exportMessageWebhook).not.toContain('sessionStorage');
    expect(retryWebhookExport).toContain('exportMessageWebhook(idx)');
    expect(messages).toContain('onExportMessageWebhook: (idx: number) => void');
    expect(messages).toContain('onRetryWebhookExport: (idx: number) => void');
    expect(messages).toContain('webhookDelivery: WebhookDeliveryState | null');
    expect(messages).toContain('title="Send response to webhook"');
    expect(messages).toContain('title="Retry webhook export"');
  });
});
