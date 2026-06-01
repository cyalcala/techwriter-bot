import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArtifactEntry } from '../lib/artifact-queue';
import { createChatMarkdownExport, chatMarkdownExportFilename } from '../lib/chat-markdown-export';

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
    code: 'graph TD\nA-->B\n```',
  },
};

describe('active-session Markdown chat export', () => {
  it('creates readable Markdown with message timestamps, citations, sources, and sanitized metadata', () => {
    const markdown = createChatMarkdownExport({
      personaName: 'Docs Copilot',
      now: new Date('2026-06-02T01:02:03.000Z'),
      chatPath: 'balanced',
      messages: [
        {
          role: 'user',
          content: 'Review this doc [Doc: api.md, line 4]',
          createdAt: '2026-06-02T01:00:00.000Z',
        },
        {
          role: 'assistant',
          content: 'Looks clear. [Doc: api.md, line 4]',
          createdAt: '2026-06-02T01:00:05.000Z',
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

    expect(markdown).toContain('# Technical Writer Chat Export');
    expect(markdown).toContain('Exported: 2026-06-02T01:02:03.000Z');
    expect(markdown).toContain('Persona: Docs Copilot');
    expect(markdown).toContain('Chat path: balanced');
    expect(markdown).toContain('- api.md (3 chunks)');
    expect(markdown).toContain('### 1. User');
    expect(markdown).toContain('Time: 2026-06-02T01:00:00.000Z');
    expect(markdown).toContain('Review this doc [Doc: api.md, line 4]');
    expect(markdown).toContain('### 2. Assistant');
    expect(markdown).toContain('Time: 2026-06-02T01:00:05.000Z');
    expect(markdown).toContain('Provider: groq-fast');
    expect(markdown).toContain('Search tier: basic');
    expect(markdown).toContain('Sources:\n- [API Guide](https://example.com/api)');
    expect(markdown).toContain('### Flow');
    expect(markdown).toContain('Message: 2');
    expect(markdown).toContain('````mermaid\ngraph TD\nA-->B\n```\n````');
    expect(markdown).not.toContain('private source text');
    expect(markdown).not.toContain('private chunk text');
    expect(markdown).not.toContain('vector');
  });

  it('creates stable readable Markdown filenames', () => {
    expect(chatMarkdownExportFilename(new Date('2026-06-02T01:02:03.000Z'))).toBe(
      'techwriter-chat-2026-06-02T01-02-03.md',
    );
  });

  it('keeps the Markdown export helper free of durable storage and network writes', () => {
    const helper = source('src/lib/chat-markdown-export.ts');

    expect(helper).not.toContain('localStorage');
    expect(helper).not.toContain('sessionStorage');
    expect(helper).not.toContain('indexedDB');
    expect(helper).not.toContain('.put(');
    expect(helper).not.toContain('fetch(');
  });

  it('wires a user-invoked Markdown download into ChatIsland without durable retention', () => {
    const island = source('src/components/ChatIsland.svelte');
    const exportMarkdown = functionBlock(island, 'exportMarkdown');

    expect(island).toContain("from '../lib/chat-markdown-export'");
    expect(island).toContain('function createChatMessage(');
    expect(island).toContain('createdAt: new Date().toISOString()');
    expect(island).toContain('createChatMarkdownExport');
    expect(island).toContain('chatMarkdownExportFilename');
    expect(island).toContain('function exportMarkdown()');
    expect(island).toContain('onclick={exportMarkdown}');
    expect(island).toContain('title="Export chat as Markdown"');
    expect(island).toContain('text/markdown;charset=utf-8');
    expect(exportMarkdown).toContain('messages');
    expect(exportMarkdown).toContain('artifactQueue.entries');
    expect(exportMarkdown).toContain('rag.documents');
    expect(exportMarkdown).toContain('visiblePersonaName');
    expect(exportMarkdown).not.toContain('localStorage');
    expect(exportMarkdown).not.toContain('sessionStorage');
  });
});
