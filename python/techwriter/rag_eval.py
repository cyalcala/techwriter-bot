"""Offline RAG chunk/retrieval evaluation.

Evaluates chunks produced by the real TypeScript chunker
(src/lib/rag-client.ts#chunkDocument, dumped via scripts/dump-rag-chunks.ts)
against labeled corpora.

What this measures honestly:
- Chunk contract integrity: citation metadata (startLine/endLine/heading) must
  match the source text exactly, because the product cites [Doc: file, line n].
- Lexical retrieval quality (TF-IDF cosine): Recall@3 / MRR / hit-rate at k=3,
  matching the product's top-k=3 setting. This is a STRUCTURAL PROXY, not an
  embedding-quality measurement: it catches catastrophic chunking regressions
  (split topics, lost evidence, truncation), not semantic similarity drift.
  The product uses bge-small-en-v1.5 embeddings; TF-IDF numbers are a floor,
  not a substitute.

Exit code is non-zero when the contract fails or metrics fall below floors,
making this CI-ready (Lane B artifact gate).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

TOKEN_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = frozenset(
    """a an and are as at be by for from has have how i in is it its of on or
    that the to was what when where which who will with do does""".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def line_for_offset(text: str, offset: int) -> int:
    if offset <= 0:
        return 1
    return text.count("\n", 0, min(offset, len(text))) + 1


# ---------------------------------------------------------------- contract


@dataclass
class ContractResult:
    passed: bool
    failures: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.failures.append(message)


def check_chunk_contract(document: dict) -> ContractResult:
    """Validate citation metadata against the source text.

    The TypeScript chunker produces pure slices of the source and records
    startLine/endLine via the same offset->line rule as lineForOffset().
    We verify every claimed line pair is reproducible from at least one
    occurrence of the chunk text in the source (occurrence-based because
    duplicate paragraphs make offsets ambiguous).
    """
    result = ContractResult(passed=True)
    source = document["source_text"]
    chunks = document["chunks"]

    if document.get("chunk_count") != len(chunks):
        result.fail(
            f"{document['filename']}: chunk_count {document.get('chunk_count')}"
            f" != actual {len(chunks)}"
        )

    truncated = bool(document.get("truncated"))
    max_chunks_seen = False

    previous_start = -1
    for index, chunk in enumerate(chunks):
        label = f"{document['filename']}#chunk[{index}]"

        text = chunk.get("text")
        if not isinstance(text, str) or not text.strip():
            result.fail(f"{label}: text must be a non-empty string")
            continue

        start_line = chunk.get("startLine")
        end_line = chunk.get("endLine")
        if (
            not isinstance(start_line, int)
            or not isinstance(end_line, int)
            or isinstance(start_line, bool)
            or isinstance(end_line, bool)
            or start_line < 1
            or end_line < start_line
        ):
            result.fail(f"{label}: invalid startLine/endLine ({start_line!r}, {end_line!r})")
            continue

        if start_line < previous_start:
            result.fail(f"{label}: startLine {start_line} goes backwards (< {previous_start})")
        previous_start = start_line

        if start_line > len(source.splitlines()):
            result.fail(f"{label}: startLine {start_line} beyond end of document")
            continue

        # Reproduce the claimed lines from at least one occurrence position.
        occurrence_found = False
        search_from = 0
        while True:
            pos = source.find(text, search_from)
            if pos == -1:
                break
            if (
                line_for_offset(source, pos) == start_line
                and line_for_offset(source, pos + len(text) - 1) == end_line
            ):
                occurrence_found = True
                break
            search_from = pos + 1
        if not occurrence_found:
            result.fail(
                f"{label}: no occurrence of chunk text reproduces lines"
                f" {start_line}-{end_line}"
            )

        heading = chunk.get("heading")
        if heading is not None:
            if not isinstance(heading, str) or not heading.strip():
                result.fail(f"{label}: heading must be non-empty when present")
            else:
                # headingForLine() in rag-client.ts searches from the chunk's
                # own start line backwards (line-1 index is the start line),
                # returning the nearest ATX heading at or above it.
                lines_through_start = source.splitlines()[:start_line]
                heading_texts = []
                for line in reversed(lines_through_start):
                    m = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
                    if m:
                        heading_texts.append(m.group(1).strip())
                # headingForLine() returns the nearest heading above the chunk.
                if not heading_texts or heading_texts[0] != heading.strip():
                    result.fail(
                        f"{label}: heading {heading!r} does not match nearest"
                        f" preceding heading {heading_texts[0] if heading_texts else None!r}"
                    )

        if index >= 500:
            max_chunks_seen = True

    if truncated != (len(chunks) >= 500):
        result.fail(
            f"{document['filename']}: truncated={truncated} inconsistent with"
            f" chunk count {len(chunks)} (cap is 500)"
        )
    del max_chunks_seen

    result.passed = not result.failures
    return result


# --------------------------------------------------------------- retrieval


@dataclass
class QueryEvaluation:
    question: str
    relevant_chunks: list[int]
    ranking: list[tuple[int, float]]
    recall_at_k: float
    reciprocal_rank: float
    hit_at_k: bool


class TfidfIndex:
    """Minimal TF-IDF cosine index over chunk texts."""

    def __init__(self, documents: list[str]) -> None:
        self.docs_tokens = [tokenize(doc) for doc in documents]
        self.doc_count = len(self.docs_tokens)
        self.idf = self._compute_idf()
        self.vectors = [self._vector(tokens) for tokens in self.docs_tokens]

    def _compute_idf(self) -> dict[str, float]:
        df: dict[str, int] = {}
        for tokens in self.docs_tokens:
            for term in set(tokens):
                df[term] = df.get(term, 0) + 1
        return {
            term: math.log((self.doc_count + 1) / (count + 1)) + 1.0
            for term, count in df.items()
        }

    def _vector(self, tokens: list[str]) -> dict[str, float]:
        tf: dict[str, int] = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1
        vector = {
            term: count * self.idf.get(term, math.log((self.doc_count + 1) / 1) + 1.0)
            for term, count in tf.items()
        }
        norm = math.sqrt(sum(weight * weight for weight in vector.values()))
        if norm > 0:
            vector = {term: weight / norm for term, weight in vector.items()}
        return vector

    def score(self, query: str) -> list[float]:
        query_vector = self._vector(tokenize(query))
        scores = []
        for vector in self.vectors:
            dot = sum(weight * query_vector.get(term, 0.0) for term, weight in vector.items())
            scores.append(dot)
        return scores


def evaluate_corpus(corpus_entry: dict, dump_documents: dict[str, dict], top_k: int = 3) -> dict:
    """Evaluate one corpus entry against its dumped documents.

    dump_documents maps filename -> document dict from the chunk dump.
    """
    document_entries = []
    chunk_texts: list[str] = []
    owners: list[tuple[str, int]] = []  # (filename, local chunk index)

    for doc in corpus_entry["documents"]:
        filename = doc["filename"]
        dumped = dump_documents.get(filename)
        if dumped is None:
            raise SystemExit(
                f"Corpus references '{filename}' but the chunk dump has no such document."
            )
        document_entries.append(
            {
                "filename": filename,
                "chunks": dumped["chunk_count"],
                "truncated": dumped["truncated"],
            }
        )
        for index, chunk in enumerate(dumped["chunks"]):
            chunk_texts.append(chunk["text"])
            owners.append((filename, index))

    index = TfidfIndex(chunk_texts)

    per_query = []
    recalls = []
    rrs = []
    hits = []

    for query in corpus_entry["queries"]:
        scores = index.score(query["question"])
        ranked = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
        top = [(i, round(scores[i], 4)) for i in ranked[:top_k]]

        relevant = set()
        for chunk_index, (filename, _) in enumerate(owners):
            start = dumped_start(dump_documents, filename, chunk_index)
            end = dumped_end(dump_documents, filename, chunk_index)
            for ev_start, ev_end in query["evidence_lines"]:
                if start <= ev_end and ev_start <= end:
                    relevant.add(chunk_index)
                    break

        retrieved = {i for i, _ in top}
        recall = len(relevant & retrieved) / len(relevant) if relevant else 0.0
        first_hit = next((rank for rank, (i, _) in enumerate(top, start=1) if i in relevant), None)
        rr = 1.0 / first_hit if first_hit else 0.0

        recalls.append(recall)
        rrs.append(rr)
        hits.append(first_hit is not None)

        per_query.append(
            {
                "question": query["question"],
                "relevant_chunks": sorted(relevant),
                "top_k": [
                    {
                        "index": i,
                        "score": s,
                        "filename": owners[i][0],
                        "startLine": dumped_start(dump_documents, owners[i][0], owners[i][1]),
                        "endLine": dumped_end(dump_documents, owners[i][0], owners[i][1]),
                    }
                    for i, s in top
                ],
                "recall_at_k": round(recall, 4),
                "reciprocal_rank": round(rr, 4),
                "hit_at_k": first_hit is not None,
            }
        )

    query_count = len(per_query)
    metrics = {
        f"recall_at_{top_k}": round(sum(recalls) / query_count, 4) if query_count else 0.0,
        "mrr": round(sum(rrs) / query_count, 4) if query_count else 0.0,
        f"hit_rate_at_{top_k}": round(sum(hits) / query_count, 4) if query_count else 0.0,
    }

    return {"documents": document_entries, "queries": per_query, "metrics": metrics}


def dumped_start(docs: dict[str, dict], filename: str, chunk_index: int) -> int:
    return docs[filename]["chunks"][chunk_index]["startLine"]


def dumped_end(docs: dict[str, dict], filename: str, chunk_index: int) -> int:
    return docs[filename]["chunks"][chunk_index]["endLine"]


# ------------------------------------------------------------------- main


def build_report(dump: dict, floors: dict[str, float]) -> dict:
    contract_failures: list[str] = []

    results = []
    contract_all_passed = True
    for corpus_entry in dump.get("corpora", []):
        scoped = {
            document["filename"]: document
            for document in corpus_entry.get("documents", [])
        }
        for document in corpus_entry.get("documents", []):
            contract = check_chunk_contract(document)
            if not contract.passed:
                contract_all_passed = False
                contract_failures.extend(contract.failures)
        evaluation = evaluate_corpus(corpus_entry, scoped)
        evaluation["name"] = corpus_entry["name"]
        results.append(evaluation)

    aggregate_metrics = {}
    if results:
        names = results[0]["metrics"].keys()
        for name in names:
            aggregate_metrics[name] = round(
                sum(r["metrics"][name] for r in results) / len(results), 4
            )

    floors_passed = all(aggregate_metrics.get(k, 0.0) >= v for k, v in floors.items())

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "evaluator": "python/techwriter/rag_eval.py",
        "note": (
            "TF-IDF lexical retrieval is a structural proxy floor for the "
            "product's bge-small-en-v1.5 embedding retrieval; it detects "
            "chunking/citation regressions, not semantic drift."
        ),
        "metrics": aggregate_metrics,
        "floors": floors,
        "floors_passed": floors_passed,
        "contract_passed": contract_all_passed,
        "contract_failures": contract_failures,
        "corpora": results,
    }


def write_markdown_summary(report: dict, path: Path) -> None:
    lines = [
        "# RAG Eval Report",
        "",
        f"Generated: {report['generated_at']}",
        "",
        "| Metric | Value | Floor | Pass |",
        "|---|---|---|---|",
    ]
    for name, value in report["metrics"].items():
        floor = report["floors"].get(name)
        lines.append(
            f"| {name} | {value} | {floor if floor is not None else '—'} |"
            f" {'yes' if floor is None or value >= floor else 'NO'} |"
        )
    lines += [
        "",
        f"Contract: {'PASS' if report['contract_passed'] else 'FAIL'}",
        "",
    ]
    if report["contract_failures"]:
        lines.append("Failures:")
        lines.extend(f"- {failure}" for failure in report["contract_failures"])
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline RAG chunk/retrieval evaluator")
    parser.add_argument("--chunks", default="output/python/rag-chunks.json")
    parser.add_argument("--out", default="output/python/rag-eval-report.json")
    parser.add_argument("--report", default="output/python/rag-eval-report.md")
    parser.add_argument("--min-recall", type=float, default=0.0)
    parser.add_argument("--min-mrr", type=float, default=0.0)
    parser.add_argument("--min-hit-rate", type=float, default=0.0)
    args = parser.parse_args(argv)

    dump = json.loads(Path(args.chunks).read_text(encoding="utf-8"))
    floors = {}
    if args.min_recall > 0:
        floors["recall_at_3"] = args.min_recall
    if args.min_mrr > 0:
        floors["mrr"] = args.min_mrr
    if args.min_hit_rate > 0:
        floors["hit_rate_at_3"] = args.min_hit_rate

    report = build_report(dump, floors)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_markdown_summary(report, Path(args.report))

    print(json.dumps({"metrics": report["metrics"], "floors": report["floors"]}, indent=2))
    if not report["contract_passed"]:
        for failure in report["contract_failures"]:
            print(f"CONTRACT FAILURE: {failure}", file=sys.stderr)
        return 2
    if not report["floors_passed"]:
        print("FLOORS NOT MET", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
