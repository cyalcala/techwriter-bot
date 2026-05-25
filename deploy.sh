#!/usr/bin/env bash
set -euo pipefail

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ".env"
  set +a
fi

PROJECT_NAME="${PROJECT_NAME:-tw-bot}"
APP_VERSION="${APP_VERSION:-0.0.1}"
BRANCH_NAME="${BRANCH_NAME:-main}"
KV_NAMESPACE_NAME="${KV_NAMESPACE_NAME:-${PROJECT_NAME}-session}"

normalize_prefix() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/^(.{48}).*$/\1/'
}

PROJECT_PREFIX="$(normalize_prefix "$PROJECT_NAME")"

echo "Deploying ${PROJECT_NAME}"
echo "Project prefix: ${PROJECT_PREFIX}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

echo "Creating or updating KV namespace binding SESSION..."
npx wrangler kv namespace create "$KV_NAMESPACE_NAME" --binding SESSION --update-config --use-remote || true

echo "Validating configured provider API keys..."
node --input-type=module <<'NODE'
const providers = [
  {
    id: 'groq-fast',
    name: 'groq',
    key: 'GROQ_API_KEY',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'cerebras-llama',
    name: 'cerebras',
    key: 'CEREBRAS_API_KEY',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama-3.1-8b',
  },
  {
    id: 'gemini-flash',
    name: 'gemini',
    key: 'GEMINI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.0-flash',
  },
  {
    id: 'nvidia-fast',
    name: 'nvidia',
    key: 'NVIDIA_API_KEY',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'meta/llama-3.1-8b-instruct',
  },
  {
    id: 'openrouter-fast',
    name: 'openrouter',
    key: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct',
  },
];

let configured = 0;
let failed = 0;

for (const provider of providers) {
  const apiKey = process.env[provider.key]?.trim();
  if (!apiKey) {
    console.log(`skip ${provider.id}: ${provider.key} not set`);
    continue;
  }

  configured++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HEALTH_PING_TIMEOUT_MS || 5000));

  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      failed++;
      console.error(`fail ${provider.id}: HTTP ${response.status}`);
    } else {
      console.log(`ok ${provider.id}`);
    }
  } catch (error) {
    failed++;
    console.error(`fail ${provider.id}: ${String(error?.message || error).slice(0, 120)}`);
  } finally {
    clearTimeout(timeout);
  }
}

console.log('skip cloudflare-llama: validated by Cloudflare AI binding at runtime');

if (configured === 0) {
  console.error('No external provider API keys are configured. Set at least one provider key before deploy.');
  process.exit(1);
}

if (failed > 0) {
  console.error(`${failed} configured provider key(s) failed validation.`);
  process.exit(1);
}
NODE

echo "Writing APP_VERSION to KV..."
npx wrangler kv key put "${PROJECT_PREFIX}:app:version" "$APP_VERSION" --binding SESSION --remote

echo "Building Astro app..."
if npm run | grep -q "build:local"; then
  npm run build:local
else
  npm run build
fi

echo "Preparing Cloudflare Pages worker bundle..."
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.join(process.cwd(), 'dist');
const clientDir = path.join(distDir, 'client');
const serverDir = path.join(distDir, 'server');

if (!fs.existsSync(clientDir) || !fs.existsSync(serverDir)) {
  throw new Error('Expected dist/client and dist/server after build.');
}

const serverFiles = fs.readdirSync(serverDir);
const workerEntry = serverFiles.find(file => file.startsWith('worker-entry') && file.endsWith('.mjs'));
const legacyEntry = path.join(serverDir, 'entry.mjs');
const workerSource = workerEntry ? path.join(serverDir, workerEntry) : legacyEntry;

if (!fs.existsSync(workerSource)) {
  throw new Error('No worker-entry*.mjs or entry.mjs found in dist/server.');
}

fs.copyFileSync(workerSource, path.join(clientDir, '_worker.js'));

const serverChunks = path.join(serverDir, 'chunks');
const clientChunks = path.join(clientDir, 'chunks');
if (fs.existsSync(serverChunks)) {
  fs.mkdirSync(clientChunks, { recursive: true });
  fs.cpSync(serverChunks, clientChunks, { recursive: true });
}

const middleware = path.join(serverDir, 'virtual_astro_middleware.mjs');
if (fs.existsSync(middleware)) {
  fs.copyFileSync(middleware, path.join(clientDir, 'virtual_astro_middleware.mjs'));
}

const assetsIgnore = path.join(clientDir, '.assetsignore');
if (fs.existsSync(assetsIgnore)) fs.unlinkSync(assetsIgnore);
NODE

echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist/client --project-name "$PROJECT_NAME" --branch "$BRANCH_NAME" --commit-dirty=true

echo "Deployment requested."
echo "Expected URL: https://${PROJECT_NAME}.pages.dev"
