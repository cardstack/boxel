import { action } from '@ember/object';
import Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { allSettled, restartableTask } from 'ember-concurrency';
import { timeout } from 'ember-concurrency';

import window from 'ember-window-mock';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import CreateAiAssistantRoomCommand from '../commands/create-ai-assistant-room';
import { Submodes } from '../components/submode-switcher';
import { eventDebounceMs, isMatrixError } from '../lib/matrix-utils';
import { NewSessionIdPersistenceKey } from '../utils/local-storage-keys';

import LocalPersistenceService from './local-persistence-service';

import type CommandService from './command-service';
import type MatrixService from './matrix-service';
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
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private commandService: CommandService;
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

  get isOpen() {
    return this.operatorModeStateService.aiAssistantOpen;
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
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      this.matrixService.setLLMForCodeMode();
    }

    this.localPersistenceService.setCurrentRoomId(roomId);
    if (hidePastSessionsList) {
      this.hidePastSessions();
    }
  }

  @action
  async createNewSession(shouldCopyFileHistory?: boolean) {
    this.displayRoomError = false;
    if (this.newSessionId) {
      this.enterRoom(this.newSessionId);
      return;
    }

    await this.doCreateRoom.perform(
      'New AI Assistant Chat',
      shouldCopyFileHistory ?? false,
    );
  }

  private collectFileHistoryFromCurrentRoom(): {
    attachedFiles: FileDef[];
    attachedCards: CardDef[];
  } {
    const currentRoomId = this.matrixService.currentRoomId;
    if (!currentRoomId) {
      return { attachedFiles: [], attachedCards: [] };
    }

    const roomResource = this.matrixService.roomResources.get(currentRoomId);
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

  private doCreateRoom = restartableTask(
    async (
      name: string = 'New AI Assistant Chat',
      shouldCopyFileHistory: boolean = false,
    ) => {
      try {
        const defaultSkills = await this.matrixService.loadDefaultSkills(
          this.operatorModeStateService.state.submode,
        );
        let createRoomCommand = new CreateAiAssistantRoomCommand(
          this.commandService.commandContext,
        );
        let { roomId } = await createRoomCommand.execute({
          name,
          defaultSkills,
        });

        window.localStorage.setItem(NewSessionIdPersistenceKey, roomId);

        // If file history should be copied, send an initial message with the files and cards
        if (shouldCopyFileHistory) {
          const { attachedFiles, attachedCards } =
            this.collectFileHistoryFromCurrentRoom();

          if (attachedFiles.length > 0 || attachedCards.length > 0) {
            await this.matrixService.sendMessage(
              roomId,
              'This session includes files and cards from the previous conversation for context.',
              attachedCards,
              attachedFiles,
            );
          }
        }

        this.enterRoom(roomId);
      } catch (e) {
        console.log(e);
        this.displayRoomError = true;
      }

      return undefined;
    },
  );

  get loadingRooms() {
    return this.loadRoomsTask.isRunning;
  }

  private loadRoomsTask = restartableTask(async () => {
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
            }, 250);
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

    await this.createNewSession(false);
  }

  get aiSessionRooms(): SessionRoomData[] {
    let sessions: SessionRoomData[] = [];
    for (let resource of this.matrixService.roomResources.values()) {
      if (!resource.matrixRoom) {
        continue;
      }
      let isAiBotInvited = !!resource.invitedMembers.find(
        (m) => this.matrixService.aiBotUserId === m.userId,
      );
      let isAiBotJoined = !!resource.joinedMembers.find(
        (m) => this.matrixService.aiBotUserId === m.userId,
      );
      let isUserJoined = !!resource.joinedMembers.find(
        (m) => this.matrixService.userId === m.userId,
      );
      if (
        (isAiBotInvited || isAiBotJoined) &&
        isUserJoined &&
        resource.name &&
        resource.roomId
      ) {
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
