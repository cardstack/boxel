import window from 'ember-window-mock';

export const CurrentRoomIdPersistenceKey = 'aiPanelCurrentRoomId';
export const NewSessionIdPersistenceKey = 'aiPanelNewSessionId';
export const CodeModePanelWidths = 'code-mode-panel-widths';
export const CodeModePanelHeights = 'code-mode-panel-heights';
export const CodeModePanelSelections = 'code-mode-panel-selections';
export const SessionLocalStorageKey = 'boxel-session';
export const PlaygroundSelections = 'playground-selections';
export const SpecSelection = 'spec-selection';
export const RecentCards = 'recent-cards';
export const RecentFiles = 'recent-files';
export const ScrollPositions = 'scroll-positions';

export function clearLocalStorage() {
  window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
  window.localStorage.removeItem(NewSessionIdPersistenceKey);
  window.localStorage.removeItem(CodeModePanelWidths);
  window.localStorage.removeItem(CodeModePanelHeights);
  window.localStorage.removeItem(CodeModePanelSelections);
  window.localStorage.removeItem(PlaygroundSelections);
  window.localStorage.removeItem(RecentCards);
  window.localStorage.removeItem(RecentFiles);
  window.localStorage.removeItem(ScrollPositions);
  // Remove all codeblock_ prefixed items
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith('codeblock_'))
    .forEach((key) => window.localStorage.removeItem(key));
}
