/**
 * Where recorded boxes are in a screenshot.
 *
 * Boxes are recorded in document CSS pixels: the viewport box plus the scroll
 * offset at the time of the inventory. Full-page screenshots in Chromium,
 * Firefox and WebKit paint `position: fixed` and `sticky` elements where they
 * are on screen at the current scroll offset, i.e. at those same document
 * coordinates, so no per-engine mapping is needed. (The recorder re-takes the
 * inventory after each screenshot and only keeps boxes that didn't move, which
 * covers a scroll between the inventory and the capture.) A screenshot can
 * show only part of the document: cropped to `maxScreenshotHeight`, or a
 * viewport screenshot of a short-lived state (`RawSnapshot.screenshotClip`).
 */
import type { RawClip, RawViewport } from './raw';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The document region the viewport showed. */
export function viewportClip(vp: RawViewport): RawClip {
  return { x: vp.x, y: vp.y, width: vp.w, height: vp.h };
}

/** Whether any part of `box` is inside `clip`. */
export function intersects(box: Box, clip: RawClip): boolean {
  return box.x < clip.x + clip.width && box.x + box.w > clip.x && box.y < clip.y + clip.height && box.y + box.h > clip.y;
}

/**
 * `box` in image coordinates (relative to the region's top-left corner,
 * clipped to it), or undefined if none of it is in the image.
 */
export function boxInImage<T extends Box>(box: T, region: RawClip): T | undefined {
  if (!intersects(box, region)) return undefined;
  const x = Math.max(box.x, region.x);
  const y = Math.max(box.y, region.y);
  const right = Math.min(box.x + box.w, region.x + region.width);
  const bottom = Math.min(box.y + box.h, region.y + region.height);
  return { ...box, x: x - region.x, y: y - region.y, w: right - x, h: bottom - y };
}
