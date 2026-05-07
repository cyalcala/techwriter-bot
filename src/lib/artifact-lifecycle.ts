import type { Artifact, ArtifactType } from './stream-parser';

export type ArtifactStatus = 'generating' | 'ready' | 'updating';

export function generateArtifactId(type: ArtifactType, code: string): string {
  const hash = simpleHash(type + code.slice(0, 200));
  return `${type}-${hash}`;
}

export function extractArtifactTitle(code: string, type: ArtifactType): string {
  if (type === 'mermaid') {
    const m = code.match(/\b(title\s*:?\s*)(.+)/i);
    if (m) return m[2].replace(/["']/g, '').trim().slice(0, 60);
    const dir = code.match(/\b(graph|sequenceDiagram|classDiagram|stateDiagram|flowchart|gantt|pie|gitgraph)\s+(\w+)?/i);
    if (dir) return `${dir[1]} ${dir[2] || ''}`.trim();
  }
  if (type === 'graphviz') {
    const m = code.match(/\b(digraph|graph)\s+(\w+)/i);
    if (m) return m[2];
  }
  if (type === 'd2') {
    const m = code.match(/\b(title\s*:\s*)(.+)/i);
    if (m) return m[1] + m[2].trim();
  }
  if (type === 'plantuml') {
    const m = code.match(/\btitle\s+(.+)/i);
    if (m) return m[1].trim().slice(0, 60);
  }
  if (type === 'code') {
    const m = code.match(/\b(?:function|class|const|def)\s+(\w+)/);
    if (m) return m[1];
  }
  return `${type.charAt(0).toUpperCase() + type.slice(1)} Diagram`;
}

export function isArtifactUpdate(existing: Artifact, newArtifact: Artifact): boolean {
  return existing.type === newArtifact.type && existing.id === generateArtifactId(newArtifact.type, newArtifact.code);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
