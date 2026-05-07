export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripDisclaimers(text: string): string {
  return text
    .replace(/\b(my|our) (training data|knowledge) (only goes|ended|cutoff).*?(20\d{2}|20\d{2}\.)/gi, '')
    .replace(/\bPlease note that (my|our) (knowledge|training|information).*?\.\s*/gi, '')
    .replace(/\[Pre-2023 knowledge\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatMarkdown(text: string | null | undefined, sources?: { title: string; url: string }[]): string {
  if (!text) return '';
  let formatted = escapeHtml(String(text));

  if (sources && sources.length > 0) {
    formatted = formatted.replace(/\[(\d+)\]/g, (_, num) => {
      const idx = parseInt(num) - 1;
      if (sources[idx]) {
        return `<sup class="citation"><a href="${sources[idx].url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(sources[idx].title)}" style="color:#2563eb;text-decoration:none;font-weight:600">[${num}]</a></sup>`;
      }
      return `<sup class="citation">[${num}]</sup>`;
    });
  } else {
    formatted = formatted.replace(/\[(\d+)\]/g, '<sup class="citation">[$1]</sup>');
  }

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  formatted = formatted.replace(/^\- (.*)/gm, '<li class="ml-4 list-disc">$1</li>');
  formatted = formatted.replace(/(<li.*<\/li>)/gs, '<ul class="my-2">$1</ul>');
  formatted = formatted.replace(/\n/g, '<br />');
  return formatted;
}
