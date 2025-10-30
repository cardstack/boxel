export const CurrentRoomIdPersistenceKey = 'aiPanelCurrentRoomId';
export const NewSessionIdPersistenceKey = 'aiPanelNewSessionId';
export const AiAssistantPanelWidth = 'ai-assistant-panel-width';
export const CodeModePanelWidths = 'code-mode-panel-widths';
export const CodeModePanelHeights = 'code-mode-panel-heights';
export const ModuleInspectorSelections = 'code-mode-panel-selections';
export const SessionLocalStorageKey = 'boxel-session';
export const AiAssistantMessageDrafts = 'ai-assistant-message-drafts';
export const PlaygroundSelections = 'playground-selections';
export const SpecSelection = 'spec-selection';
export const RecentCards = 'recent-cards';
export const RecentFiles = 'recent-files';
export const ScrollPositions = 'scroll-positions';

export function clearLocalStorage(storage: Storage | undefined) {
  storage?.removeItem(CurrentRoomIdPersistenceKey);
  storage?.removeItem(NewSessionIdPersistenceKey);
  storage?.removeItem(AiAssistantPanelWidth);
  storage?.removeItem(CodeModePanelWidths);
  storage?.removeItem(CodeModePanelHeights);
  storage?.removeItem(ModuleInspectorSelections);
  storage?.removeItem(PlaygroundSelections);
  storage?.removeItem(RecentCards);
  storage?.removeItem(RecentFiles);
  storage?.removeItem(ScrollPositions);
  storage?.removeItem(AiAssistantMessageDrafts);
}
