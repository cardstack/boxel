import Service from '@ember/service';

import window from 'ember-window-mock';
import { v4 as uuidv4 } from 'uuid';

import {
  AiAssistantMessageDrafts,
  CurrentRoomIdPersistenceKey,
} from '../utils/local-storage-keys';

export default class LocalPersistenceService extends Service {
  // Using sessionStorage for agent id because we want:
  // - to keep the same agent id if user reloads the page (or tab)
  // - to get a new agent id if user opens an additional tab
  getAgentId() {
    let agentId = window.sessionStorage.getItem('agentId');
    if (!agentId) {
      agentId = uuidv4();
      window.sessionStorage.setItem('agentId', agentId);
    }
    return agentId;
  }

  // Using sessionStorage so that we can keep different current room id for each tab, and
  // keep the same current room id if user reloads the page (or tab).
  // Additionally, we use localStorage so that when a user opens a new tab,
  // the previously most recently used room is selected. But after the user enters another room,
  // that room gets persisted in sessionStorage and the behaviour from the beginning of this
  // comment applies again.
  getCurrentRoomId() {
    let currentRoomId = window.sessionStorage.getItem('currentRoomId');
    if (!currentRoomId) {
      currentRoomId = window.localStorage.getItem(CurrentRoomIdPersistenceKey);
    }
    return currentRoomId;
  }

  setCurrentRoomId(roomId: string | undefined) {
    if (!roomId) {
      window.sessionStorage.removeItem('currentRoomId');
      window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
      return;
    }
    window.sessionStorage.setItem('currentRoomId', roomId);
    window.localStorage.setItem(CurrentRoomIdPersistenceKey, roomId);
  }

  getMessageDraft(roomId: string) {
    return this.readMessageDrafts()[roomId];
  }

  setMessageDraft(roomId: string, message: string | undefined) {
    let drafts = this.readMessageDrafts();
    if (message && message.length > 0) {
      drafts[roomId] = message;
    } else {
      delete drafts[roomId];
    }
    this.writeMessageDrafts(drafts);
  }

  private readMessageDrafts() {
    let drafts = window.localStorage.getItem(AiAssistantMessageDrafts);
    if (!drafts) {
      return {} as Record<string, string>;
    }

    try {
      let parsed = JSON.parse(drafts);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      window.localStorage.removeItem(AiAssistantMessageDrafts);
      return {};
    }
  }

  private writeMessageDrafts(drafts: Record<string, string>) {
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(AiAssistantMessageDrafts);
      return;
    }
    window.localStorage.setItem(
      AiAssistantMessageDrafts,
      JSON.stringify(drafts),
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-persistence-service': LocalPersistenceService;
  }
}
