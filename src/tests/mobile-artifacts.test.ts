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

  it('lets mobile users swipe down on the artifact overlay chrome to dismiss it', () => {
    const overlay = source('src/components/ArtifactOverlay.svelte');

    expect(overlay).toContain('const SWIPE_DISMISS_THRESHOLD = 96');
    expect(overlay).toContain('function startSwipeDismiss(e: PointerEvent)');
    expect(overlay).toContain('function trackSwipeDismiss(e: PointerEvent)');
    expect(overlay).toContain('function finishSwipeDismiss(e: PointerEvent)');
    expect(overlay).toContain('function resetSwipeDismiss()');
    expect(overlay).toContain('if (deltaY >= SWIPE_DISMISS_THRESHOLD) closeOverlay()');
    expect(overlay).toContain('onpointerdown={startSwipeDismiss}');
    expect(overlay).toContain('onpointermove={trackSwipeDismiss}');
    expect(overlay).toContain('onpointerup={finishSwipeDismiss}');
    expect(overlay).toContain('style:transform={`translateY(${visible ? swipeOffsetY : 32}px)`}');
    expect(overlay).toContain('aria-hidden="true"');
  });
});
