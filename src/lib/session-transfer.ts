import type { ArtifactEntry } from './artifact-queue';
import type { ArtifactPlacement, ArtifactType } from './stream-parser';
import type { UploadedDocumentRecord } from './rag-client';
import { normalizeArtifactSource } from './diagram-source-normalizer';

export const SESSION_EXPORT_VERSION = 1;

export type SessionExportMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  provider?: string;
  sources?: { title: string; url: string }[];
  searchTier?: 'none' | 'basic' | 'enhanced';
  empty?: boolean;
  liveResponse?: boolean;
};

export interface SessionExportPayload {
  version: typeof SESSION_EXPORT_VERSION;
  exportedAt: string;
  messages: SessionExportMessage[];
  artifacts: ArtifactEntry[];
  documents: UploadedDocumentRecord[];
  chatPath?: string | null;
}

export type SessionImportResult =
  | { ok: true; payload: SessionExportPayload }
  | { ok: false; message: string };

interface CreateSessionExportInput {
  messages: SessionExportMessage[];
  artifacts: ArtifactEntry[];
  documents: UploadedDocumentRecord[];
  chatPath?: string | null;
  now?: Date;
}

const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);
const SEARCH_TIERS = new Set(['none', 'basic', 'enhanced']);
const ARTIFACT_TYPES = new Set([
  'code',
  'html',
  'svg',
  'mermaid',
  'react',
  'katex',
  'markmap',
  'd2',
  'vega',
  'graphviz',
  'plantuml',
  'flowchart',
  'deck',
]);
const ARTIFACT_PLACEMENTS = new Set(['inline', 'side', 'modal']);
const ARTIFACT_STATUSES = new Set(['generating', 'ready', 'updating', 'error']);

export function createSessionExport(input: CreateSessionExportInput): SessionExportPayload {
  return {
    version: SESSION_EXPORT_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    messages: input.messages.map(cloneMessage).filter((message): message is SessionExportMessage => message !== null),
    artifacts: input.artifacts.map(cloneArtifactEntry).filter((entry): entry is ArtifactEntry => entry !== null),
    documents: input.documents.map(cloneDocument).filter((document): document is UploadedDocumentRecord => document !== null),
    chatPath: cleanOptionalString(input.chatPath) ?? null,
  };
}

export function parseSessionImport(json: string): SessionImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, message: 'Choose a valid Techwriter session JSON file.' };
  }

  if (!isRecord(raw)) {
    return { ok: false, message: 'Session backup must be a JSON object.' };
  }

  if (raw.version !== SESSION_EXPORT_VERSION) {
    return { ok: false, message: 'This session backup version is not supported.' };
  }

  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(cloneMessage).filter((message): message is SessionExportMessage => message !== null)
    : [];
  if (messages.length === 0) {
    return { ok: false, message: 'Session backup does not contain any messages.' };
  }

  const exportedAt = cleanOptionalString(raw.exportedAt) ?? new Date().toISOString();
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map(cloneArtifactEntry).filter((entry): entry is ArtifactEntry => entry !== null)
    : [];
  const documents = Array.isArray(raw.documents)
    ? raw.documents.map(cloneDocument).filter((document): document is UploadedDocumentRecord => document !== null)
    : [];

  return {
    ok: true,
    payload: {
      version: SESSION_EXPORT_VERSION,
      exportedAt,
      messages,
      artifacts,
      documents,
      chatPath: cleanOptionalString(raw.chatPath) ?? null,
    },
  };
}

export function sessionExportFilename(date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  return `techwriter-session-${stamp}.json`;
}

function cloneMessage(input: unknown): SessionExportMessage | null {
  if (!isRecord(input)) return null;
  if (typeof input.role !== 'string' || !MESSAGE_ROLES.has(input.role)) return null;
  if (typeof input.content !== 'string') return null;

  const message: SessionExportMessage = {
    role: input.role as SessionExportMessage['role'],
    content: input.content,
  };
  const createdAt = cleanOptionalString(input.createdAt);
  if (createdAt) message.createdAt = createdAt;
  const provider = cleanOptionalString(input.provider);
  if (provider) message.provider = provider;
  const sources = cloneSources(input.sources);
  if (sources.length > 0) message.sources = sources;
  if (typeof input.searchTier === 'string' && SEARCH_TIERS.has(input.searchTier)) {
    message.searchTier = input.searchTier as SessionExportMessage['searchTier'];
  }
  if (typeof input.empty === 'boolean') message.empty = input.empty;
  if (typeof input.liveResponse === 'boolean') message.liveResponse = input.liveResponse;

  return message;
}

function cloneSources(input: unknown): { title: string; url: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((source) => {
      if (!isRecord(source)) return null;
      const title = cleanOptionalString(source.title);
      const url = cleanOptionalString(source.url);
      return title && url ? { title, url } : null;
    })
    .filter((source): source is { title: string; url: string } => source !== null);
}

function cloneArtifactEntry(input: unknown): ArtifactEntry | null {
  if (!isRecord(input) || !isRecord(input.artifact)) return null;
  const messageIdx = Number(input.messageIdx);
  const ts = Number(input.ts);
  const artifact = input.artifact;
  const id = cleanOptionalString(artifact.id);
  const code = typeof artifact.code === 'string' ? artifact.code : null;
  const title = cleanOptionalString(artifact.title) ?? 'Artifact';
  const type = cleanOptionalString(artifact.type);
  const placement = cleanOptionalString(artifact.placement);

  if (!Number.isFinite(messageIdx) || messageIdx < 0) return null;
  if (!Number.isFinite(ts) || ts < 0) return null;
  if (!id || code === null || !type || !ARTIFACT_TYPES.has(type)) return null;
  if (!placement || !ARTIFACT_PLACEMENTS.has(placement)) return null;

  const entry: ArtifactEntry = {
    messageIdx,
    ts,
    artifact: {
      id,
      type: type as ArtifactType,
      title,
      placement: placement as ArtifactPlacement,
      code: normalizeArtifactSource(type, code),
    },
  };

  const language = cleanOptionalString(artifact.language);
  if (language) entry.artifact.language = language;
  if (typeof input.status === 'string' && ARTIFACT_STATUSES.has(input.status)) {
    entry.status = input.status as ArtifactEntry['status'];
  }
  const error = cleanOptionalString(input.error);
  if (error) entry.error = error;

  return entry;
}

function cloneDocument(input: unknown): UploadedDocumentRecord | null {
  if (!isRecord(input)) return null;
  const id = cleanOptionalString(input.id);
  const filename = cleanOptionalString(input.filename);
  const chunkCount = Number(input.chunkCount);
  if (!id || !filename || !Number.isFinite(chunkCount) || chunkCount < 0) return null;
  return { id, filename, chunkCount };
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
