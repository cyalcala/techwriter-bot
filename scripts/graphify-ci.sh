#!/bin/bash
set -e

echo "::group::Installing uv & Graphify"
pip install uv -q 2>/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
uv tool install graphify 2>/dev/null || true
echo "::endgroup::"

echo "::group::Building knowledge graph"
graphify . --no-viz --mode normal
echo "::endgroup::"

echo "::group::Compressing graph"
gzip -9f graphify-out/graph.json
GRAPH_SIZE=$(wc -c < graphify-out/graph.json.gz)
echo "Compressed graph size: ${GRAPH_SIZE} bytes"
echo "::endgroup::"

echo "::group::Uploading to Cloudflare KV"
if ! command -v npx &> /dev/null; then
  npm install -g wrangler 2>/dev/null || true
  npx wrangler kv key put --binding=SESSION "graph:latest" --path=graphify-out/graph.json.gz
else
  npx wrangler kv key put --binding=SESSION "graph:latest" --path=graphify-out/graph.json.gz
fi

VERSION=$(date -u +%s)
echo "$VERSION" > /tmp/graph-version.txt
npx wrangler kv key put --binding=SESSION "graph:version" --path=/tmp/graph-version.txt
echo "Graph version: $VERSION"
echo "::endgroup::"

echo "Graphify CI complete."
