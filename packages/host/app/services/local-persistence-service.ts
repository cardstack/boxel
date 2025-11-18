import Service from '@ember/service';

import window from 'ember-window-mock';
import { v4 as uuidv4 } from 'uuid';

import type { SerializedFileDef } from 'https://cardstack.com/base/file-api';

import {
  AiAssistantMessageDrafts,
  CurrentRoomIdPersistenceKey,
} from '../utils/local-storage-keys';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredFileDraft = Pick<
  SerializedFileDef,
  'sourceUrl' | 'name' | 'url' | 'contentType' | 'contentHash'
>;

type StoredMessageDraft = {
  message?: string;
  attachedCardIds?: string[];
  attachedFiles?: StoredFileDraft[];
  updatedAt: number;
};

type DraftUpdate = {
  message?: string;
  attachedCardIds?: string[] | undefined;
  attachedFiles?: StoredFileDraft[] | undefined;
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

  getDraft(roomId: string) {
    return this.readMessageDrafts()[roomId];
  }

  getMessageDraft(roomId: string) {
    return this.getDraft(roomId)?.message;
  }

  setMessageDraft(roomId: string, message: string | undefined) {
    this.updateDraft(roomId, {
      message: message?.length ? message : undefined,
    });
  }

  getAttachedCardIds(roomId: string) {
    return this.getDraft(roomId)?.attachedCardIds;
  }

  setAttachedCardIds(roomId: string, cardIds: string[] | undefined) {
    let sanitized = cardIds?.filter((id) => typeof id === 'string' && id);
    this.updateDraft(roomId, {
      attachedCardIds: sanitized && sanitized.length ? sanitized : undefined,
    });
  }

  getAttachedFiles(roomId: string) {
    return this.getDraft(roomId)?.attachedFiles;
  }

  setAttachedFiles(roomId: string, files: StoredFileDraft[] | undefined) {
    let sanitized = files
      ? (files
          .map((file) => this.sanitizeFile(file))
          .filter(Boolean) as StoredFileDraft[])
      : undefined;
    this.updateDraft(roomId, {
      attachedFiles: sanitized && sanitized.length ? sanitized : undefined,
    });
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
        let draft = this.sanitizeDraft(value, now);
        if (draft) {
          sanitized[roomId] = draft;
        }
      }

      return sanitized;
    } catch {
      window.localStorage.removeItem(AiAssistantMessageDrafts);
      return {} as Record<string, StoredMessageDraft>;
    }
  }

  private sanitizeDraft(value: unknown, now: number) {
    if (!value || typeof value !== 'object') {
      return;
    }

    let message = (value as { message?: unknown }).message;
    let updatedAt = Number(
      (value as { updatedAt?: unknown }).updatedAt ??
        (value as { createdAt?: unknown }).createdAt,
    );
    let attachedCardIds = (value as { attachedCardIds?: unknown })
      .attachedCardIds;
    let attachedFiles = (value as { attachedFiles?: unknown }).attachedFiles;

    let sanitizedMessage = typeof message === 'string' ? message : undefined;
    let sanitizedCards = Array.isArray(attachedCardIds)
      ? attachedCardIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : undefined;
    let sanitizedFiles = Array.isArray(attachedFiles)
      ? (attachedFiles
          .map((file) => this.sanitizeFile(file))
          .filter(Boolean) as StoredFileDraft[])
      : undefined;

    if (!Number.isFinite(updatedAt)) {
      updatedAt = now;
    }

    if (
      this.isDraftEmpty({
        message: sanitizedMessage,
        attachedCardIds: sanitizedCards,
        attachedFiles: sanitizedFiles,
        updatedAt,
      })
    ) {
      return;
    }

    return {
      message: sanitizedMessage,
      attachedCardIds: sanitizedCards,
      attachedFiles: sanitizedFiles,
      updatedAt,
    } satisfies StoredMessageDraft;
  }

  private sanitizeFile(file: unknown): StoredFileDraft | undefined {
    if (!file || typeof file !== 'object') {
      return;
    }

    let sourceUrl = (file as { sourceUrl?: unknown }).sourceUrl;
    if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
      return;
    }

    let name = (file as { name?: unknown }).name;
    let url = (file as { url?: unknown }).url;
    let contentType = (file as { contentType?: unknown }).contentType;
    let contentHash = (file as { contentHash?: unknown }).contentHash;

    return {
      sourceUrl,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof url === 'string' ? { url } : {}),
      ...(typeof contentType === 'string' ? { contentType } : {}),
      ...(typeof contentHash === 'string' ? { contentHash } : {}),
    } satisfies StoredFileDraft;
  }

  private writeMessageDrafts(drafts: Record<string, StoredMessageDraft>) {
    let now = Date.now();
    let prunedEntries = Object.entries(drafts).filter(([, draft]) => {
      if (!draft) {
        return false;
      }
      let updatedAt = Number(draft?.updatedAt);
      if (!Number.isFinite(updatedAt)) {
        return false;
      }
      if (now - updatedAt > ONE_WEEK_MS) {
        return false;
      }

      return !this.isDraftEmpty(draft);
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

  private updateDraft(roomId: string, updates: DraftUpdate) {
    let drafts = this.readMessageDrafts();
    let existing = drafts[roomId];
    let next: StoredMessageDraft = {
      message: existing?.message,
      attachedCardIds: existing?.attachedCardIds,
      attachedFiles: existing?.attachedFiles,
      updatedAt:
        existing?.updatedAt ??
        Number((existing as { createdAt?: number })?.createdAt) ??
        Date.now(),
    };

    if ('message' in updates) {
      next.message = updates.message;
    }
    if ('attachedCardIds' in updates) {
      next.attachedCardIds = updates.attachedCardIds;
    }
    if ('attachedFiles' in updates) {
      next.attachedFiles = updates.attachedFiles;
    }

    if (this.isDraftEmpty(next)) {
      delete drafts[roomId];
    } else {
      next.updatedAt = Date.now();
      drafts[roomId] = next;
    }

    this.writeMessageDrafts(drafts);
  }

  private isDraftEmpty(draft: StoredMessageDraft | undefined) {
    if (!draft) {
      return true;
    }
    let hasMessage =
      typeof draft.message === 'string' && draft.message.length > 0;
    let hasCards = draft.attachedCardIds && draft.attachedCardIds.length > 0;
    let hasFiles = draft.attachedFiles && draft.attachedFiles.length > 0;
    return !hasMessage && !hasCards && !hasFiles;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-persistence-service': LocalPersistenceService;
  }
}
