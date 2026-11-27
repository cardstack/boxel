export const CurrentRoomIdPersistenceKey = 'aiPanelCurrentRoomId';
export const NewSessionIdPersistenceKey = 'aiPanelNewSessionId';
// The AI Assistant's width in px, saved only when the user resizes it.
export const AiAssistantPanelWidth = 'ai-assistant-panel-width-px';
// The width as a share of the window, which older versions saved. Nothing
// reads it, since it mixes widths the user chose with ones the app chose.
export const LegacyAiAssistantPanelWidth = 'ai-assistant-panel-width';
export const AiAssistantOpen = 'boxel-ai-assistant-open';
export const CodeModePanelWidths = 'code-mode-panel-widths';
export const CodeModePanelHeights = 'code-mode-panel-heights';
export const ModuleInspectorSelections = 'code-mode-panel-selections';
export const SessionLocalStorageKey = 'boxel-session';
export const RealmServerSessionLocalStorageKey = 'boxel-realm-server-session';
export const AiAssistantMessageDrafts = 'ai-assistant-message-drafts';
export const AiAssistantPendingSends = 'ai-assistant-pending-sends';
export const PlaygroundSelections = 'playground-selections';
export const SpecSelection = 'spec-selection';
export const RecentCards = 'recent-cards';
export const RecentFiles = 'recent-files';
export const ScrollPositions = 'scroll-positions';

export function clearLocalStorage(storage: Storage | undefined) {
  storage?.removeItem(CurrentRoomIdPersistenceKey);
  storage?.removeItem(NewSessionIdPersistenceKey);
  storage?.removeItem(AiAssistantPanelWidth);
  storage?.removeItem(LegacyAiAssistantPanelWidth);
  storage?.removeItem(CodeModePanelWidths);
  storage?.removeItem(CodeModePanelHeights);
  storage?.removeItem(ModuleInspectorSelections);
  storage?.removeItem(PlaygroundSelections);
  storage?.removeItem(RecentCards);
  storage?.removeItem(RecentFiles);
  storage?.removeItem(ScrollPositions);
  storage?.removeItem(AiAssistantMessageDrafts);
  storage?.removeItem(AiAssistantPendingSends);
  storage?.removeItem(AiAssistantOpen);
}
