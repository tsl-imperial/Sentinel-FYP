/**
 * R8 (mandatory regression) — DockedPanel mount/unmount under React 19
 * StrictMode without throwing.
 *
 * The DockedPanel is the substrate for 3 mount sources in the workbench
 * (extraction state, road inspector, welcome card). React 19 strict-mode
 * double-mounts every effect once, and the close-button focus + ESC
 * keyboard listener both run inside useEffect. If either of those don't
 * clean up properly, mounting twice in a row throws ("listener already
 * attached" or similar).
 *
 * This test locks the contract structurally identical to R5/R6 (MapView)
 * and R7 (usePolygonDraw): mount under StrictMode → no throw, unmount →
 * no throw, ESC handler is removed from window on unmount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';

import { DockedPanel } from './DockedPanel';

describe('DockedPanel (R8)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('R8: mount + unmount under StrictMode does not throw', () => {
    expect(() => {
      const { unmount } = render(
        <StrictMode>
          <DockedPanel title="Test" titleId="test-id" onClose={() => {}}>
            <div>content</div>
          </DockedPanel>
        </StrictMode>,
      );
      unmount();
    }).not.toThrow();
  });

  it('R8: ESC keyboard listener is removed from window on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <DockedPanel title="Test" titleId="test-id" onClose={() => {}}>
        <div>content</div>
      </DockedPanel>,
    );

    const keydownAdds = addSpy.mock.calls.filter((c) => c[0] === 'keydown');
    expect(keydownAdds.length).toBeGreaterThan(0);

    unmount();

    const keydownRemoves = removeSpy.mock.calls.filter((c) => c[0] === 'keydown');
    expect(keydownRemoves.length).toBe(keydownAdds.length);

    // The handler reference passed to remove must match the one passed to add.
    for (const addCall of keydownAdds) {
      const handler = addCall[1];
      expect(removeSpy).toHaveBeenCalledWith('keydown', handler);
    }

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('R8: close button click fires onClose', () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <DockedPanel title="Test" titleId="test-id" onClose={onClose}>
        <div>content</div>
      </DockedPanel>,
    );
    const closeBtn = getByRole('button', { name: /close panel/i });
    closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('R8: role="dialog" + aria-labelledby attached', () => {
    const { getByRole } = render(
      <DockedPanel title="My title" titleId="my-title-id" onClose={() => {}}>
        <div>content</div>
      </DockedPanel>,
    );
    const dialog = getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-labelledby', 'my-title-id');
    expect(dialog).toHaveAttribute('aria-modal', 'false');
  });
});
