import { fuzzyNumbersEqual } from './fuzzy-numbers.ts';
import { resizePanel } from './resize-panel.ts';
import type { ResizablePanelConstraints } from './types.ts';

export function validatePanelGroupLayout({
  layout: prevLayout,
  panelConstraints,
}: {
  layout: number[];
  panelConstraints: ResizablePanelConstraints[];
}): number[] {
  const nextLayout = [...prevLayout];
  const nextLayoutTotalSize = nextLayout.reduce(
    (accumulated, current) => accumulated + current,
    0,
  );

  // Validate layout expectations
  if (nextLayout.length !== panelConstraints.length) {
    throw Error(
      `Invalid ${panelConstraints.length} panel layout: ${nextLayout
        .map((size) => `${size}%`)
        .join(', ')}`,
    );
  } else if (!fuzzyNumbersEqual(nextLayoutTotalSize, 100)) {
    for (let index = 0; index < panelConstraints.length; index++) {
      const unsafeSize = nextLayout[index];
      if (unsafeSize == null) {
        throw new Error(`No layout data found for index ${index}`);
      }
      const safeSize = (100 / nextLayoutTotalSize) * unsafeSize;
      nextLayout[index] = safeSize;
    }
  }

  let remainingSize = 0;

  // First pass: Validate the proposed layout given each panel's constraints
  for (let index = 0; index < panelConstraints.length; index++) {
    const unsafeSize = nextLayout[index];
    if (unsafeSize == null) {
      throw new Error(`No layout data found for index ${index}`);
    }

    const safeSize = resizePanel({
      panelConstraints,
      panelIndex: index,
      size: unsafeSize,
    });

    if (unsafeSize != safeSize) {
      remainingSize += unsafeSize - safeSize;

      nextLayout[index] = safeSize;
    }
  }

  // If there is additional, left over space, assign it to any panel(s) that permits it
  // (It's not worth taking multiple additional passes to evenly distribute)
  if (!fuzzyNumbersEqual(remainingSize, 0)) {
    for (let index = 0; index < panelConstraints.length; index++) {
      const prevSize = nextLayout[index];
      if (prevSize == null) {
        throw new Error(`No layout data found for index ${index}`);
      }
      const unsafeSize = prevSize + remainingSize;
      const safeSize = resizePanel({
        panelConstraints,
        panelIndex: index,
        size: unsafeSize,
      });

      if (prevSize !== safeSize) {
        remainingSize -= safeSize - prevSize;
        nextLayout[index] = safeSize;

        // Once we've used up the remainder, bail
        if (fuzzyNumbersEqual(remainingSize, 0)) {
          break;
        }
      }
    }
  }

  return nextLayout;
}
