"""Tests for the offline RAG evaluator (stdlib metrics + chunk contract)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from techwriter.rag_eval import (  # noqa: E402
    TfidfIndex,
    check_chunk_contract,
    evaluate_corpus,
    line_for_offset,
)


def make_document(**overrides):
    document = {
        "filename": "doc.md",
        "source_text": "alpha beta\n\ngamma delta\n\nepsilon zeta\n",
        "chunk_count": 2,
        "truncated": False,
        "chunks": [
            {
                "text": "alpha beta\n\n",
                "filename": "doc.md",
                "startLine": 1,
                "endLine": 2,
            },
            {
                "text": "gamma delta\n\n",
                "filename": "doc.md",
                "startLine": 3,
                "endLine": 4,
            },
        ],
    }
    document.update(overrides)
    return document


class TestContract:
    def test_clean_document_passes(self):
        result = check_chunk_contract(make_document())
        assert result.passed, result.failures

    def test_wrong_end_line_fails(self):
        document = make_document()
        document["chunks"][1]["endLine"] = 99
        result = check_chunk_contract(document)
        assert not result.passed
        assert any("reproduces" in failure for failure in result.failures)

    def test_backwards_start_line_fails(self):
        document = make_document()
        document["chunks"][0]["startLine"] = 4
        document["chunks"][0]["endLine"] = 4
        result = check_chunk_contract(document)
        assert not result.passed
        assert any("goes backwards" in failure for failure in result.failures)

    def test_duplicate_paragraphs_pass_on_any_occurrence(self):
        source = "same words here\n\nmiddle\n\nsame words here\n"
        # "same words here" occurs at lines 1 AND 5; each claimed position
        # must be accepted when it reproduces the claimed line pair.
        chunks = [
            {"text": "same words here", "filename": "d.md", "startLine": 1, "endLine": 1},
            {"text": "middle", "filename": "d.md", "startLine": 3, "endLine": 3},
            {"text": "same words here", "filename": "d.md", "startLine": 5, "endLine": 5},
        ]
        result = check_chunk_contract(
            {
                "filename": "d.md",
                "source_text": source,
                "chunk_count": 3,
                "truncated": False,
                "chunks": chunks,
            }
        )
        assert result.passed, result.failures

    def test_truncation_flag_must_match_cap(self):
        chunks = [
            {"text": f"chunk {i}\n", "filename": "big.md", "startLine": i, "endLine": i}
            for i in range(1, 501)
        ]
        result = check_chunk_contract(
            {
                "filename": "big.md",
                "source_text": "".join(f"chunk {i}\n" for i in range(1, 501)),
                "chunk_count": 500,
                "truncated": False,
                "chunks": chunks,
            }
        )
        assert not result.passed
        assert any("truncated" in failure for failure in result.failures)

    def test_empty_chunk_text_fails(self):
        document = make_document()
        document["chunks"][0]["text"] = "   "
        result = check_chunk_contract(document)
        assert not result.passed
        assert any("non-empty" in failure for failure in result.failures)


class TestRetrieval:
    def test_exact_term_beats_noise(self):
        index = TfidfIndex(
            ["the rollback command restores service quickly", "quarterly budget planning notes"]
        )
        scores = index.score("rollback command")
        assert scores[0] > scores[1]

    def test_line_for_offset_matches_ts_rule(self):
        text = "one\ntwo\nthree"
        assert line_for_offset(text, 0) == 1
        assert line_for_offset(text, 4) == 2
        assert line_for_offset(text, 8) == 3
        assert line_for_offset(text, 999) == 3

    def test_evaluate_corpus_metrics_shape(self):
        corpus_entry = {
            "name": "tiny",
            "documents": [{"filename": "doc.md"}],
            "queries": [
                {"question": "gamma delta", "evidence_lines": [[3, 4]]},
            ],
        }
        dumped = {"doc.md": make_document()}
        evaluation = evaluate_corpus(corpus_entry, dumped)
        assert evaluation["metrics"]["recall_at_3"] == pytest.approx(1.0)
        assert evaluation["metrics"]["hit_rate_at_3"] == pytest.approx(1.0)
        top = evaluation["queries"][0]["top_k"]
        assert top[0]["index"] in evaluation["queries"][0]["relevant_chunks"]
