import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { allSettled, restartableTask } from 'ember-concurrency';
import { timeout } from 'ember-concurrency';

import window from 'ember-window-mock';

import { isCardInstance } from '@cardstack/runtime-common';
import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_LLM_MODE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_FALLBACK_MODEL_ID,
  type LLMMode,
} from '@cardstack/runtime-common/matrix-constants';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import type * as CommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import CreateAiAssistantRoomCommand from '../commands/create-ai-assistant-room';
import SummarizeSessionCommand from '../commands/summarize-session';
import UpdateRoomSkillsCommand from '../commands/update-room-skills';

import { Submodes } from '../components/submode-switcher';
import { isMatrixError } from '../lib/matrix-utils';
import { importResource } from '../resources/import';
import { NewSessionIdPersistenceKey } from '../utils/local-storage-keys';

import { titleize } from '../utils/titleize';

import { DEFAULT_MODULE_INSPECTOR_VIEW } from './operator-mode-state-service';

import type CodeSemanticsService from './code-semantics-service';
import type CommandService from './command-service';
import type LocalPersistenceService from './local-persistence-service';
import type MatrixService from './matrix-service';
import type MonacoService from './monaco-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type ResetService from './reset';
import type StoreService from './store';
import type { Message } from '../lib/matrix-classes/message';

export interface SessionRoomData {
  roomId: string;
  name: string;
  lastMessage: Message | undefined;
  created: Date;
  lastActiveTimestamp: number;
}

export default class AiAssistantPanelService extends Service {
  @service declare private codeSemanticsService: CodeSemanticsService;
  @service declare private commandService: CommandService;
  @service declare private matrixService: MatrixService;
  @service declare private monacoService: MonacoService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private localPersistenceService: LocalPersistenceService;
  @service declare private reset: ResetService;
  @service declare private store: StoreService;

  @tracked displayRoomError = false;
  @tracked isShowingPastSessions = false;
  // Rooms the user has explicitly deleted this session. Used to filter
  // aiSessionRooms because sync events can re-add deleted rooms to the
  // cache before the leave event propagates through the room state.
  private deletedRoomIds = new Set<string>();
  @tracked roomToRename: SessionRoomData | undefined = undefined;
  @tracked roomToDelete: { id: string; name: string } | undefined = undefined;
  @tracked roomDeleteError: string | undefined = undefined;

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
    this.resetState();
    if (this.isOpen) {
      this.loadRoomsTask.perform();
    }
  }

  resetState() {
    this.displayRoomError = false;
    this.isShowingPastSessions = false;
    this.roomToRename = undefined;
    this.roomToDelete = undefined;
    this.roomDeleteError = undefined;
    this.deletedRoomIds.clear();
    window.localStorage.removeItem(NewSessionIdPersistenceKey);
    this.loadRoomsTask.cancelAll();
    this.doCreateRoom.cancelAll();
    this.summarizeSessionTask.cancelAll();
    this.copyFileHistoryTask.cancelAll();
    this.prepareSessionContextTask.cancelAll();
  }

  private commandModuleResource = importResource(
    this,
    () => 'https://cardstack.com/base/command',
  );

  get commandModule() {
    if (this.commandModuleResource.error) {
      throw new Error(
        `Error loading commandModule: ${JSON.stringify(this.commandModuleResource.error)}`,
      );
    }
    if (!this.commandModuleResource.module) {
      throw new Error(
        `bug: SkillConfigField has not loaded yet--make sure to await this.loaded before using the api`,
      );
    }
    return this.commandModuleResource.module as typeof CommandModule;
  }

  get isAiAssistantHidden() {
    return this.operatorModeStateService.state.submode === Submodes.Host;
  }

  get isOpen() {
    return (
      this.operatorModeStateService.aiAssistantOpen && !this.isAiAssistantHidden
    );
  }

  get isFocusPillVisible() {
    return !!this.focusPillLabel;
  }

  get focusPillLabel() {
    if (this.operatorModeStateService.state.submode !== Submodes.Code) {
      return undefined;
    }
    let selectedCodeRef = this.codeSemanticsService.selectedCodeRef;
    if (selectedCodeRef?.name) {
      return selectedCodeRef?.name;
    }
    if (this.operatorModeStateService.isViewingCardInCodeMode) {
      return 'Card';
    }
    return undefined;
  }

  get focusPillItemType() {
    if (this.operatorModeStateService.isViewingCardInCodeMode) {
      return undefined;
    }

    return titleize(
      this.operatorModeStateService.state.moduleInspector ??
        DEFAULT_MODULE_INSPECTOR_VIEW,
    );
  }

  get focusPillFormat(): string | undefined {
    const format: Format | undefined =
      this.operatorModeStateService.currentViewingFormat;
    if (!format) {
      return undefined;
    }

    // Capitalize the format name for display
    return titleize(format);
  }

  get focusPillCodeRange() {
    let selection = this.monacoService.trackedSelection;
    if (!selection) {
      return undefined;
    }

    // Check if there's an actual selection (not just cursor position)
    const hasSelection =
      selection.startLineNumber !== selection.endLineNumber ||
      selection.startColumn !== selection.endColumn;

    if (!hasSelection) {
      return undefined;
    }

    if (selection.startLineNumber === selection.endLineNumber) {
      return `Line ${selection.startLineNumber}`;
    }
    return `Lines ${selection.startLineNumber}-${selection.endLineNumber}`;
  }

  get focusPillMetaPills(): string[] {
    const metaPills: string[] = [];

    const itemType = this.focusPillItemType;
    if (itemType) {
      metaPills.push(itemType);
    }

    // Add format information when viewing cards
    const format = this.focusPillFormat;
    if (format) {
      metaPills.push(format);
    }

    const codeRange = this.focusPillCodeRange;
    if (codeRange) {
      metaPills.push(codeRange);
    }

    return metaPills;
  }

  @action
  openPanel() {
    this.operatorModeStateService.openAiAssistant();
    return this.loadRoomsTask.perform();
  }

  @action
  closePanel() {
    this.operatorModeStateService.closeAiAssistant();
  }

  @action
  displayPastSessions() {
    this.isShowingPastSessions = true;
  }

  @action
  hidePastSessions() {
    this.isShowingPastSessions = false;
  }

  @action
  enterRoom(roomId: string, hidePastSessionsList = true) {
    this.matrixService.currentRoomId = roomId;

    this.localPersistenceService.setCurrentRoomId(roomId);
    if (hidePastSessionsList) {
      this.hidePastSessions();
    }
  }

  @action
  async createNewSession(
    opts: {
      addSameSkills: boolean;
      shouldCopyFileHistory: boolean;
      shouldSummarizeSession: boolean;
      deferDefaultSkills?: boolean;
    } = {
      addSameSkills: false,
      shouldCopyFileHistory: false,
      shouldSummarizeSession: false,
    },
  ) {
    this.displayRoomError = false;
    if (
      this.newSessionId &&
      !opts.addSameSkills &&
      !opts.shouldSummarizeSession &&
      !opts.shouldCopyFileHistory
    ) {
      this.enterRoom(this.newSessionId);
      return;
    }

    await this.doCreateRoom.perform('New AI Assistant Chat', opts);
  }

  private get newSessionId() {
    let id = window.localStorage.getItem(NewSessionIdPersistenceKey);
    if (
      id &&
      this.matrixService.roomResources.has(id) &&
      this.matrixService.roomResources.get(id)?.messages.length === 0
    ) {
      return id;
    }
    return undefined;
  }

  get isCreateRoomIdle() {
    return this.doCreateRoom.isIdle;
  }

  get currentRoomResource() {
    if (!this.matrixService.currentRoomId) {
      return undefined;
    }
    return this.matrixService.roomResources.get(
      this.matrixService.currentRoomId,
    );
  }

  // The current room's skills as ids (the fileDefs' sourceUrls), for the
  // "add same skills" flow. Id-based so it carries both `.md` skill files and
  // legacy `Skill` cards; room creation re-resolves each id kind-agnostically.
  private extractSkillIdsFromCurrentRoom(): {
    enabledSkillIds: string[];
    disabledSkillIds: string[];
  } {
    let skillConfig = this.currentRoomResource?.matrixRoom?.skillsConfig;
    let toIds = (fileDefs: { sourceUrl?: string }[] | undefined): string[] =>
      (fileDefs ?? [])
        .map((fileDef) => fileDef.sourceUrl)
        .filter((id): id is string => Boolean(id));
    return {
      enabledSkillIds: toIds(skillConfig?.enabledSkillCards),
      disabledSkillIds: toIds(skillConfig?.disabledSkillCards),
    };
  }

  private getPreferredLLMMode(): LLMMode | undefined {
    let currentMode = this.currentRoomResource?.activeLLMMode;
    if (currentMode) {
      return currentMode;
    }

    let latestRoom = this.latestRoom;
    if (!latestRoom) {
      return undefined;
    }

    return this.matrixService.roomResources.get(latestRoom.roomId)
      ?.activeLLMMode;
  }

  private collectFileHistory(roomId: string): {
    attachedFiles: FileDef[];
    attachedCards: CardDef[];
  } {
    if (!roomId) {
      return { attachedFiles: [], attachedCards: [] };
    }

    const roomResource = this.matrixService.roomResources.get(roomId);
    if (!roomResource) {
      return { attachedFiles: [], attachedCards: [] };
    }

    const seenFileUrls = new Set<string>();
    const seenCardUrls = new Set<string>();
    const attachedFiles: FileDef[] = [];
    const attachedCards: CardDef[] = [];

    // Iterate through all messages in the current room
    for (const message of roomResource.messages) {
      // Collect attached files
      if (message.attachedFiles) {
        for (const file of message.attachedFiles) {
          if (file.sourceUrl && !seenFileUrls.has(file.sourceUrl)) {
            seenFileUrls.add(file.sourceUrl);
            attachedFiles.push(file);
          }
        }
      }

      // Collect attached cards (using sourceUrl from the message's attachedCardIds)
      if (message.attachedCardIds) {
        for (const cardId of message.attachedCardIds) {
          if (cardId && !seenCardUrls.has(cardId)) {
            seenCardUrls.add(cardId);
            // We need to get the actual card from the store
            const card = this.store.peek<CardDef>(cardId);
            if (card && isCardInstance(card)) {
              attachedCards.push(card);
            }
          }
        }
      }
    }

    return { attachedFiles, attachedCards };
  }

  private doCreateRoom = restartableTask(
    async (
      name: string = 'New AI Assistant Chat',
      opts: {
        addSameSkills: boolean;
        shouldCopyFileHistory: boolean;
        shouldSummarizeSession: boolean;
        deferDefaultSkills?: boolean;
      },
    ) => {
      let {
        addSameSkills,
        shouldCopyFileHistory,
        shouldSummarizeSession,
        deferDefaultSkills,
      } = opts;
      try {
        let roomId: string;
        let oldRoomId = this.matrixService.currentRoomId;

        if (deferDefaultSkills) {
          // Fast path: create room directly without going through the
          // command system (which loads a JS module from the realm server
          // that can hang on 404s). Skills are applied in the background.
          roomId = await this.createFallbackRoom(name);
        } else {
          let createRoomCommand = new CreateAiAssistantRoomCommand(
            this.commandService.commandContext,
          );

          let input: any = { name };
          let llmMode = this.getPreferredLLMMode();
          if (llmMode) {
            input.llmMode = llmMode;
          }
          let enabledSkillIds: string[] = [];
          let disabledSkillIds: string[] = [];

          if (addSameSkills) {
            ({ enabledSkillIds, disabledSkillIds } =
              this.extractSkillIdsFromCurrentRoom());
          }

          if (enabledSkillIds.length || disabledSkillIds.length) {
            input.enabledSkillIds = enabledSkillIds;
            input.disabledSkillIds = disabledSkillIds;
          } else {
            // Use default skills (ids; may name `.md` skill files or cards)
            input.enabledSkillIds = await this.matrixService.loadDefaultSkills(
              this.operatorModeStateService.state.submode,
            );
          }

          ({ roomId } = await createRoomCommand.execute(input));
        }

        window.localStorage.setItem(NewSessionIdPersistenceKey, roomId);

        // Enter room immediately
        this.enterRoom(roomId);

        // Load default skills in the background after room creation
        if (deferDefaultSkills) {
          this.applyDefaultSkillsToRoom(roomId);
        }

        // Start background tasks for session preparation
        if (oldRoomId && (shouldSummarizeSession || shouldCopyFileHistory)) {
          this.prepareSessionContextTask.perform(oldRoomId, roomId, {
            shouldSummarizeSession,
            shouldCopyFileHistory,
          });
        }
      } catch (e) {
        console.error(e);
        this.displayRoomError = true;
      }

      return undefined;
    },
  );

  private async createFallbackRoom(name: string): Promise<string> {
    let userId = this.matrixService.userId;
    if (!userId) {
      throw new Error('Requires userId to create a fallback room');
    }
    let aiBotFullId = this.matrixService.aiBotUserId;
    let llmMode = this.getPreferredLLMMode();
    let systemCard = this.matrixService.systemCard;
    let configuration =
      systemCard?.defaultModelConfiguration ??
      systemCard?.modelConfigurations?.[0];

    let roomPromise = this.matrixService.createRoom({
      preset: this.matrixService.privateChatPreset,
      invite: [aiBotFullId],
      name,
      room_alias_name: encodeURIComponent(
        `${name} - ${new Date().toISOString()} - ${userId}`,
      ),
      power_level_content_override: {
        users: {
          [userId]: 100,
          [aiBotFullId]: this.matrixService.aiBotPowerLevel,
        },
      },
      initial_state: [
        {
          type: APP_BOXEL_ACTIVE_LLM,
          content: {
            model: configuration?.modelId ?? DEFAULT_FALLBACK_MODEL_ID,
            toolsSupported: Boolean(configuration?.toolsSupported),
            reasoningEffort: configuration?.reasoningEffort ?? undefined,
          },
        },
        {
          type: APP_BOXEL_LLM_MODE,
          content: { mode: llmMode || 'ask' },
        },
        {
          type: APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
          content: {
            enabledSkillCards: [],
            disabledSkillCards: [],
            commandDefinitions: [],
          },
        },
      ],
    });
    let timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Room creation timed out waiting for sync')),
        30_000,
      ),
    );
    let { room_id: roomId } = await Promise.race([roomPromise, timeoutPromise]);
    return roomId;
  }

  private async applyDefaultSkillsToRoom(roomId: string) {
    try {
      let skillIds = await this.matrixService.loadDefaultSkills(
        this.operatorModeStateService.state.submode,
      );
      if (!skillIds.length) {
        return;
      }
      // Kind-agnostic: `UpdateRoomSkillsCommand` resolves each id to a `.md`
      // skill file or a legacy `Skill` card, uploads it, and populates the
      // room's skills config + command definitions.
      let updateRoomSkillsCommand = new UpdateRoomSkillsCommand(
        this.commandService.commandContext,
      );
      await updateRoomSkillsCommand.execute({
        roomId,
        skillCardIdsToActivate: skillIds,
      });
    } catch (e) {
      console.error('Failed to apply default skills to room:', e);
    }
  }

  // Background tasks for session preparation
  private summarizeSessionTask = restartableTask(
    async (oldRoomId: string, newRoomId: string) => {
      try {
        const summarizeCommand = new SummarizeSessionCommand(
          this.commandService.commandContext,
        );
        const result = await summarizeCommand.execute({
          roomId: oldRoomId,
        });
        if (!result.summary) {
          return;
        }

        const messageContent = `This is a summary of the previous conversation that should be included as context for our discussion:\n\n${result.summary}`;

        await this.matrixService.sendMessage(newRoomId, messageContent, [], []);
      } catch (error) {
        console.error('Failed to summarize session:', error);
      }
    },
  );

  private copyFileHistoryTask = restartableTask(
    async (oldRoomId: string, roomId: string) => {
      try {
        const fileHistory = this.collectFileHistory(oldRoomId);
        const { attachedCards, attachedFiles } = fileHistory;

        if (attachedFiles.length > 0 || attachedCards.length > 0) {
          const messageContent =
            'This session includes files and cards from the previous conversation for context.';

          await this.matrixService.sendMessage(
            roomId,
            messageContent,
            attachedCards,
            attachedFiles,
          );
        }
      } catch (error) {
        console.error('Failed to copy file history:', error);
      }
    },
  );

  private prepareSessionContextTask = restartableTask(
    async (
      oldRoomId: string,
      newRoomId: string,
      opts: {
        shouldSummarizeSession: boolean;
        shouldCopyFileHistory: boolean;
      },
    ) => {
      const { shouldSummarizeSession, shouldCopyFileHistory } = opts;

      if (shouldSummarizeSession) {
        await this.summarizeSessionTask.perform(oldRoomId, newRoomId);
      }

      if (shouldCopyFileHistory) {
        await this.copyFileHistoryTask.perform(oldRoomId, newRoomId);
      }
    },
  );

  // Public getters for task loading states
  get isSummarizingSession() {
    return this.summarizeSessionTask.isRunning;
  }

  get isCopyingFileHistory() {
    return this.copyFileHistoryTask.isRunning;
  }

  get isPreparingSession() {
    return this.isSummarizingSession || this.isCopyingFileHistory;
  }

  @action
  skipSessionPreparation() {
    this.summarizeSessionTask.cancelAll();
    this.copyFileHistoryTask.cancelAll();
    this.prepareSessionContextTask.cancelAll();
  }

  get loadingRooms() {
    return this.loadRoomsTask.isRunning;
  }

  private loadRoomsTask = restartableTask(async () => {
    await this.matrixService.waitForInitialSync();
    await this.matrixService.flushAll;
    await allSettled(
      [...this.matrixService.roomResources.values()].map((r) => r.processing),
    );
    await this.enterRoomInitially();
  });

  private async enterRoomInitially() {
    let persistedRoomId = this.localPersistenceService.getCurrentRoomId();
    if (persistedRoomId) {
      let roomToEnter = this.aiSessionRooms.find(
        (r) => r.roomId === persistedRoomId,
      );
      if (!roomToEnter) {
        // If you open the AI Assistant right away, the room might not be loaded yet.
        // In that case, let's wait for it for up to 2 seconds.
        let interval: number | undefined;
        try {
          await Promise.race([
            timeout(2000),
            new Promise<void>((resolve) => {
              interval = window.setInterval(() => {
                roomToEnter = this.aiSessionRooms.find(
                  (r) => r.roomId === persistedRoomId,
                );
                if (roomToEnter) {
                  if (interval !== undefined) {
                    window.clearInterval(interval);
                    interval = undefined;
                  }
                  resolve();
                }
                // cast here is because @types/node is polluting our definition of
                // setInterval on the browser.
              }, 250) as unknown as number;
            }),
          ]);
        } finally {
          if (interval !== undefined) {
            window.clearInterval(interval);
          }
        }
      }
      if (roomToEnter) {
        this.enterRoom(roomToEnter.roomId);
        return;
      }
    }

    let latestRoom = this.latestRoom;
    if (latestRoom) {
      this.enterRoom(latestRoom.roomId);
      return;
    }

    await this.createNewSession();
  }

  get aiSessionRooms(): SessionRoomData[] {
    let sessions: SessionRoomData[] = [];
    for (let resource of this.matrixService.roomResources.values()) {
      if (!resource.matrixRoom) {
        continue;
      }
      if (
        !resource.matrixRoom.hasActiveMember(this.matrixService.aiBotUserId)
      ) {
        continue;
      }
      // Skip rooms the user has deleted this session, or rooms whose state
      // shows the user has left. Sync events can re-add deleted rooms to
      // the cache with stale state before the leave event propagates.
      if (resource.roomId && this.deletedRoomIds.has(resource.roomId)) {
        continue;
      }
      if (
        this.matrixService.userId &&
        !resource.matrixRoom.hasActiveMember(this.matrixService.userId)
      ) {
        continue;
      }
      if (resource.name && resource.roomId) {
        sessions.push({
          roomId: resource.roomId,
          name: resource.name,
          lastMessage: resource.messages[resource.messages.length - 1],
          created: resource.created,
          lastActiveTimestamp: resource.lastActiveTimestamp,
        });
      }
    }
    // sort in reverse chronological order of last activity
    return sessions.sort(
      (a, b) =>
        this.matrixService.getLastActiveTimestamp(
          b.roomId,
          b.lastActiveTimestamp,
        ) -
        this.matrixService.getLastActiveTimestamp(
          a.roomId,
          a.lastActiveTimestamp,
        ),
    );
  }

  get latestRoom() {
    if (this.aiSessionRooms.length !== 0) {
      return this.aiSessionRooms[0];
    }
    return undefined;
  }

  @action
  setRoomToRename(room: SessionRoomData) {
    this.roomToRename = room;
    this.hidePastSessions();
  }

  @action
  onCloseRename() {
    this.roomToRename = undefined;
    this.displayPastSessions();
  }

  @action
  setRoomToDelete(room: SessionRoomData | undefined) {
    this.roomDeleteError = undefined;

    if (!room) {
      this.roomToDelete = undefined;
      return;
    }

    this.roomToDelete = {
      id: room.roomId,
      name: room.name || room.roomId,
    };
  }

  @action
  leaveRoom(roomId: string) {
    this.doLeaveRoom.perform(roomId);
  }

  private doLeaveRoom = restartableTask(async (roomId: string) => {
    try {
      this.deletedRoomIds.add(roomId);
      this.matrixService.roomResourcesCache.delete(roomId);

      if (window.localStorage.getItem(NewSessionIdPersistenceKey) === roomId) {
        window.localStorage.removeItem(NewSessionIdPersistenceKey);
      }

      if (this.matrixService.currentRoomId === roomId) {
        this.localPersistenceService.setCurrentRoomId(undefined);
        if (this.latestRoom) {
          this.enterRoom(this.latestRoom.roomId, false);
        } else {
          await this.createNewSession({
            addSameSkills: false,
            shouldCopyFileHistory: false,
            shouldSummarizeSession: false,
            deferDefaultSkills: true,
          });
        }
      }
      this.roomToDelete = undefined;

      await this.matrixService.leave(roomId);
      await this.matrixService.forget(roomId);
    } catch (e) {
      // Roll back local deletion state so the room reappears in the
      // session list — the user still belongs to it on the server.
      this.deletedRoomIds.delete(roomId);
      console.error(e);
      this.roomDeleteError = 'Error deleting room';
      if (isMatrixError(e)) {
        this.roomDeleteError += `: ${e.data.error}`;
      } else if (e instanceof Error) {
        this.roomDeleteError += `: ${e.message}`;
      }
    }
  });
}

declare module '@ember/service' {
  interface Registry {
    'ai-assistant-panel-service': AiAssistantPanelService;
  }
}
