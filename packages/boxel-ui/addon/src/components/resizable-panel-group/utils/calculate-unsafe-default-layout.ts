import type { ResizablePanelConstraints } from './types.ts';

export function calculateUnsafeDefaultLayout({
  panels,
}: {
  panels: {
    constraints: ResizablePanelConstraints;
  }[];
}): number[] {
  const layout = Array<number>(panels.length);

  const panelConstraintsArray = panels.map((panel) => panel.constraints);

  let numPanelsWithSizes = 0;
  let remainingSize = 100;

  // Distribute default sizes first
  for (let index = 0; index < panels.length; index++) {
    const panelConstraints = panelConstraintsArray[index];
    if (!panelConstraints) {
      throw new Error(`Panel constraints not found for index ${index}`);
    }
    const { defaultSize } = panelConstraints;

    if (defaultSize != null) {
      numPanelsWithSizes++;
      layout[index] = defaultSize;
      remainingSize -= defaultSize;
    }
  }

  // Remaining size should be distributed evenly between panels without default sizes
  for (let index = 0; index < panels.length; index++) {
    const panelConstraints = panelConstraintsArray[index];
    if (!panelConstraints) {
      throw new Error(`Panel constraints not found for index ${index}`);
    }
    const { defaultSize } = panelConstraints;

    if (defaultSize != null) {
      continue;
    }

    const numRemainingPanels = panels.length - numPanelsWithSizes;
    const size = remainingSize / numRemainingPanels;

    numPanelsWithSizes++;
    layout[index] = size;
    remainingSize -= size;
  }

  return layout;
}
