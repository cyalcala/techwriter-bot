#!/bin/bash
set -e

echo "::group::Installing Graphify"
pip install graphifyy -q 2>/dev/null || uv pip install graphifyy
echo "::endgroup::"

echo "::group::Running extraction pipeline"
python3 -c "
from pathlib import Path
import json, sys

root = Path('.')

print('Detecting files...')
from graphify.detect import detect
detection = detect(root)
files = detection.get('files', {})
code_files = files.get('code', [])
doc_files = files.get('document', [])
total_words = detection.get('total_words', 0)
total_files = detection.get('total_files', 0)
all_files = [Path(f) for f in (code_files + doc_files)]
print(f'Found {total_files} files (~{total_words:,} words)')

if len(all_files) == 0:
    print('No code/doc files found — skipping')
    sys.exit(0)

print(f'Extracting AST from {len(all_files)} files...')
from graphify.extract import extract as extract_fn
results = extract_fn(root, workers=None)

print('Building graph...')
from graphify import build_from_json
graph = build_from_json(results)

print('Clustering communities...')
try:
    from graphify import cluster
    cluster(graph)
except Exception as e:
    print(f'Clustering skipped: {e}')

print(f'Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges')

import networkx as nx
data = nx.node_link_data(graph)
Path('graphify-out').mkdir(parents=True, exist_ok=True)
with open('graphify-out/graph.json', 'w') as f:
    json.dump(data, f, indent=2)
print(f'graph.json written')
" 2>&1 || echo "Graph extraction failed — continuing without graph"
echo "::endgroup::"

if [ -f graphify-out/graph.json ]; then
  echo "::group::Compressing and uploading"
  gzip -9f graphify-out/graph.json
  GRAPH_SIZE=$(wc -c < graphify-out/graph.json.gz)
  echo "Compressed: ${GRAPH_SIZE} bytes"

  npm install -g wrangler 2>/dev/null || true
  npx wrangler kv key put --binding=SESSION "graph:latest" --path=graphify-out/graph.json.gz
  echo "$(date -u +%s)" > /tmp/gv.txt
  npx wrangler kv key put --binding=SESSION "graph:version" --path=/tmp/gv.txt
  echo "Uploaded to KV"
  echo "::endgroup::"
else
  echo "No graph produced — skipping KV upload"
fi
