# Techwriter Bot diagram evidence

These diagrams are documentation artifacts, not runtime topology discovery.
Their claims are tied to the target repository revision
`476c4d9eabe78e8f21d18a7fe3f9e278bd1676ec`, which is embedded in the
architecture source's repository evidence.

| Diagram | Source JSON | Grounding evidence | Deliberate boundary |
| --- | --- | --- | --- |
| Delivery architecture | `techwriter-architecture.architecture.json` | `src/pages/api/chat.ts`, `src/lib/{zen-router,providers,graph-query,stream-parser,artifact-queue}.ts`, `src/components/{ChatIsland,ArtifactPanel}.svelte`, `wrangler.json` | It shows configured components and code paths, not a claim that every optional provider or graph lookup is active for every request. |
| Artifact workflow | `artifact-workflow.workflow.json` | `src/pages/api/chat.ts`, `src/lib/{prompts,path-router,stream-parser,artifact-queue}.ts`, `src/components/ArtifactPanel.svelte` | Static Archify references are allowlisted; arbitrary generator HTML and request-time Archify rendering are excluded. |
| Chat sequence | `chat-request-sequence.sequence.json` | `src/pages/api/chat.ts`, `src/lib/{zen-router,providers,graph-query}.ts` | The failover arrow is a retryable outcome model, not a guarantee that a fallback succeeds. |
| Context data flow | `context-dataflow.dataflow.json` | `src/pages/api/chat.ts`, `src/lib/{path-router,prompts,graph-query,rag-client,stream-parser}.ts` | RAG is shown as client/session-local; the diagram does not invent a durable content store. |
| Circuit lifecycle | `provider-circuit-lifecycle.lifecycle.json` | `src/lib/zen-router.ts` lines defining `FAIL_WINDOW_MS`, `FAIL_THRESHOLD`, `EJECT_MS`, `PERMANENT_EJECT_MS`, `recordFail`, `recordSuccess`, and `isCircuitOpen` | The visualization summarizes eligibility state. Artifact session affinity remains a documented special case. |

The manifest and receipts contain source and output SHA-256 values. If one of the
grounding files changes materially, update the relevant JSON, regenerate the
artifact, and review the receipt in the same change.
