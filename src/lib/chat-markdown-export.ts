import type { ArtifactEntry } from './artifact-queue';
import type { UploadedDocumentRecord } from './rag-client';
import { createSessionExport, type SessionExportMessage } from './session-transfer';

interface CreateChatMarkdownExportInput {
  personaName?: string;
  messages: SessionExportMessage[];
  artifacts: ArtifactEntry[];
  documents: UploadedDocumentRecord[];
  chatPath?: string | null;
  now?: Date;
}

interface CreateSingleMessageMarkdownExportInput {
  index: number;
  message: SessionExportMessage;
  now?: Date;
}

export function createChatMarkdownExport(input: CreateChatMarkdownExportInput): string {
  const payload = createSessionExport(input);
  const lines: string[] = [
    '# Technical Writer Chat Export',
    '',
    `Exported: ${payload.exportedAt}`,
  ];
  const personaName = cleanInline(input.personaName);
  if (personaName) lines.push(`Persona: ${personaName}`);
  if (payload.chatPath) lines.push(`Chat path: ${payload.chatPath}`);

  lines.push('', '## Documents');
  if (payload.documents.length === 0) {
    lines.push('', '_No uploaded document metadata in this export._');
  } else {
    lines.push('');
    for (const document of payload.documents) {
      const chunks = document.chunkCount === 1 ? '1 chunk' : `${document.chunkCount} chunks`;
      lines.push(`- ${cleanInline(document.filename) || 'Untitled document'} (${chunks})`);
    }
  }

  lines.push('', '## Conversation');
  if (payload.messages.length === 0) {
    lines.push('', '_No messages in this active session._');
  } else {
    payload.messages.forEach((message, index) => {
      lines.push('', `### ${index + 1}. ${roleLabel(message.role)}`);
      lines.push('', `Time: ${message.createdAt || `${payload.exportedAt} (export time fallback)`}`);
      if (message.provider) lines.push(`Provider: ${cleanInline(message.provider)}`);
      if (message.searchTier && message.searchTier !== 'none') lines.push(`Search tier: ${message.searchTier}`);
      lines.push('', message.content || '_No message content._');
      if (message.sources && message.sources.length > 0) {
        lines.push('', 'Sources:');
        for (const source of message.sources) {
          lines.push(`- [${escapeLinkText(source.title)}](${source.url})`);
        }
      }
    });
  }

  lines.push('', '## Artifacts');
  if (payload.artifacts.length === 0) {
    lines.push('', '_No artifacts in this export._');
  } else {
    for (const entry of payload.artifacts) {
      const title = cleanInline(entry.artifact.title) || 'Artifact';
      const language = cleanInline(entry.artifact.language) || entry.artifact.type;
      const fence = codeFence(entry.artifact.code);
      lines.push('', `### ${title}`);
      lines.push('', `Type: ${entry.artifact.type}`);
      lines.push(`Message: ${entry.messageIdx + 1}`);
      if (entry.status) lines.push(`Status: ${entry.status}`);
      if (entry.error) lines.push(`Error: ${cleanInline(entry.error)}`);
      lines.push('', `${fence}${language}`, entry.artifact.code, fence);
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function chatMarkdownExportFilename(date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  return `techwriter-chat-${stamp}.md`;
}

export function createSingleMessageMarkdownExport(input: CreateSingleMessageMarkdownExportInput): string {
  const payload = createSessionExport({
    messages: [input.message],
    artifacts: [],
    documents: [],
    now: input.now,
  });
  const message = payload.messages[0];
  const lines: string[] = [
    '# Assistant Response Export',
    '',
    `Exported: ${payload.exportedAt}`,
    `Message: ${input.index + 1}`,
  ];

  if (!message) {
    lines.push('', '_No response content._');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  lines.push(`Time: ${message.createdAt || `${payload.exportedAt} (export time fallback)`}`);
  if (message.provider) lines.push(`Provider: ${cleanInline(message.provider)}`);
  if (message.searchTier && message.searchTier !== 'none') lines.push(`Search tier: ${message.searchTier}`);
  lines.push('', cleanResponseMarkdown(message.content) || '_No response content._');

  if (message.sources && message.sources.length > 0) {
    lines.push('', 'Sources:');
    for (const source of message.sources) {
      lines.push(`- [${escapeLinkText(source.title)}](${source.url})`);
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function singleMessageMarkdownExportFilename(messageNumber: number, date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  const safeNumber = Number.isFinite(messageNumber) && messageNumber > 0 ? Math.floor(messageNumber) : 1;
  return `techwriter-response-${safeNumber}-${stamp}.md`;
}

function roleLabel(role: SessionExportMessage['role']): string {
  if (role === 'user') return 'User';
  if (role === 'assistant') return 'Assistant';
  return 'System';
}

function cleanInline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanResponseMarkdown(value: string): string {
  return value
    .replace(/\bPlease note that\s+(my|our)\s+(knowledge|training|information).*?(?=\n{2,}|$)/gis, '')
    .replace(/\b(my|our)\s+(training data|knowledge)\s+(only goes|ended|cutoff).*?(20\d{2}|20\d{2}\.)/gi, '')
    .replace(/\[Pre-2023 knowledge\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeLinkText(value: string): string {
  return cleanInline(value).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function codeFence(code: string): string {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}
