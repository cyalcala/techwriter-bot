import type { ArtifactEntry } from './artifact-queue';
import type { UploadedDocumentRecord } from './rag-client';
import { createSessionExport, type SessionExportMessage } from './session-transfer';

export interface ConversationSnapshot {
  id: string;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messages: SessionExportMessage[];
  artifacts: ArtifactEntry[];
  documents: UploadedDocumentRecord[];
  chatPath?: string | null;
}

interface CreateConversationSnapshotInput {
  id: string;
  sessionId: string;
  messages: SessionExportMessage[];
  artifacts: ArtifactEntry[];
  documents: UploadedDocumentRecord[];
  chatPath?: string | null;
  title?: string;
  createdAt?: string;
  archived?: boolean;
  now?: Date;
}

export function titleFromFirstUserMessage(messages: SessionExportMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUserMessage) return 'Untitled conversation';

  const words = firstUserMessage.content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_#[\]()>-]/g, ' ')
    .match(/[a-z0-9']+/gi)
    ?.slice(0, 3) ?? [];

  if (words.length === 0) return 'Untitled conversation';
  return words.map(toTitleWord).join(' ');
}

export function createConversationSnapshot(input: CreateConversationSnapshotInput): ConversationSnapshot {
  const now = input.now ?? new Date();
  const exported = createSessionExport({
    messages: input.messages,
    artifacts: input.artifacts,
    documents: input.documents,
    chatPath: input.chatPath,
    now,
  });
  const createdAt = input.createdAt || exported.exportedAt;

  return {
    id: input.id,
    sessionId: input.sessionId,
    title: cleanTitle(input.title) || titleFromFirstUserMessage(exported.messages),
    createdAt,
    updatedAt: exported.exportedAt,
    archived: input.archived ?? false,
    messages: exported.messages,
    artifacts: exported.artifacts,
    documents: exported.documents,
    chatPath: exported.chatPath,
  };
}

export function upsertConversationSnapshot(
  records: ConversationSnapshot[],
  snapshot: ConversationSnapshot,
): ConversationSnapshot[] {
  return sortByUpdatedDesc([
    snapshot,
    ...records.filter((record) => record.id !== snapshot.id),
  ]);
}

export function renameConversation(
  records: ConversationSnapshot[],
  id: string,
  title: string,
): ConversationSnapshot[] {
  const clean = cleanTitle(title);
  if (!clean) return records;
  return records.map((record) => record.id === id ? { ...record, title: clean } : record);
}

export function archiveConversation(
  records: ConversationSnapshot[],
  id: string,
  archived: boolean = true,
): ConversationSnapshot[] {
  return records.map((record) => record.id === id ? { ...record, archived } : record);
}

export function deleteConversation(records: ConversationSnapshot[], id: string): ConversationSnapshot[] {
  return records.filter((record) => record.id !== id);
}

export function listVisibleConversations(
  records: ConversationSnapshot[],
  options: { includeArchived?: boolean } = {},
): ConversationSnapshot[] {
  const visible = options.includeArchived ? records : records.filter((record) => !record.archived);
  return sortByUpdatedDesc(visible);
}

function sortByUpdatedDesc(records: ConversationSnapshot[]): ConversationSnapshot[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function cleanTitle(value?: string): string {
  return (value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function toTitleWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
