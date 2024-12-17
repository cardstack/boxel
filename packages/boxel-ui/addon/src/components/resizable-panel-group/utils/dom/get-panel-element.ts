export function getPanelElement(
  id: string,
  scope: ParentNode | HTMLElement = document,
): HTMLElement | null {
  const element = scope.querySelector(`[data-boxel-panel-id="${id}"]`);
  if (element) {
    return element as HTMLElement;
  }
  return null;
}
