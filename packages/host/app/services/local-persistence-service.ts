import Service from '@ember/service';

import window from 'ember-window-mock';
import { v4 as uuidv4 } from 'uuid';

import { CurrentRoomIdPersistenceKey } from '../utils/local-storage-keys';

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
}

declare module '@ember/service' {
  interface Registry {
    'local-persistence-service': LocalPersistenceService;
  }
}
