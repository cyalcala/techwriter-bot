"""Techwriter Bot offline analytical tooling.

Python here is Lane A/B tooling only: it never becomes a second backend.
It consumes artifacts produced by the real TypeScript implementation
(e.g. chunks from src/lib/rag-client.ts#chunkDocument) and computes
deterministic metrics TypeScript does not need at runtime.
"""

__version__ = "0.1.0"
