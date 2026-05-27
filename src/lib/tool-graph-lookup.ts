import type { GraphContext } from './graph-query';

const MAX_LOOKUP_TERM_LENGTH = 200;
const MAX_LOOKUP_CONTEXT_LENGTH = 4000;
const MAX_LOOKUP_NODES = 20;

export interface ToolGraphLookupResult {
  available: boolean;
  context: string;
  nodeCount: number;
}

export function validateLookupTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const term = value.trim();
  if (!term || term.length > MAX_LOOKUP_TERM_LENGTH) return null;
  return term;
}

export function boundLookupResult(result: GraphContext): ToolGraphLookupResult {
  return {
    available: result.available,
    context: result.context.slice(0, MAX_LOOKUP_CONTEXT_LENGTH),
    nodeCount: Math.min(result.nodeCount, MAX_LOOKUP_NODES),
  };
}
