import { assert } from './assert.ts';
import { PRECISION } from './const.ts';
import { fuzzyCompareNumbers } from './fuzzyNumbers.ts';
import type { ResizablePanelConstraints } from './types.ts';

export function resizePanel({
  panelConstraints: panelConstraintsArray,
  panelIndex,
  size,
}: {
  panelConstraints: ResizablePanelConstraints[];
  panelIndex: number;
  size: number;
}) {
  const panelConstraints = panelConstraintsArray[panelIndex];
  assert(
    panelConstraints != null,
    `Panel constraints not found for index ${panelIndex}`,
  );

  let { collapsible, maxSize = 100, minSize = 0 } = panelConstraints;

  if (fuzzyCompareNumbers(size, minSize) < 0) {
    if (collapsible) {
      size = 0;
    } else {
      size = minSize;
    }
  }

  size = Math.min(maxSize, size);
  size = parseFloat(size.toFixed(PRECISION));

  return size;
}
