#!/bin/bash
set -e

echo "::group::Installing Graphify (Python package)"
pip install graphifyy -q 2>/dev/null || uv pip install graphifyy
echo "::endgroup::"

echo "::group::Running extraction pipeline"
python3 -c "
from pathlib import Path
import json, sys

print('Collecting files...')
from graphify.detect import collect_files, detect
corpus = detect(Path('.'))

from graphify.extract import extract
print(f'Extracting AST from {len(corpus.files)} files...')
extractions = extract(corpus, workers=None)

from graphify.build import build_from_json
print('Building graph...')
graph = build_from_json(extractions)

from graphify.cluster import cluster
print('Clustering communities...')
cluster(graph)

print(f'Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges')

import networkx as nx
data = nx.node_link_data(graph)
Path('graphify-out').mkdir(parents=True, exist_ok=True)
with open('graphify-out/graph.json', 'w') as f:
    json.dump(data, f, indent=2)
print(f'graph.json written ({Path(\"graphify-out/graph.json\").stat().st_size} bytes)')
" 2>&1 || echo "Graph extraction failed — continuing without graph"
echo "::endgroup::"

if [ -f graphify-out/graph.json ]; then
  echo "::group::Compressing and uploading graph"
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
