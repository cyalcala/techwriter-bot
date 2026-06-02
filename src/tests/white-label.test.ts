import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('white-label app configuration', () => {
  it('sanitizes client white-label values with safe fallbacks', async () => {
    const { readWhiteLabelConfig } = await import('../lib/white-label');

    expect(readWhiteLabelConfig({
      APP_TITLE: 'Acme Docs Console',
      APP_LOGO_URL: 'https://example.com/logo.svg',
      PRIMARY_COLOR: '#0f766e',
      FOOTER_TEXT: 'Internal docs assistant. Verify before publishing.',
    }, { personaName: 'Acme Writer' })).toEqual({
      appTitle: 'Acme Docs Console',
      logoUrl: 'https://example.com/logo.svg',
      primaryColor: '#0f766e',
      footerText: 'Internal docs assistant. Verify before publishing.',
    });

    expect(readWhiteLabelConfig({
      APP_TITLE: '   ',
      APP_LOGO_URL: 'javascript:alert(1)',
      PRIMARY_COLOR: 'url(javascript:alert(1))',
      FOOTER_TEXT: '   ',
    }, { personaName: 'Acme Writer' })).toEqual({
      appTitle: 'Acme Writer',
      logoUrl: '',
      primaryColor: '#16a34a',
      footerText: 'AI can make mistakes. Verify important info.',
    });
  });

  it('wires white-label config through the page, header, and footer', () => {
    const index = source('src/pages/index.astro');
    const island = source('src/components/ChatIsland.svelte');
    const input = source('src/components/ChatInput.svelte');

    expect(index).toContain('readWhiteLabelConfig');
    expect(index).toContain('APP_TITLE');
    expect(index).toContain('APP_LOGO_URL');
    expect(index).toContain('PRIMARY_COLOR');
    expect(index).toContain('FOOTER_TEXT');
    expect(index).toContain('appTitle={whiteLabel.appTitle}');
    expect(index).toContain('logoUrl={whiteLabel.logoUrl}');
    expect(index).toContain('primaryColor={whiteLabel.primaryColor}');
    expect(index).toContain('footerText={whiteLabel.footerText}');

    expect(island).toContain('appTitle?: string');
    expect(island).toContain('logoUrl?: string');
    expect(island).toContain('primaryColor?: string');
    expect(island).toContain('footerText?: string');
    expect(island).toContain('{visibleAppTitle}');
    expect(island).toContain('{#if visibleLogoUrl}');
    expect(island).toContain('style:--brand-primary={visiblePrimaryColor}');
    expect(island).toContain('footerText={visibleFooterText}');

    expect(input).toContain('footerText?: string');
    expect(input).toContain('{footerText}');
    expect(input).toContain('style:--brand-primary={primaryColor}');
  });

  it('keeps white-label values deploy-configurable without code edits', () => {
    const envReader = source('src/lib/env-reader.ts');
    const template = source('.env.template');
    const workflow = source('.github/workflows/deploy.yml');

    for (const key of ['APP_TITLE', 'APP_LOGO_URL', 'PRIMARY_COLOR', 'FOOTER_TEXT']) {
      expect(envReader).toContain(`set('${key}'`);
      expect(template).toContain(`${key}=`);
      expect(workflow).toContain(`${key}: process.env.${key}`);
      expect(workflow).toContain(`${key}: \${{ vars.${key} || secrets.${key} }}`);
    }
  });
});
