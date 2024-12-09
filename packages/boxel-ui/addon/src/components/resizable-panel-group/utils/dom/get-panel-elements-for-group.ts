export function getPanelElementsForGroup(
  groupId: string,
  scope: ParentNode | HTMLElement = document,
): HTMLElement[] {
  return Array.from(
    scope.querySelectorAll(`[data-boxel-panel-group-id="${groupId}"]`),
  );
}
