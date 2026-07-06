// Salvage structured data from possibly-truncated or oddly-shaped LLM JSON.
// When a model's output is cut off by the token limit — or it wraps the data
// differently than asked — the outer JSON won't parse, but the complete
// leading array items usually will. These helpers extract them so a
// deck/document still renders instead of erroring.

// Scan complete top-level {...} objects starting just after the `[` at
// bracketIdx, tolerating a missing closing `]` and an incomplete trailing
// object (which is skipped). String contents (incl. braces) are respected.
function scanObjectsFrom(text: string, bracketIdx: number): any[] {
  const out: any[] = [];
  const n = text.length;
  let i = bracketIdx + 1;

  while (i < n) {
    while (i < n && /[\s,]/.test(text[i])) i++;
    if (i >= n || text[i] === ']') break;
    if (text[i] !== '{') { i++; continue; }

    let depth = 0, inStr = false, esc = false, j = i, closed = false;
    for (; j < n; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { j++; closed = true; break; } }
    }
    if (!closed) break; // incomplete trailing object — stop

    try { out.push(JSON.parse(text.slice(i, j))); } catch { /* skip malformed */ }
    i = j;
  }
  return out;
}

// Extract complete {...} objects from a `"key": [ ... ]` array.
export function salvageObjectArray(text: string, key: string): any[] {
  const keyIdx = text.indexOf(`"${key}"`);
  if (keyIdx === -1) return [];
  const bracket = text.indexOf('[', keyIdx);
  if (bracket === -1) return [];
  return scanObjectsFrom(text, bracket);
}

// Try several known keys in order; return the first non-empty salvage.
export function salvageObjectArrayByKeys(text: string, keys: string[]): any[] {
  for (const key of keys) {
    const objs = salvageObjectArray(text, key);
    if (objs.length) return objs;
  }
  return [];
}

// Last resort: salvage from the FIRST array-of-objects anywhere in the text
// (covers a top-level array, an unknown wrapper key, or prose-wrapped JSON).
// Arrays of non-objects (e.g. a string[] tag list) yield nothing and are
// skipped, so this finds the first array that actually holds objects.
export function salvageFirstObjectArray(text: string): any[] {
  let from = 0;
  while (from < text.length) {
    const bracket = text.indexOf('[', from);
    if (bracket === -1) return [];
    const objs = scanObjectsFrom(text, bracket);
    if (objs.length) return objs;
    from = bracket + 1;
  }
  return [];
}

// Extract a `"key": "value"` string from raw text (first match).
export function salvageStringField(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = text.match(re);
  if (!m) return undefined;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}
