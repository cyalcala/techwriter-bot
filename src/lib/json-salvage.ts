// Salvage structured data from possibly-truncated or oddly-shaped LLM JSON.
// When a model's output is cut off by the token limit — or it wraps the data
// differently than asked — the outer JSON won't parse, but the complete
// leading array items usually will. These helpers extract them so a
// deck/document still renders instead of erroring.

// Advance past one complete JSON value starting at index `i` (which must not
// be whitespace or a comma). Returns the index just after the value, or -1 if
// the value is truncated (unterminated string / unbalanced container). Used to
// step over non-object array elements — strings, nested arrays, primitives —
// without letting a stray `[` `]` `{` `}` inside them corrupt the outer scan.
function skipValue(text: string, i: number): number {
  const n = text.length;
  const c = text[i];

  if (c === '"') {
    let esc = false;
    for (let j = i + 1; j < n; j++) {
      const ch = text[j];
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') return j + 1;
    }
    return -1; // unterminated string
  }

  if (c === '{' || c === '[') {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < n; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return j + 1; }
    }
    return -1; // incomplete nested container
  }

  // primitive (number / true / false / null): read up to the next delimiter
  let j = i;
  while (j < n && !/[,\]}\s]/.test(text[j])) j++;
  return j > i ? j : -1;
}

// Scan complete top-level {...} objects starting just after the `[` at
// bracketIdx, tolerating a missing closing `]` and an incomplete trailing
// object (which is skipped). String contents (incl. braces) are respected, and
// non-object elements (leading strings, nested arrays, numbers) are skipped in
// full so a `[` or `]` inside them can't abort the scan and lose every object.
function scanObjectsFrom(text: string, bracketIdx: number): any[] {
  const out: any[] = [];
  const n = text.length;
  let i = bracketIdx + 1;

  while (i < n) {
    while (i < n && /[\s,]/.test(text[i])) i++;
    if (i >= n || text[i] === ']') break;

    if (text[i] !== '{') {
      const next = skipValue(text, i);
      if (next <= i) break; // truncated non-object value — stop
      i = next;
      continue;
    }

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
// skipped, so this finds the first array that actually holds objects. An
// optional `accept` predicate lets a caller reject an object-array that
// belongs to a different shape (e.g. a `[{x,y}]` coordinate list) and keep
// scanning for the real slides/blocks array.
export function salvageFirstObjectArray(text: string, accept?: (objs: any[]) => boolean): any[] {
  let from = 0;
  while (from < text.length) {
    const bracket = text.indexOf('[', from);
    if (bracket === -1) return [];
    const objs = scanObjectsFrom(text, bracket);
    if (objs.length && (!accept || accept(objs))) return objs;
    from = bracket + 1;
  }
  return [];
}

// Heuristic for `salvageFirstObjectArray`'s `accept`: slides and document
// blocks always carry human text (a heading, bullet, paragraph, layout name,
// etc.), whereas incidental object-arrays (chart points, coordinate pairs)
// hold only numbers. Require at least one object with a non-empty string value
// or a nested object (deck slides wrap their content in `data:{}`).
export function arrayHasTextContent(objs: any[]): boolean {
  return objs.some((o) =>
    o && typeof o === 'object' && !Array.isArray(o) &&
    Object.values(o).some((v) =>
      (typeof v === 'string' && v.trim().length > 0) ||
      (v && typeof v === 'object')
    )
  );
}

// Extract a `"key": "value"` string from raw text (first match).
export function salvageStringField(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = text.match(re);
  if (!m) return undefined;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}
