import { createSessionExport, type SessionExportMessage } from './session-transfer';

export const WEBHOOK_RETRY_BACKOFF_MS = [1000, 5000, 15000] as const;

export interface WebhookExportPayload {
  type: 'assistant-response';
  exportedAt: string;
  messageNumber: number;
  role: 'assistant';
  content: string;
  createdAt?: string;
  provider?: string;
  searchTier?: 'basic' | 'enhanced';
  sources?: { title: string; url: string }[];
}

export interface CreateWebhookExportPayloadInput {
  index: number;
  message: SessionExportMessage;
  now?: Date;
}

export interface SendWebhookExportInput {
  url: string;
  payload: WebhookExportPayload;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

export type WebhookExportResult =
  | { ok: true; attempts: number; status: number; deliveredAt: string }
  | { ok: false; attempts: number; status?: number; error: string };

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

export function createWebhookExportPayload(input: CreateWebhookExportPayloadInput): WebhookExportPayload | null {
  const payload = createSessionExport({
    messages: [input.message],
    artifacts: [],
    documents: [],
    now: input.now,
  });
  const message = payload.messages[0];
  if (!message || message.role !== 'assistant' || !message.content.trim()) return null;

  const exportPayload: WebhookExportPayload = {
    type: 'assistant-response',
    exportedAt: payload.exportedAt,
    messageNumber: safeMessageNumber(input.index),
    role: 'assistant',
    content: message.content,
  };

  if (message.createdAt) exportPayload.createdAt = message.createdAt;
  if (message.provider) exportPayload.provider = message.provider;
  if (message.searchTier && message.searchTier !== 'none') exportPayload.searchTier = message.searchTier;
  if (message.sources && message.sources.length > 0) exportPayload.sources = message.sources;

  return exportPayload;
}

export function validateWebhookUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    if (host === '[::1]' || host === '::1') return null;
    if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function sendWebhookExport(input: SendWebhookExportInput): Promise<WebhookExportResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait = input.wait ?? delay;
  let attempts = 0;
  let lastStatus: number | undefined;
  let lastError = 'Webhook endpoint did not accept the export.';

  for (let retryIndex = 0; retryIndex <= WEBHOOK_RETRY_BACKOFF_MS.length; retryIndex += 1) {
    attempts += 1;
    try {
      const response = await fetchImpl(input.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.payload),
      });
      lastStatus = response.status;
      if (response.ok) {
        return {
          ok: true,
          attempts,
          status: response.status,
          deliveredAt: new Date().toISOString(),
        };
      }
      lastError = `Webhook endpoint returned ${response.status}.`;
      if (!shouldRetryStatus(response.status)) break;
    } catch {
      lastError = 'Webhook endpoint could not be reached.';
    }

    const backoff = WEBHOOK_RETRY_BACKOFF_MS[retryIndex];
    if (backoff == null) break;
    await wait(backoff);
  }

  return { ok: false, attempts, status: lastStatus, error: lastError };
}

function safeMessageNumber(index: number): number {
  return Number.isFinite(index) && index >= 0 ? Math.floor(index) + 1 : 1;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
