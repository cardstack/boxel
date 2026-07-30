export function getPanelGroupElement(
  id: string,
  rootElement: ParentNode | HTMLElement = document,
): HTMLElement | null {
  //If the root element is the PanelGroup
  if (
    rootElement instanceof HTMLElement &&
    (rootElement as HTMLElement)?.hasAttribute('data-boxel-panel-group')
  ) {
    return rootElement as HTMLElement;
  }

  //Else query children
  const element = rootElement.querySelector(
    `[data-boxel-panel-group][data-boxel-panel-group-id="${id}"]`,
  );
  if (element) {
    return element as HTMLElement;
  }
  return null;
}
