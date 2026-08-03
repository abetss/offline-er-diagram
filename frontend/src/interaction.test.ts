import { describe, it, expect, beforeEach } from 'vitest';
import { createInteraction } from './interaction';
import { wheelZoomK, zoomMin, zoomMax } from './theme';
import type { RenderHandle } from './render';

describe('interaction zooming', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    document.body.append(container);
  });

  it('zooms anchored at cursor with updated wheelZoomK factor', () => {
    let lastK = 1;

    const mockHandle: RenderHandle = {
      svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      geometry: {
        tbl: { x: 100, y: 100, w: 200, h: 150, rowY: () => 100 },
      },
      setViewport(_tx, _ty, k) {
        lastK = k;
      },
      moveTable() {},
    };

    const interaction = createInteraction(container);
    interaction.attach(mockHandle);

    expect(lastK).toBe(1);

    // Dispatch ctrl+wheel zoom in event (deltaY = -100)
    const event = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -100,
      clientX: 500,
      clientY: 400,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    const expectedK = Math.min(zoomMax, Math.max(zoomMin, 1 * Math.exp(100 * wheelZoomK)));
    expect(lastK).toBeCloseTo(expectedK, 4);
    expect(lastK).toBeGreaterThan(1.5); // Verify zooming is fast (> 1.5x scale on -100 delta)

    interaction.destroy();
  });

  it('normalizes DOM_DELTA_LINE wheel events correctly', () => {
    let lastK = 1;

    const mockHandle: RenderHandle = {
      svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      geometry: {},
      setViewport(_tx, _ty, k) {
        lastK = k;
      },
      moveTable() {},
    };

    const interaction = createInteraction(container);
    interaction.attach(mockHandle);

    const event = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      clientX: 500,
      clientY: 400,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    // -3 lines * 16 = -48 px
    const expectedK = Math.min(zoomMax, Math.max(zoomMin, 1 * Math.exp(48 * wheelZoomK)));
    expect(lastK).toBeCloseTo(expectedK, 4);

    interaction.destroy();
  });
});
