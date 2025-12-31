import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { allSettled, restartableTask } from 'ember-concurrency';
import { timeout } from 'ember-concurrency';

import window from 'ember-window-mock';

import { isCardInstance } from '@cardstack/runtime-common';
import type { LLMMode } from '@cardstack/runtime-common/matrix-constants';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';
import type * as CommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import type { Skill as SkillCard } from 'https://cardstack.com/base/skill';

import CreateAiAssistantRoomCommand from '../commands/create-ai-assistant-room';

import SummarizeSessionCommand from '../commands/summarize-session';
import { Submodes } from '../components/submode-switcher';
import { eventDebounceMs, isMatrixError } from '../lib/matrix-utils';
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
  @service declare private store: StoreService;

  @tracked displayRoomError = false;
  @tracked isShowingPastSessions = false;
  @tracked roomToRename: SessionRoomData | undefined = undefined;
  @tracked roomToDelete: { id: string; name: string } | undefined = undefined;
  @tracked roomDeleteError: string | undefined = undefined;

  constructor(owner: Owner) {
    super(owner);
    if (this.isOpen) {
      this.loadRoomsTask.perform();
    }
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

  private async extractSkillsFromCurrentRoom(): Promise<{
    enabledSkills: SkillCard[];
    disabledSkills: SkillCard[];
  }> {
    let enabledSkills: SkillCard[] = [];
    let disabledSkills: SkillCard[] = [];

    if (this.currentRoomResource?.matrixRoom?.skillsConfig) {
      const skillConfig = this.currentRoomResource.matrixRoom.skillsConfig;

      // Extract enabled skills from the current room
      if (skillConfig.enabledSkillCards?.length) {
        for (const fileDef of skillConfig.enabledSkillCards) {
          try {
            const skill = await this.store.get(fileDef.sourceUrl);
            if (skill && isCardInstance(skill)) {
              enabledSkills.push(skill as SkillCard);
            }
          } catch (e) {
            console.warn(`Failed to load skill from ${fileDef.sourceUrl}:`, e);
          }
        }
      }

      // Extract disabled skills from the current room
      if (skillConfig.disabledSkillCards?.length) {
        for (const fileDef of skillConfig.disabledSkillCards) {
          try {
            const skill = await this.store.get(fileDef.sourceUrl);
            if (skill && isCardInstance(skill)) {
              disabledSkills.push(skill as SkillCard);
            }
          } catch (e) {
            console.warn(`Failed to load skill from ${fileDef.sourceUrl}:`, e);
          }
        }
      }
    }

    return { enabledSkills, disabledSkills };
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
      },
    ) => {
      let { addSameSkills, shouldCopyFileHistory, shouldSummarizeSession } =
        opts;
      try {
        let createRoomCommand = new CreateAiAssistantRoomCommand(
          this.commandService.commandContext,
        );

        let input: any = { name };
        let llmMode = this.getPreferredLLMMode();
        if (llmMode) {
          input.llmMode = llmMode;
        }
        let enabledSkills: SkillCard[] = [];
        let disabledSkills: SkillCard[] = [];

        if (addSameSkills) {
          const extractedSkills = await this.extractSkillsFromCurrentRoom();
          enabledSkills = extractedSkills.enabledSkills;
          disabledSkills = extractedSkills.disabledSkills;
        }

        if (enabledSkills.length || disabledSkills.length) {
          input.enabledSkills = enabledSkills;
          input.disabledSkills = disabledSkills;
        } else {
          // Use default skills
          input.enabledSkills = await this.matrixService.loadDefaultSkills(
            this.operatorModeStateService.state.submode,
          );
        }

        let oldRoomId = this.matrixService.currentRoomId;
        let { roomId } = await createRoomCommand.execute(input);

        window.localStorage.setItem(NewSessionIdPersistenceKey, roomId);

        // Enter room immediately
        this.enterRoom(roomId);

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
        await Promise.race([
          timeout(2000),
          new Promise<void>((resolve) => {
            let interval = setInterval(() => {
              roomToEnter = this.aiSessionRooms.find(
                (r) => r.roomId === persistedRoomId,
              );
              if (roomToEnter) {
                clearInterval(interval);
                resolve();
              }
              // cast here is because @types/node is polluting our definition of
              // setInterval on the browser.
            }, 250) as unknown as number;
          }),
        ]);
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
          b.lastActiveTimestamp,
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
      await this.matrixService.leave(roomId);
      await this.matrixService.forget(roomId);
      await timeout(eventDebounceMs); // this makes it feel a bit more responsive
      this.matrixService.roomResourcesCache.delete(roomId);

      if (this.newSessionId === roomId) {
        window.localStorage.removeItem(NewSessionIdPersistenceKey);
      }

      if (this.matrixService.currentRoomId === roomId) {
        this.localPersistenceService.setCurrentRoomId(undefined);
        if (this.latestRoom) {
          this.enterRoom(this.latestRoom.roomId, false);
        } else {
          this.createNewSession();
        }
      }
      this.roomToDelete = undefined;
    } catch (e) {
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
