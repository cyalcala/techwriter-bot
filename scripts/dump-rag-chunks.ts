// Dumps chunks produced by the REAL TypeScript chunkDocument() from
// src/lib/rag-client.ts into a JSON artifact for the Python RAG evaluator.
// This keeps one source of truth for chunking logic (no Python reimplementation).
//
// Bundle + run (from repo root):
//   node_modules/.bin/esbuild scripts/dump-rag-chunks.ts --bundle \
//     --format=esm --platform=node --outfile=.tmp-rag-eval/dump.mjs
//   node .tmp-rag-eval/dump.mjs [output-path]
//
// Default output: output/python/rag-chunks.json

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chunkDocument } from '../src/lib/rag-client';

interface CorpusQuery {
  question: string;
  evidence_lines: [number, number][];
}

interface CorpusDocument {
  filename: string;
  text: string;
}

interface Corpus {
  name: string;
  description?: string;
  chunk_params?: { chunkSize?: number; overlap?: number; maxChunks?: number };
  documents: CorpusDocument[];
  queries: CorpusQuery[];
}

function main(): void {
  const outPath = process.argv[2] ?? 'output/python/rag-chunks.json';
  const corporaDir = resolve('python/corpora');
  const files = readdirSync(corporaDir).filter((f) => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.error(`No corpus JSON files found in ${corporaDir}`);
    process.exit(1);
  }

  const corpora = files.map((file) => {
    const corpus = JSON.parse(readFileSync(resolve(corporaDir, file), 'utf8')) as Corpus;

    const params = corpus.chunk_params ?? {};
    const documents = corpus.documents.map((doc) => {
      const { chunks, truncated } = chunkDocument(
        doc.text,
        doc.filename,
        params.chunkSize,
        params.overlap,
        params.maxChunks,
      );
      return {
        filename: doc.filename,
        source_text: doc.text,
        chunks,
        truncated,
        chunk_count: chunks.length,
      };
    });

    return {
      name: corpus.name,
      source_file: `python/corpora/${file}`,
      params: {
        chunkSize: params.chunkSize ?? 700,
        overlap: params.overlap ?? 120,
        maxChunks: params.maxChunks ?? 500,
      },
      documents,
      queries: corpus.queries,
    };
  });

  const dump = {
    tool: 'dump-rag-chunks',
    chunker: 'src/lib/rag-client.ts#chunkDocument',
    generated_at: new Date().toISOString(),
    corpora,
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(dump, null, 2)}\n`);

  for (const c of corpora) {
    const counts = c.documents.map((d) => d.chunk_count).join('/');
    console.log(`${c.name}: ${counts} chunk(s), truncated=${c.documents.map((d) => d.truncated).join('/')}`);
  }
  console.log(`Wrote ${resolve(outPath)}`);
}

main();
