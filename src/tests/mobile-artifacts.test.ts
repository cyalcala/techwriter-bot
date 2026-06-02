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

  it('supports pinch zoom inside the mobile artifact overlay surface', () => {
    const overlay = source('src/components/ArtifactOverlay.svelte');

    expect(overlay).toContain('const PINCH_ZOOM_MIN_SCALE = 1');
    expect(overlay).toContain('const PINCH_ZOOM_MAX_SCALE = 3');
    expect(overlay).toContain('const zoomPointers = new Map<number, { x: number; y: number }>()');
    expect(overlay).toContain('function startPinchZoom(e: PointerEvent)');
    expect(overlay).toContain('function trackPinchZoom(e: PointerEvent)');
    expect(overlay).toContain('function finishPinchZoom(e: PointerEvent)');
    expect(overlay).toContain('function resetPinchZoom()');
    expect(overlay).toContain('function distanceBetween');
    expect(overlay).toContain('function clampZoomScale');
    expect(overlay).toContain('zoomScale = clampZoomScale(pinchStartScale * (nextDistance / pinchStartDistance))');
    expect(overlay).toContain('style:width={`${zoomPercent}%`}');
    expect(overlay).toContain('onpointerdown={startPinchZoom}');
    expect(overlay).toContain('onpointermove={trackPinchZoom}');
    expect(overlay).toContain('aria-label="Pinch zoom artifact preview"');
  });
});
