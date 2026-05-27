import { fuzzyLayoutsEqual } from './fuzzy-layouts-equal.ts';
import { fuzzyCompareNumbers, fuzzyNumbersEqual } from './fuzzy-numbers.ts';
import { resizePanel } from './resize-panel.ts';
import type { ResizablePanelConstraints } from './types.ts';

export function adjustLayoutByDelta({
  delta,
  initialLayout,
  panelConstraints: panelConstraintsArray,
  pivotIndices,
  prevLayout,
}: {
  delta: number;
  initialLayout: number[];
  panelConstraints: ResizablePanelConstraints[];
  pivotIndices: number[];
  prevLayout: number[];
}): number[] {
  if (fuzzyNumbersEqual(delta, 0)) {
    return initialLayout;
  }

  const nextLayout = [...initialLayout];

  const [firstPivotIndex, secondPivotIndex] = pivotIndices;
  if (firstPivotIndex == null || secondPivotIndex == null) {
    throw new Error('invalid pivot index');
  }

  let deltaApplied = 0;

  // A resizing panel affects the panels before or after it.
  //
  // A negative delta means the panel(s) immediately after the resize handle should grow/expand by decreasing its offset.
  // Other panels may also need to shrink/contract (and shift) to make room, depending on the min weights.
  //
  // A positive delta means the panel(s) immediately before the resize handle should "expand".
  // This is accomplished by shrinking/contracting (and shifting) one or more of the panels after the resize handle.

  {
    // Pre-calculate max available delta in the opposite direction of our pivot.
    // This will be the maximum amount we're allowed to expand/contract the panels in the primary direction.
    // If this amount is less than the requested delta, adjust the requested delta.
    // If this amount is greater than the requested delta, that's useful information too–
    // as an expanding panel might change from collapsed to min size.

    const increment = delta < 0 ? 1 : -1;

    let index = delta < 0 ? secondPivotIndex : firstPivotIndex;
    let maxAvailableDelta = 0;

    // DEBUG.push("pre calc...");
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const prevSize = initialLayout[index];
      if (prevSize == null) {
        throw new Error(`Previous layout not found for panel index ${index}`);
      }

      const maxSafeSize = resizePanel({
        panelConstraints: panelConstraintsArray,
        panelIndex: index,
        size: 100,
      });
      const delta = maxSafeSize - prevSize;
      maxAvailableDelta += delta;
      index += increment;

      if (index < 0 || index >= panelConstraintsArray.length) {
        break;
      }
    }

    const minAbsDelta = Math.min(Math.abs(delta), Math.abs(maxAvailableDelta));
    delta = delta < 0 ? 0 - minAbsDelta : minAbsDelta;
  }

  {
    // WORKAROUND: For a collapsed panel, we need to adjust the delta to the minimum size.
    // TODO: Address the following inconsistent behaviors:
    // - When dragging outward on a collapsed panel, it opens the panel, but dragging inward does not collapse it again.
    //   The behavior should match that of dragging an opened panel where the cursor delta reaches the panel's minimum size.
    // - When dragging an opened panel inward and the delta reaches the panel's minimum size, the panel collapses.
    //   However, if you continue dragging outward, it does not reopen as it does in the first scenario.
    const pivotIndex = delta < 0 ? secondPivotIndex : firstPivotIndex;

    const initSize = initialLayout[pivotIndex];
    if (initSize == null) {
      throw new Error(
        `Previous layout not found for panel index ${pivotIndex}`,
      );
    }

    const prevSize = prevLayout[pivotIndex];
    if (prevSize == null) {
      throw new Error(
        `Previous layout not found for panel index ${pivotIndex}`,
      );
    }

    let minSize = panelConstraintsArray[pivotIndex]?.minSize;
    if (
      (initSize == 0 || prevSize == 0) &&
      minSize != null &&
      fuzzyCompareNumbers(Math.abs(delta), minSize) < 0
    ) {
      delta = delta >= 0 ? minSize : 0 - minSize;
    }
  }

  {
    // Delta added to a panel needs to be subtracted from other panels (within the constraints that those panels allow).

    const pivotIndex = delta < 0 ? firstPivotIndex : secondPivotIndex;
    let index = pivotIndex;
    while (index >= 0 && index < panelConstraintsArray.length) {
      const deltaRemaining = Math.abs(delta) - Math.abs(deltaApplied);

      const prevSize = initialLayout[index];
      if (prevSize == null) {
        throw new Error(`Previous layout not found for panel index ${index}`);
      }

      const unsafeSize = prevSize - deltaRemaining;
      const safeSize = resizePanel({
        panelConstraints: panelConstraintsArray,
        panelIndex: index,
        size: unsafeSize,
      });

      if (!fuzzyNumbersEqual(prevSize, safeSize)) {
        deltaApplied += prevSize - safeSize;

        nextLayout[index] = safeSize;

        if (
          deltaApplied
            .toPrecision(3)
            .localeCompare(Math.abs(delta).toPrecision(3), undefined, {
              numeric: true,
            }) >= 0
        ) {
          break;
        }
      }

      if (delta < 0) {
        index--;
      } else {
        index++;
      }
    }
  }

  // If we were unable to resize any of the panels panels, return the previous state.
  // This will essentially bailout and ignore e.g. drags past a panel's boundaries
  if (fuzzyLayoutsEqual(prevLayout, nextLayout)) {
    return prevLayout;
  }

  {
    // Now distribute the applied delta to the panels in the other direction
    const pivotIndex = delta < 0 ? secondPivotIndex : firstPivotIndex;

    const prevSize = initialLayout[pivotIndex];
    if (prevSize == null) {
      throw new Error(
        `Previous layout not found for panel index ${pivotIndex}`,
      );
    }

    const unsafeSize = prevSize + deltaApplied;
    const safeSize = resizePanel({
      panelConstraints: panelConstraintsArray,
      panelIndex: pivotIndex,
      size: unsafeSize,
    });

    // Adjust the pivot panel before, but only by the amount that surrounding panels were able to shrink/contract.
    nextLayout[pivotIndex] = safeSize;

    // Edge case where expanding or contracting one panel caused another one to change collapsed state
    if (!fuzzyNumbersEqual(safeSize, unsafeSize)) {
      let deltaRemaining = unsafeSize - safeSize;

      const pivotIndex = delta < 0 ? secondPivotIndex : firstPivotIndex;
      let index = pivotIndex;
      while (index >= 0 && index < panelConstraintsArray.length) {
        const prevSize = nextLayout[index];
        if (prevSize == null) {
          throw new Error(
            `Previous layout not found for panel index ${pivotIndex}`,
          );
        }

        const unsafeSize = prevSize + deltaRemaining;
        const safeSize = resizePanel({
          panelConstraints: panelConstraintsArray,
          panelIndex: index,
          size: unsafeSize,
        });

        if (!fuzzyNumbersEqual(prevSize, safeSize)) {
          deltaRemaining -= safeSize - prevSize;

          nextLayout[index] = safeSize;
        }

        if (fuzzyNumbersEqual(deltaRemaining, 0)) {
          break;
        }

        if (delta > 0) {
          index--;
        } else {
          index++;
        }
      }
    }
  }

  const totalSize = nextLayout.reduce((total, size) => size + total, 0);

  // If our new layout doesn't add up to 100%, that means the requested delta can't be applied
  // In that case, fall back to our most recent valid layout
  if (!fuzzyNumbersEqual(totalSize, 100)) {
    return prevLayout;
  }

  return nextLayout;
}
