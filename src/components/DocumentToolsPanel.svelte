<script lang="ts">
  import { parseTerminologyRules, type DocumentFinding, type TerminologyRule } from '../lib/document-review';

  interface Props {
    documentName: string;
    findings: DocumentFinding[];
    hasRun: boolean;
    onReview: (rules: TerminologyRule[]) => void;
    graphResult: { available: boolean; context: string; nodeCount: number } | null;
    graphLoading: boolean;
    graphError: string;
    onLookup: (term: string) => void;
    onClose: () => void;
  }

  let { documentName, findings, hasRun, onReview, graphResult, graphLoading, graphError, onLookup, onClose }: Props = $props();
  let activeTool = $state<'review' | 'references'>('review');
  let glossaryRules = $state('');
  let glossaryNotice = $state('');
  let lookupTerm = $state('');
  let copied = $state(false);

  function submitReview() {
    const parsed = parseTerminologyRules(glossaryRules);
    glossaryNotice = parsed.rules.length || parsed.ignoredLines
      ? `${parsed.rules.length} glossary rule${parsed.rules.length === 1 ? '' : 's'} applied${parsed.ignoredLines ? `, ${parsed.ignoredLines} ignored` : ''}.`
      : '';
    onReview(parsed.rules);
  }

  async function copyReferences() {
    if (!graphResult?.context) return;
    try {
      await navigator.clipboard.writeText(graphResult.context);
      copied = true;
      setTimeout(() => { copied = false; }, 1200);
    } catch {}
  }
</script>

<section
  id="document-tools-panel"
  aria-label="Document tools"
  class="shrink-0 border-t border-stone-200/70 bg-white/70 px-3 py-3 md:px-4"
>
  <div class="mx-auto max-w-3xl">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="text-xs font-semibold text-stone-700">Tools</h2>
      <button
        type="button"
        onclick={onClose}
        class="rounded-md px-2 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
        aria-label="Close document tools"
      >Close</button>
    </div>

    <div class="mb-3 inline-flex rounded-lg bg-stone-100 p-0.5" role="tablist" aria-label="Documentation tools">
      <button
        type="button"
        role="tab"
        aria-selected={activeTool === 'review'}
        onclick={() => { activeTool = 'review'; }}
        class="rounded-md px-3 py-1.5 text-xs transition-colors {activeTool === 'review' ? 'bg-white font-medium text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}"
      >Review Document</button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTool === 'references'}
        onclick={() => { activeTool = 'references'; }}
        class="rounded-md px-3 py-1.5 text-xs transition-colors {activeTool === 'references' ? 'bg-white font-medium text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}"
      >Find Code References</button>
    </div>

    {#if activeTool === 'review'}
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/70 pb-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-stone-800">Review Document</p>
          <p class="truncate text-xs text-stone-500">{documentName || 'No document loaded'}</p>
        </div>
        <button
          type="button"
          onclick={submitReview}
          disabled={!documentName}
          class="rounded-lg bg-stone-800 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-35"
        >Review</button>
      </div>

      <div class="py-3">
        <label class="text-[11px] font-medium text-stone-500">
          Glossary rules
          <textarea
            value={glossaryRules}
            oninput={(event) => { glossaryRules = (event.target as HTMLTextAreaElement).value; }}
            placeholder="whitelist -> allowlist"
            rows="3"
            class="mt-1 w-full resize-y rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-800 outline-none transition-colors focus:border-amber-300"
          ></textarea>
        </label>
        {#if glossaryNotice}
          <p class="mt-1 text-[11px] text-stone-500">{glossaryNotice}</p>
        {/if}
      </div>

      {#if hasRun}
        <div aria-live="polite" class="border-t border-stone-200/70 pt-3">
          {#if findings.length === 0}
            <p class="text-xs font-medium text-green-700">No findings.</p>
          {:else}
            <ol class="max-h-40 space-y-2 overflow-y-auto" aria-label="Document review findings">
              {#each findings as finding}
                <li class="flex items-start gap-2 text-xs text-stone-700">
                  <span class="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-medium text-stone-500">
                    Line {finding.line}
                  </span>
                  <span class={finding.severity === 'error' ? 'text-red-700' : 'text-stone-700'}>
                    {finding.message}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="flex flex-wrap items-end gap-2 border-b border-stone-200/70 pb-3">
        <label class="min-w-[220px] flex-1 text-[11px] font-medium text-stone-500">
          Reference term
          <input
            value={lookupTerm}
            oninput={(event) => { lookupTerm = (event.target as HTMLInputElement).value; }}
            class="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-800 outline-none transition-colors focus:border-amber-300"
          />
        </label>
        <button
          type="button"
          onclick={() => { onLookup(lookupTerm.trim()); }}
          disabled={!lookupTerm.trim() || graphLoading}
          class="rounded-lg bg-stone-800 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-35"
        >{graphLoading ? 'Finding...' : 'Find'}</button>
      </div>

      <div aria-live="polite" class="pt-3 text-xs text-stone-600">
        {#if graphError}
          <p class="text-red-700">{graphError}</p>
        {:else if graphResult && !graphResult.available}
          <p>Reference index unavailable.</p>
        {:else if graphResult && !graphResult.context}
          <p>No references found.</p>
        {:else if graphResult?.context}
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="font-medium text-stone-700">{graphResult.nodeCount} references</p>
            <button
              type="button"
              onclick={copyReferences}
              class="rounded-md px-2 py-1 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-2.5 font-mono text-[11px] text-stone-700">{graphResult.context}</pre>
        {/if}
      </div>
    {/if}
  </div>
</section>
