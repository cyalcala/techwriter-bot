export interface GraphNode {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
  norm_label?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  confidence_score?: number;
  context?: string;
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  hyperedges?: any[];
}

export interface GraphContext {
  context: string;
  nodeCount: number;
  tokenCount: number;
  available: boolean;
  version?: string;
  stale?: boolean;
}

let cachedData: GraphData | null = null;
let cachedVersion: string | null = null;
let loadingPromise: Promise<void> | null = null;

export function clearGraphCache(): void {
  cachedData = null;
  cachedVersion = null;
  loadingPromise = null;
}

async function decompress(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(buffer);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

export async function ensureGraph(kv: any): Promise<{ available: boolean; version?: string }> {
  if (cachedData && cachedVersion) {
    return { available: true, version: cachedVersion };
  }

  if (loadingPromise) {
    await loadingPromise;
    if (cachedData) return { available: true, version: cachedVersion! };
  }

  loadingPromise = (async () => {
    try {
      if (!kv) return;
      const version = await kv.get('graph:version');
      if (!version) return;

      const compressed = await kv.get('graph:latest', 'arrayBuffer');
      if (!compressed) return;

      const decompressed = await decompress(new Uint8Array(compressed).buffer);
      const text = new TextDecoder().decode(new Uint8Array(decompressed));
      cachedData = JSON.parse(text);
      cachedVersion = version;
    } catch {
      cachedData = null;
      cachedVersion = null;
    } finally {
      loadingPromise = null;
    }
  })();

  await loadingPromise;
  if (cachedData) return { available: true, version: cachedVersion! };
  return { available: false };
}

export function isGraphStale(kvVersion: string): boolean {
  return !cachedVersion || kvVersion !== cachedVersion;
}

function tokenizeAndScore(query: string): Map<string, number> {
  const words = query.toLowerCase().replace(/['"]/g, '').replace(/[.?]/g, ' ').split(/[\s,;:!()[\]{}<>\/\\|&@#$%^*+=~`]+/).filter(w => w.length > 1);
  const scores = new Map<string, number>();
  const stops = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'not', 'but', 'can', 'you', 'all', 'its', 'have', 'been', 'will']);
  for (const w of words) {
    if (stops.has(w) || w.length <= 1) continue;
    scores.set(w, (scores.get(w) || 0) + 1);
  }
  return scores;
}

function nodeRelevanceScore(node: GraphNode, termScores: Map<string, number>): number {
  let score = 0;
  const text = `${node.label} ${node.norm_label || ''} ${node.id}`.toLowerCase();
  for (const [term, weight] of termScores) {
    if (text.includes(term)) {
      score += weight * (term.length >= 5 ? 2 : 1);
    }
  }
  if (node.file_type === 'document' || node.file_type === 'rationale') score *= 0.5;
  return score;
}

export function queryGraph(question: string, maxTokens: number = MAX_GRAPH_TOKENS_DEFAULT): GraphContext {
  if (!cachedData) {
    return { context: '', nodeCount: 0, tokenCount: 0, available: false };
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of cachedData.nodes) nodeMap.set(n.id, n);

  const degree = new Map<string, number>();
  for (const l of cachedData.links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  const godNodes: { id: string; degree: number }[] = [];
  for (const [id, d] of degree) if (d > 1) godNodes.push({ id, degree: d });
  godNodes.sort((a, b) => b.degree - a.degree);
  const godSet = new Set(godNodes.slice(0, 15).map(g => g.id));

  const termScores = tokenizeAndScore(question);
  const scored = cachedData.nodes
    .filter(n => nodeRelevanceScore(n, termScores) > 0)
    .map(n => ({ node: n, score: nodeRelevanceScore(n, termScores) + (godSet.has(n.id) ? 3 : 0) }));
  scored.sort((a, b) => b.score - a.score);

  const relevantNodes = scored.slice(0, 12);
  if (relevantNodes.length === 0) {
    const topGods = godNodes.slice(0, 5).map(g => nodeMap.get(g.id)).filter(Boolean) as GraphNode[];
    return buildContextFromNodes(topGods, maxTokens, cachedData.nodes.length);
  }

  const selected = relevantNodes.map(r => r.node);
  const seenIds = new Set(selected.map(n => n.id));

  for (const n of selected) {
    const neighbors = cachedData.links
      .filter(l => l.source === n.id || l.target === n.id)
      .map(l => l.source === n.id ? l.target : l.source)
      .filter(nid => !seenIds.has(nid));
    for (const nid of neighbors.slice(0, 3)) {
      const neighbor = nodeMap.get(nid);
      if (neighbor) {
        selected.push(neighbor);
        seenIds.add(nid);
      }
    }
    if (selected.length >= 20) break;
  }

  return buildContextFromNodes(selected, maxTokens, cachedData.nodes.length);
}

const MAX_GRAPH_TOKENS_DEFAULT = 1200;

function buildContextFromNodes(nodes: GraphNode[], maxTokens: number, totalNodes: number): GraphContext {
  const parts: string[] = [];
  let tokenCount = 0;
  let included = 0;

  for (const node of nodes) {
    const rel = node.source_file
      ? `${node.label} (${node.file_type || 'concept'}, ${node.source_file}${node.source_location ? `:${node.source_location}` : ''})`
      : `${node.label} (${node.file_type || 'concept'})`;
    const t = Math.ceil(rel.length / 4);
    if (tokenCount + t > maxTokens) break;
    parts.push(rel);
    tokenCount += t;
    included++;
  }

  return {
    context: parts.length > 0 ? `KNOWLEDGE GRAPH CONTEXT (${included} of ${totalNodes} nodes):\n${parts.join('\n')}` : '',
    nodeCount: included,
    tokenCount,
    available: parts.length > 0,
  };
}

export function getGodNodes(topN: number = 10): GraphNode[] {
  if (!cachedData) return [];
  const nodeMap = new Map<string, GraphNode>();
  for (const n of cachedData.nodes) nodeMap.set(n.id, n);

  const degree = new Map<string, number>();
  for (const l of cachedData.links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id]) => nodeMap.get(id))
    .filter(Boolean) as GraphNode[];
}

export function getGraphStats(): { nodes: number; links: number; communities: number } | null {
  if (!cachedData) return null;
  const communities = new Set(cachedData.nodes.map(n => n.community).filter(Boolean));
  return { nodes: cachedData.nodes.length, links: cachedData.links.length, communities: communities.size };
}
