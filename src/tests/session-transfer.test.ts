import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArtifactEntry } from '../lib/artifact-queue';
import {
  SESSION_EXPORT_VERSION,
  createSessionExport,
  parseSessionImport,
  sessionExportFilename,
} from '../lib/session-transfer';

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
  messageIdx: 1,
  ts: 1234,
  status: 'ready',
  artifact: {
    id: 'flow',
    type: 'mermaid',
    title: 'Flow',
    placement: 'inline',
    code: 'graph TD\nA-->B',
  },
};

describe('explicit session transfer', () => {
  it('exports messages, artifacts, and document metadata without source text', () => {
    const payload = createSessionExport({
      now: new Date('2026-05-31T10:11:12.000Z'),
      chatPath: 'heavy',
      messages: [
        { role: 'user', content: 'Review this doc', provider: 'ignored-extra' },
        {
          role: 'assistant',
          content: 'Looks clear. [Doc: api.md, line 4]',
          provider: 'groq-fast',
          sources: [{ title: 'API Guide', url: 'https://example.com/api' }],
          searchTier: 'basic',
          liveResponse: true,
        },
      ],
      artifacts: [artifact],
      documents: [
        {
          id: 'doc-api',
          filename: 'api.md',
          chunkCount: 3,
          sourceText: 'private source text',
          text: 'private chunk text',
          vector: [1, 2, 3],
        } as any,
      ],
    });

    expect(payload.version).toBe(SESSION_EXPORT_VERSION);
    expect(payload.exportedAt).toBe('2026-05-31T10:11:12.000Z');
    expect(payload.messages).toHaveLength(2);
    expect(payload.artifacts).toEqual([artifact]);
    expect(payload.documents).toEqual([{ id: 'doc-api', filename: 'api.md', chunkCount: 3 }]);
    expect(JSON.stringify(payload)).not.toContain('private source text');
    expect(JSON.stringify(payload)).not.toContain('private chunk text');
    expect(JSON.stringify(payload)).not.toContain('vector');
  });

  it('round-trips a valid JSON backup and rejects invalid imports', () => {
    const payload = createSessionExport({
      now: new Date('2026-05-31T10:11:12.000Z'),
      messages: [{ role: 'user', content: 'Draft release notes' }],
      artifacts: [artifact],
      documents: [{ id: 'doc-api', filename: 'api.md', chunkCount: 3 }],
    });

    const parsed = parseSessionImport(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload).toEqual(payload);
    }

    expect(parseSessionImport('{bad json').ok).toBe(false);
    expect(parseSessionImport(JSON.stringify({ ...payload, version: 999 })).ok).toBe(false);
    expect(parseSessionImport(JSON.stringify({ ...payload, messages: [] })).ok).toBe(false);
  });

  it('creates stable readable export filenames', () => {
    expect(sessionExportFilename(new Date('2026-05-31T10:11:12.000Z'))).toBe(
      'techwriter-session-2026-05-31T10-11-12.json',
    );
  });

  it('keeps the transfer helper free of automatic durable storage', () => {
    const helper = source('src/lib/session-transfer.ts');

    expect(helper).not.toContain('localStorage');
    expect(helper).not.toContain('sessionStorage');
    expect(helper).not.toContain('indexedDB');
    expect(helper).not.toContain('.put(');
    expect(helper).not.toContain('fetch(');
  });

  it('keeps fresh conversations isolated from prior active-session state', () => {
    const island = source('src/components/ChatIsland.svelte');
    const newChat = functionBlock(island, 'newChat');
    const clearChat = functionBlock(island, 'clearChat');

    for (const block of [newChat, clearChat]) {
      expect(block).toContain('safeAbort()');
      expect(block).toContain('clearConversation()');
      expect(block).toContain('clearAllData(sessionId)');
      expect(block).toContain('rag = clearRagState()');
      expect(block).toContain('documentSources = {}');
      expect(block).toContain('clearDocumentToolState()');
      expect(block).toContain('artifactQueue.clear()');
      expect(block).toContain('activeArtifactEntry = null');
      expect(block).toContain('pendingArtifactRepair = null');
      expect(block).toContain('liveOutage = null');
    }

    expect(newChat.indexOf('clearAllData(sessionId)')).toBeLessThan(newChat.indexOf('sessionId = generateSessionId()'));
  });

  it('wires explicit user-invoked import/export controls without local persistence', () => {
    const island = source('src/components/ChatIsland.svelte');
    const importHandler = functionBlock(island, 'onSessionImportSelected');

    expect(island).toContain('createSessionExport');
    expect(island).toContain('parseSessionImport');
    expect(island).toContain('function exportSession()');
    expect(island).toContain('function onSessionImportSelected');
    expect(island).toContain('bind:this={sessionImportInput}');
    expect(island).toContain('accept=".json,application/json"');
    expect(island).toContain('onclick={exportSession}');
    expect(island).toContain('onclick={() => sessionImportInput.click()}');
    expect(island).not.toContain('localStorage.setItem');

    expect(importHandler).toContain('safeAbort()');
    expect(importHandler).toContain('clearConversation()');
    expect(importHandler).toContain('clearAllData(sessionId)');
    expect(importHandler).toContain('sessionId = generateSessionId()');
    expect(importHandler).toContain('documentSources = {}');
    expect(importHandler).toContain('clearDocumentToolState()');
    expect(importHandler).toContain('artifactQueue.clear()');
  });

  it('shows a metadata-only restore note for imported or restored document records', () => {
    const input = source('src/components/ChatInput.svelte');
    const island = source('src/components/ChatIsland.svelte');
    const importHandler = functionBlock(island, 'onSessionImportSelected');
    const restoreHandler = functionBlock(island, 'restoreConversation');
    const processUpload = functionBlock(island, 'processFileUpload');

    expect(input).toContain('ragMetadataOnly?: boolean');
    expect(input).toContain('ragMetadataOnly = false');
    expect(input).toContain('Document metadata only');
    expect(input).toContain('Upload the source file again');
    expect(island).toContain('let ragMetadataOnly = $state(false)');
    expect(island).toContain('{ragMetadataOnly}');
    expect(importHandler).toContain('ragMetadataOnly = parsed.payload.documents.length > 0');
    expect(restoreHandler).toContain('ragMetadataOnly = conversation.documents.length > 0');
    expect(processUpload).toContain('ragMetadataOnly = false');
  });
});
