export function normalizeProjectName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function kvKey(env: Record<string, unknown>, key: string): string {
  const prefix = normalizeProjectName(env.PROJECT_NAME);
  if (!prefix) return key;
  if (key === prefix || key.startsWith(`${prefix}:`)) return key;
  return `${prefix}:${key}`;
}
