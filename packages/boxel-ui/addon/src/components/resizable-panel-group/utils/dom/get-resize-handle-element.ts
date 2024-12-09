export function getResizeHandleElement(
  id: string,
  scope: ParentNode | HTMLElement = document,
): HTMLElement | null {
  const element = scope.querySelector(
    `[data-boxel-panel-resize-handle-id="${id}"]`,
  );
  if (element) {
    return element as HTMLElement;
  }
  return null;
}
