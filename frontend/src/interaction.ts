// Pan/zoom/drag controller (docs/layout-and-render.md §6, §11). Owns viewport + dragged-position
// state; calls render's fast-path updaters. Does not build SVG nodes itself.

import type { RenderHandle } from './render';
import { zoomMin, zoomMax, fitPadding, dragThreshold, wheelZoomK } from './theme';

export interface Interaction {
  /** Attach to a fresh RenderHandle (called after every full render). */
  attach(handle: RenderHandle): void;
  /** Fit content into the container. */
  fit(): void;
  /** Dragged positions keyed by table name (for re-parse persistence). */
  positions: Record<string, { x: number; y: number }>;
  /** Swap the active dragged-positions store (one per tab) so drags write into the active tab. */
  setPositions(p: Record<string, { x: number; y: number }>): void;
  destroy(): void;
}

function clamp(min: number, v: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function createInteraction(container: HTMLElement): Interaction {
  let positions: Record<string, { x: number; y: number }> = {};

  let handle: RenderHandle | null = null;
  let tx = 0;
  let ty = 0;
  let k = 1;

  // pan (background drag) state
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOrigTx = 0;
  let panOrigTy = 0;

  // table drag state
  let dragName: string | null = null;
  let dragStartScreenX = 0;
  let dragStartScreenY = 0;
  let dragOrigX = 0;
  let dragOrigY = 0;
  let dragMoved = false;
  let dragTarget: SVGGElement | null = null;

  function setViewport(): void {
    handle?.setViewport(tx, ty, k);
  }

  function contentBBox(): { x: number; y: number; w: number; h: number } | null {
    if (!handle) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const name of Object.keys(handle.geometry)) {
      const g = handle.geometry[name];
      any = true;
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w);
      maxY = Math.max(maxY, g.y + g.h);
    }
    // include group boxes (member bbox ± groupPad already inside card bbox range plus 16px);
    // padding via fitPadding at fit time is enough — cards dominate. Expand a little for group pad.
    if (!any) return null;
    const pad = 20; // covers group-box overhang
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }

  function fit(): void {
    if (!handle) return;
    const bbox = contentBBox();
    if (!bbox) return;
    const cw = container.clientWidth || 800;
    const ch = container.clientHeight || 600;
    const kx = (cw - 2 * fitPadding) / bbox.w;
    const ky = (ch - 2 * fitPadding) / bbox.h;
    k = clamp(zoomMin, Math.min(kx, ky), 1);
    // center bbox
    tx = (cw - bbox.w * k) / 2 - bbox.x * k;
    ty = (ch - bbox.h * k) / 2 - bbox.y * k;
    setViewport();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      // zoom, anchored at cursor
      let dy = e.deltaY;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        dy *= 16;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        dy *= container.clientHeight || 800;
      }
      const k2 = clamp(zoomMin, k * Math.exp(-dy * wheelZoomK), zoomMax);
      tx = cx - ((cx - tx) * k2) / k;
      ty = cy - ((cy - ty) * k2) / k;
      k = k2;
    } else {
      // pan
      tx -= e.deltaX;
      ty -= e.deltaY;
    }
    setViewport();
  }

  function onPointerDown(e: PointerEvent): void {
    const targetEl = e.target as Element;
    const tableG = targetEl.closest('g.table') as SVGGElement | null;
    if (tableG) {
      // start table drag
      dragName = tableG.getAttribute('data-name');
      dragTarget = tableG;
      dragStartScreenX = e.clientX;
      dragStartScreenY = e.clientY;
      dragMoved = false;
      if (dragName && handle) {
        const g = handle.geometry[dragName];
        dragOrigX = g.x;
        dragOrigY = g.y;
      }
      tableG.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    // background pan
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOrigTx = tx;
    panOrigTy = ty;
    (container as HTMLElement).style.cursor = 'grabbing';
    container.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragName && dragTarget) {
      const dxScreen = e.clientX - dragStartScreenX;
      const dyScreen = e.clientY - dragStartScreenY;
      if (!dragMoved && Math.hypot(dxScreen, dyScreen) < dragThreshold) return;
      dragMoved = true;
      const nx = dragOrigX + dxScreen / k;
      const ny = dragOrigY + dyScreen / k;
      handle?.moveTable(dragName, nx, ny);
      return;
    }
    if (panning) {
      tx = panOrigTx + (e.clientX - panStartX);
      ty = panOrigTy + (e.clientY - panStartY);
      setViewport();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragName) {
      if (dragMoved && handle) {
        const g = handle.geometry[dragName];
        positions[dragName] = { x: g.x, y: g.y };
      }
      dragTarget?.releasePointerCapture(e.pointerId);
      dragName = null;
      dragTarget = null;
      return;
    }
    if (panning) {
      panning = false;
      (container as HTMLElement).style.cursor = 'grab';
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may not be held */
      }
    }
  }

  function onDblClick(): void {
    fit();
  }

  container.style.cursor = 'grab';
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('dblclick', onDblClick);

  return {
    get positions(): Record<string, { x: number; y: number }> {
      return positions;
    },
    setPositions(p: Record<string, { x: number; y: number }>): void {
      positions = p;
    },
    attach(h: RenderHandle): void {
      handle = h;
      h.setViewport(tx, ty, k);
    },
    fit,
    destroy(): void {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('dblclick', onDblClick);
    },
  };
}
