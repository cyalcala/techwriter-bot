// Salvage structured data from possibly-truncated LLM JSON. When a model's
// output is cut off by the token limit, the outer JSON won't parse — but the
// complete leading array items usually will. These helpers extract them so a
// deck/document still renders instead of erroring.

// Extract complete top-level {...} objects from a `"key": [ ... ]` array,
// tolerating a missing closing bracket and an incomplete trailing object.
export function salvageObjectArray(text: string, key: string): any[] {
  const keyIdx = text.indexOf(`"${key}"`);
  if (keyIdx === -1) return [];
  const bracket = text.indexOf('[', keyIdx);
  if (bracket === -1) return [];

  const out: any[] = [];
  const n = text.length;
  let i = bracket + 1;

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

// Extract a `"key": "value"` string from raw text (first match).
export function salvageStringField(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = text.match(re);
  if (!m) return undefined;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}
