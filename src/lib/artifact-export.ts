// Central registry of downloadable formats per artifact type + a lazy
// dispatcher so components (ArtifactPanel, ArtifactOverlay) share one code
// path. Exporters are dynamically imported so their CDN libs load only on
// use. document-* formats are added in Phase 2c.

export interface ExportFormat {
  id: string;
  label: string;
  ext: string;
}

export function exportFormatsFor(type: string): ExportFormat[] {
  if (type === 'deck') {
    return [
      { id: 'pptx', label: 'PowerPoint (.pptx)', ext: '.pptx' },
      { id: 'pdf', label: 'PDF (.pdf)', ext: '.pdf' },
      { id: 'json', label: 'Source (.json)', ext: '.json' },
    ];
  }
  if (type === 'document') {
    return [
      { id: 'pdf', label: 'PDF (.pdf)', ext: '.pdf' },
      { id: 'docx', label: 'Word (.docx)', ext: '.docx' },
      { id: 'md', label: 'Markdown (.md)', ext: '.md' },
    ];
  }
  return [];
}

export function downloadBlob(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Runs a rich export for the given format. Returns true when handled, false
// to let the caller fall back to a raw text/source download.
export async function exportArtifactAs(
  type: string,
  code: string,
  filenameBase: string,
  formatId: string,
): Promise<boolean> {
  if (type === 'deck') {
    const { repairDeckSpec } = await import('./deck-schema');
    const spec = repairDeckSpec(code);
    if (!spec) return false;
    if (formatId === 'pptx') { const { exportDeckToPptx } = await import('./deck-pptx'); await exportDeckToPptx(spec, filenameBase); return true; }
    if (formatId === 'pdf') { const { exportDeckToPdf } = await import('./deck-pdf'); await exportDeckToPdf(spec, filenameBase); return true; }
    if (formatId === 'json') { downloadBlob(code, `${filenameBase}.json`, 'application/json'); return true; }
  }

  // 'document' formats are wired in Phase 2c once doc-* modules exist.

  return false;
}
