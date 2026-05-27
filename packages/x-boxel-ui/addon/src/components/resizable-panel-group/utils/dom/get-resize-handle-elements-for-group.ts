export function getResizeHandleElementsForGroup(
  groupId: string,
  scope: ParentNode | HTMLElement = document,
): HTMLElement[] {
  return Array.from(
    scope.querySelectorAll(
      `[data-boxel-panel-resize-handle-id][data-boxel-panel-group-id="${groupId}"]`,
    ),
  );
}
