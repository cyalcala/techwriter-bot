<script lang="ts">
  import type { DocumentFinding, TerminologyRule } from '../lib/document-review';

  interface Props {
    documentName: string;
    findings: DocumentFinding[];
    hasRun: boolean;
    onReview: (rules: TerminologyRule[]) => void;
    onClose: () => void;
  }

  let { documentName, findings, hasRun, onReview, onClose }: Props = $props();
  let avoidTerm = $state('');
  let preferredTerm = $state('');

  function submitReview() {
    const avoid = avoidTerm.trim();
    const prefer = preferredTerm.trim();
    const rules = avoid && prefer ? [{ avoid, prefer }] : [];
    onReview(rules);
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

    <div class="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2">
      <label class="text-[11px] font-medium text-stone-500">
        Avoid term
        <input
          value={avoidTerm}
          oninput={(event) => { avoidTerm = (event.target as HTMLInputElement).value; }}
          class="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-800 outline-none transition-colors focus:border-amber-300"
        />
      </label>
      <label class="text-[11px] font-medium text-stone-500">
        Preferred term
        <input
          value={preferredTerm}
          oninput={(event) => { preferredTerm = (event.target as HTMLInputElement).value; }}
          class="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-800 outline-none transition-colors focus:border-amber-300"
        />
      </label>
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
  </div>
</section>
