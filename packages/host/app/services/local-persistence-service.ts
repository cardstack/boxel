import Service from '@ember/service';

import window from 'ember-window-mock';
import { v4 as uuidv4 } from 'uuid';

import {
  AiAssistantMessageDrafts,
  CurrentRoomIdPersistenceKey,
} from '../utils/local-storage-keys';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type StoredMessageDraft = {
  message: string;
  createdAt: number;
};

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
    return this.readMessageDrafts()[roomId]?.message;
  }

  setMessageDraft(roomId: string, message: string | undefined) {
    let drafts = this.readMessageDrafts();
    if (message && message.length > 0) {
      drafts[roomId] = {
        message,
        createdAt: Date.now(),
      };
    } else {
      delete drafts[roomId];
    }
    this.writeMessageDrafts(drafts);
  }

  private readMessageDrafts(): Record<string, StoredMessageDraft> {
    let drafts = window.localStorage.getItem(AiAssistantMessageDrafts);
    if (!drafts) {
      return {} as Record<string, StoredMessageDraft>;
    }

    try {
      let parsed = JSON.parse(drafts);
      if (!parsed || typeof parsed !== 'object') {
        return {} as Record<string, StoredMessageDraft>;
      }

      let now = Date.now();
      let sanitized: Record<string, StoredMessageDraft> = {};

      for (let [roomId, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!value) {
          continue;
        }

        if (typeof value === 'object') {
          let message = (value as { message?: unknown }).message;
          let createdAt = Number((value as { createdAt?: unknown }).createdAt);
          if (typeof message !== 'string') {
            continue;
          }

          if (!Number.isFinite(createdAt)) {
            createdAt = now;
          }

          sanitized[roomId] = { message, createdAt };
          continue;
        }
      }

      return sanitized;
    } catch {
      window.localStorage.removeItem(AiAssistantMessageDrafts);
      return {} as Record<string, StoredMessageDraft>;
    }
  }

  private writeMessageDrafts(drafts: Record<string, StoredMessageDraft>) {
    let now = Date.now();
    let prunedEntries = Object.entries(drafts).filter(([, draft]) => {
      if (!draft || typeof draft.message !== 'string') {
        return false;
      }
      let createdAt = Number(draft?.createdAt);
      if (!Number.isFinite(createdAt)) {
        return false;
      }
      return now - createdAt <= ONE_WEEK_MS;
    });

    if (prunedEntries.length === 0) {
      window.localStorage.removeItem(AiAssistantMessageDrafts);
      return;
    }

    let prunedDrafts = Object.fromEntries(prunedEntries) as Record<
      string,
      StoredMessageDraft
    >;

    window.localStorage.setItem(
      AiAssistantMessageDrafts,
      JSON.stringify(prunedDrafts),
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-persistence-service': LocalPersistenceService;
  }
}
