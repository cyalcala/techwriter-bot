import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('mobile artifact overlay behavior', () => {
  it('locks page scroll while a mobile artifact panel is open and restores prior styles', () => {
    const island = source('src/components/ChatIsland.svelte');

    expect(island).toContain('function setMobileArtifactScrollLock(locked: boolean)');
    expect(island).toContain('const shouldLockMobileArtifactScroll = isMobile && !!activeArtifactEntry');
    expect(island).toContain('setMobileArtifactScrollLock(shouldLockMobileArtifactScroll)');
    expect(island).toContain("document.documentElement.style.overflow = 'hidden'");
    expect(island).toContain("document.body.style.overflow = 'hidden'");
    expect(island).toContain("document.body.style.overscrollBehavior = 'contain'");
    expect(island).toContain('previousDocumentOverflow');
    expect(island).toContain('previousBodyOverflow');
    expect(island).toContain('previousBodyOverscrollBehavior');
  });
});
