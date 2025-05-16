import { action } from '@ember/object';
import Owner from '@ember/owner';
import { service } from '@ember/service';
import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { allSettled, restartableTask } from 'ember-concurrency';
import { timeout } from 'ember-concurrency';

import window from 'ember-window-mock';

import CreateAiAssistantRoomCommand from '../commands/create-ai-assistant-room';
import { Submodes } from '../components/submode-switcher';
import { eventDebounceMs, isMatrixError } from '../lib/matrix-utils';
import {
  CurrentRoomIdPersistenceKey,
  NewSessionIdPersistenceKey,
} from '../utils/local-storage-keys';

import type CommandService from './command-service';
import type MatrixService from './matrix-service';
import type OperatorModeStateService from './operator-mode-state-service';
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
    window.localStorage.setItem(CurrentRoomIdPersistenceKey, roomId);
    if (hidePastSessionsList) {
      this.hidePastSessions();
    }
  }

  @action
  async createNewSession() {
    this.displayRoomError = false;
    if (this.newSessionId) {
      this.enterRoom(this.newSessionId);
      return;
    }
    await this.doCreateRoom.perform();
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
    async (name: string = 'New AI Assistant Chat') => {
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
    let persistedRoomId = window.localStorage.getItem(
      CurrentRoomIdPersistenceKey,
    );
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

    await this.createNewSession();
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
        window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
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
