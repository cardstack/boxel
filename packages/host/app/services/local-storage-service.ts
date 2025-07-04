import Service from '@ember/service';

import { uuidv4 } from '@cardstack/runtime-common';

import { CurrentRoomIdPersistenceKey } from '../utils/local-storage-keys';
import { shortenUuid } from '../utils/uuid';

const TAB_ID_KEY = 'boxel-browser-tab-id';

export default class LocalStorageService extends Service {
  private _browserTabId: string;

  constructor(owner: any) {
    super(owner);
    this._browserTabId = this.getOrCreateBrowserTabId();
  }

  get browserTabId(): string {
    return this._browserTabId;
  }

  // A unique identifier used for dynamic local storage keys which are used
  // for settings that are scoped to the current browser tab.
  // Example: being able to store the current AI panel room id for every browser tab separately.
  private getOrCreateBrowserTabId(): string {
    let existingBrowserTabId = window.sessionStorage.getItem(TAB_ID_KEY);

    if (existingBrowserTabId) {
      return existingBrowserTabId;
    }

    let newBrowserTabId = shortenUuid(uuidv4());
    window.sessionStorage.setItem(TAB_ID_KEY, newBrowserTabId);
    return newBrowserTabId;
  }

  getCurrentRoomId() {
    let globalCurrentRoomId = window.localStorage.getItem(
      CurrentRoomIdPersistenceKey,
    );

    let tabScopedCurrentRoomId = window.localStorage.getItem(
      `${CurrentRoomIdPersistenceKey}-${this.browserTabId}`,
    );

    return tabScopedCurrentRoomId || globalCurrentRoomId;
  }

  setCurrentRoomId(roomId: string) {
    window.localStorage.setItem(CurrentRoomIdPersistenceKey, roomId);

    this.deleteOldEntries();
    window.localStorage.setItem(
      `${CurrentRoomIdPersistenceKey}-${this.browserTabId}`,
      roomId,
    );
  }

  deleteOldEntries() {
    for (let i = 0; i < window.localStorage.length; i++) {
      let key = window.localStorage.key(i);
      if (key && key.startsWith(CurrentRoomIdPersistenceKey + '-')) {
        window.localStorage.removeItem(key);
      }
    }
  }

  removeCurrentRoomId() {
    window.localStorage.removeItem(CurrentRoomIdPersistenceKey);
    window.localStorage.removeItem(
      `${CurrentRoomIdPersistenceKey}-${this.browserTabId}`,
    );
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-storage-service': LocalStorageService;
  }
}
