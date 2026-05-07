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
  communitySummaries?: Record<string, string>;
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
      const raw = JSON.parse(text);
      cachedData = {
        nodes: raw.nodes || [],
        links: raw.links || [],
        hyperedges: raw.hyperedges,
        communitySummaries: raw.graph?.community_summaries || raw.community_summaries || raw.communitySummaries,
      };
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

const MAX_GRAPH_TOKENS_DEFAULT = 1200;

export function queryGraph(question: string, maxTokens: number = MAX_GRAPH_TOKENS_DEFAULT): GraphContext {
  if (!cachedData) {
    return { context: '', nodeCount: 0, tokenCount: 0, available: false };
  }

  const words = question.trim().split(/\s+/).filter(w => w.length > 1);
  if (words.length < 5) {
    const topGods = getGodNodes(5);
    return buildCommunityContext(topGods, maxTokens, cachedData.communitySummaries);
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of cachedData.nodes) nodeMap.set(n.id, n);

  const labelIndex = new Map<string, string[]>();
  for (const n of cachedData.nodes) {
    const lower = n.label.toLowerCase();
    if (!labelIndex.has(lower)) labelIndex.set(lower, []);
    labelIndex.get(lower)!.push(n.id);
    const stripped = n.label.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (stripped !== lower) {
      if (!labelIndex.has(stripped)) labelIndex.set(stripped, []);
      labelIndex.get(stripped)!.push(n.id);
    }
  }

  const directHits = new Set<string>();
  const identifiers = question.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]*|[a-z]+[A-Z][a-zA-Z]*)\b/g) || [];
  const underscoreIds = question.match(/\b([a-z]+_[a-z_]+)\b/gi) || [];
  const quoted = question.match(/[""]([^""]+)[""]/g) || [];
  const allNames = [...identifiers, ...underscoreIds, ...quoted.map(q => q.replace(/[""]/g, '')), question];

  for (const name of allNames) {
    const exact = name.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (exact.length < 3) continue;
    const hits = labelIndex.get(exact);
    if (hits) for (const id of hits) directHits.add(id);
    if (!hits) {
      for (const [label, ids] of labelIndex) {
        if (label.includes(exact) || exact.includes(label)) {
          for (const id of ids) directHits.add(id);
        }
      }
    }
  }

  const degree = new Map<string, number>();
  for (const l of cachedData.links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  const godNodes: { id: string; degree: number }[] = [];
  for (const [id, d] of degree) if (d > 1) godNodes.push({ id, degree: d });
  godNodes.sort((a, b) => b.degree - a.degree);
  const godSet = new Set(godNodes.slice(0, 15).map(g => g.id));

  const communitySummaries = cachedData.communitySummaries;
  let allowedCommunities: Set<number> | null = null;

  if (communitySummaries && Object.keys(communitySummaries).length > 0 && words.length >= 3) {
    allowedCommunities = new Set();
    const queryLower = question.toLowerCase();
    const queryTerms = words.map(w => w.toLowerCase());
    const nodeCommIndex = new Map<string, number>();
    for (const n of cachedData.nodes) {
      if (n.community != null) nodeCommIndex.set(n.id, n.community);
    }

    for (const [commStr, summary] of Object.entries(communitySummaries)) {
      const summaryLower = summary.toLowerCase();
      let matches = queryTerms.some(t => summaryLower.includes(t));
      if (!matches) {
        const commNum = parseInt(commStr);
        const commNodes = cachedData.nodes.filter(n => n.community === commNum);
        matches = commNodes.some(n => queryTerms.some(t => n.label.toLowerCase().includes(t) || n.norm_label?.toLowerCase().includes(t)));
      }
      if (matches) allowedCommunities!.add(parseInt(commStr));
    }
  }

  const termScores = tokenizeAndScore(question);
  const scored = cachedData.nodes
    .filter(n => {
      if (!allowedCommunities) return directHits.has(n.id) || nodeRelevanceScore(n, termScores) > 0;
      return n.community != null && allowedCommunities.has(n.community) && (directHits.has(n.id) || nodeRelevanceScore(n, termScores) > 0);
    })
    .map(n => ({ node: n, score: (directHits.has(n.id) ? 10 : 0) + nodeRelevanceScore(n, termScores) + (godSet.has(n.id) ? 3 : 0) }));
  scored.sort((a, b) => b.score - a.score);

  const relevantNodes = scored.slice(0, 12);
  if (relevantNodes.length === 0) {
    const topGods = godNodes.slice(0, 5).map(g => nodeMap.get(g.id)).filter(Boolean) as GraphNode[];
    return buildCommunityContext(topGods, maxTokens, communitySummaries);
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

  return communitySummaries && Object.keys(communitySummaries).length > 0
    ? buildCommunityContext(selected, maxTokens, communitySummaries)
    : buildContextFromNodes(selected, maxTokens, cachedData.nodes.length);
}

function buildCommunityContext(nodes: GraphNode[], maxTokens: number, communitySummaries?: Record<string, string>): GraphContext {
  if (!communitySummaries || Object.keys(communitySummaries).length === 0) {
    return buildContextFromNodes(nodes, maxTokens, nodes.length);
  }

  const commGroups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const comm = n.community ?? -1;
    if (!commGroups.has(comm)) commGroups.set(comm, []);
    commGroups.get(comm)!.push(n);
  }

  const parts: string[] = [];
  let tokenCount = 0;
  let included = 0;

  for (const [comm, commNodes] of commGroups) {
    const summary = communitySummaries[String(comm)];
    if (summary) {
      const t = Math.ceil(summary.length / 4);
      if (tokenCount + t > maxTokens) break;
      parts.push(summary);
      tokenCount += t;
      included += commNodes.length;
    } else {
      for (const node of commNodes) {
        const rel = node.source_file
          ? `${node.label} (${node.file_type || 'concept'}, ${node.source_file}${node.source_location ? `:${node.source_location}` : ''})`
          : `${node.label} (${node.file_type || 'concept'})`;
        const t = Math.ceil(rel.length / 4);
        if (tokenCount + t > maxTokens) break;
        parts.push(rel);
        tokenCount += t;
        included++;
      }
    }
  }

  return {
    context: parts.length > 0 ? `CODEBASE CONTEXT (${included} nodes across ${commGroups.size} components):\n${parts.join('\n')}` : '',
    nodeCount: included,
    tokenCount,
    available: parts.length > 0,
  };
}

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
