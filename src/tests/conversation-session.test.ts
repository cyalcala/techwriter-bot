import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArtifactEntry } from '../lib/artifact-queue';
import {
  archiveConversation,
  createConversationSnapshot,
  deleteConversation,
  listVisibleConversations,
  renameConversation,
  titleFromFirstUserMessage,
  upsertConversationSnapshot,
} from '../lib/conversation-session';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function functionBlock(file: string, name: string): string {
  const start = file.indexOf(`function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = file.indexOf('\n  function ', start + 1);
  return next === -1 ? file.slice(start) : file.slice(start, next);
}

const artifact: ArtifactEntry = {
  messageIdx: 2,
  ts: 2000,
  artifact: {
    id: 'architecture',
    type: 'mermaid',
    title: 'Architecture',
    placement: 'inline',
    code: 'graph TD\nA-->B',
  },
};

describe('active-session conversation history foundation', () => {
  it('creates a three-word title from the first user message', () => {
    expect(titleFromFirstUserMessage([
      { role: 'assistant', content: 'How can I help?' },
      { role: 'user', content: 'Review the authentication deployment guide for clarity.' },
    ])).toBe('Review The Authentication');
    expect(titleFromFirstUserMessage([{ role: 'assistant', content: 'Empty' }])).toBe('Untitled conversation');
  });

  it('captures an active-session snapshot without document source text', () => {
    const snapshot = createConversationSnapshot({
      id: 'conv-1',
      sessionId: 'session-1',
      now: new Date('2026-06-01T01:02:03.000Z'),
      messages: [
        { role: 'user', content: 'Draft release notes.' },
        { role: 'assistant', content: 'Here is a draft.' },
      ],
      artifacts: [artifact],
      documents: [
        {
          id: 'doc-1',
          filename: 'api.md',
          chunkCount: 5,
          sourceText: 'private source',
          text: 'private chunk',
          vector: [1, 2, 3],
        } as any,
      ],
      chatPath: 'balanced',
    });

    expect(snapshot).toMatchObject({
      id: 'conv-1',
      sessionId: 'session-1',
      title: 'Draft Release Notes',
      createdAt: '2026-06-01T01:02:03.000Z',
      updatedAt: '2026-06-01T01:02:03.000Z',
      archived: false,
      chatPath: 'balanced',
    });
    expect(snapshot.documents).toEqual([{ id: 'doc-1', filename: 'api.md', chunkCount: 5 }]);
    expect(snapshot.artifacts).toEqual([artifact]);
    expect(JSON.stringify(snapshot)).not.toContain('private source');
    expect(JSON.stringify(snapshot)).not.toContain('private chunk');
    expect(JSON.stringify(snapshot)).not.toContain('vector');
  });

  it('upserts, renames, archives, filters, and deletes in-memory conversation records', () => {
    const first = createConversationSnapshot({
      id: 'conv-1',
      sessionId: 'session-1',
      now: new Date('2026-06-01T01:00:00.000Z'),
      messages: [{ role: 'user', content: 'Review API guide' }],
      artifacts: [],
      documents: [],
    });
    const second = createConversationSnapshot({
      id: 'conv-2',
      sessionId: 'session-2',
      now: new Date('2026-06-01T02:00:00.000Z'),
      messages: [{ role: 'user', content: 'Draft SDK notes' }],
      artifacts: [],
      documents: [],
    });

    let records = upsertConversationSnapshot([], first);
    records = upsertConversationSnapshot(records, second);
    expect(records.map((record) => record.id)).toEqual(['conv-2', 'conv-1']);

    records = renameConversation(records, 'conv-1', 'API review');
    expect(records.find((record) => record.id === 'conv-1')?.title).toBe('API review');

    records = archiveConversation(records, 'conv-2', true);
    expect(listVisibleConversations(records).map((record) => record.id)).toEqual(['conv-1']);
    expect(listVisibleConversations(records, { includeArchived: true }).map((record) => record.id)).toEqual(['conv-2', 'conv-1']);

    records = deleteConversation(records, 'conv-1');
    expect(records.map((record) => record.id)).toEqual(['conv-2']);
  });

  it('keeps the active-session history helper free of durable storage and network writes', () => {
    const helper = source('src/lib/conversation-session.ts');

    expect(helper).not.toContain('localStorage');
    expect(helper).not.toContain('sessionStorage');
    expect(helper).not.toContain('indexedDB');
    expect(helper).not.toContain('fetch(');
    expect(helper).not.toContain('.put(');
  });

  it('wires an active-session conversation list into ChatIsland without durable retention', () => {
    const island = source('src/components/ChatIsland.svelte');
    const newChat = functionBlock(island, 'newChat');

    expect(island).toContain("from '../lib/conversation-session'");
    expect(island).toContain('type ConversationSnapshot');
    expect(island).toContain('let conversationId = $state');
    expect(island).toContain('let conversationRecords = $state<ConversationSnapshot[]>');
    expect(island).toContain('let conversationHistoryOpen = $state(false)');
    expect(island).toContain('visibleConversations');
    expect(island).toContain('listVisibleConversations(conversationRecords)');
    expect(island).toContain('function saveActiveConversationSnapshot()');
    expect(island).toContain('createConversationSnapshot');
    expect(island).toContain('upsertConversationSnapshot');
    expect(island).toContain('function restoreConversation(conversation: ConversationSnapshot)');
    expect(island).toContain('id="conversation-history-panel"');
    expect(island).toContain('aria-expanded={conversationHistoryOpen}');
    expect(island).toContain('onclick={toggleConversationHistory}');
    expect(island).toContain('onclick={() => restoreConversation(conversation)}');
    expect(island).not.toContain('localStorage.setItem');
    expect(island).not.toContain('sessionStorage.setItem');

    expect(newChat).toContain('saveActiveConversationSnapshot()');
    expect(newChat.indexOf('saveActiveConversationSnapshot()')).toBeLessThan(newChat.indexOf('clearAllData(sessionId)'));
  });
});
