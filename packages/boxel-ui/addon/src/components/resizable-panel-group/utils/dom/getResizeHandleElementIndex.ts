import { getResizeHandleElementsForGroup } from './getResizeHandleElementsForGroup.ts';

export function getResizeHandleElementIndex(
  groupId: string,
  id: string,
  scope: ParentNode | HTMLElement = document,
): number | null {
  const handles = getResizeHandleElementsForGroup(groupId, scope);
  const index = handles.findIndex(
    (handle: HTMLElement) =>
      handle.getAttribute('data-boxel-panel-resize-handle-id') === id,
  );
  return index ?? null;
}
