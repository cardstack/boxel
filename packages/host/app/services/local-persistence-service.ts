import Service from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { CurrentRoomIdPersistenceKey } from '../utils/local-storage-keys';

export default class LocalPersistenceService extends Service {
  getAgentId() {
    let agentId = window.sessionStorage.getItem('agentId');
    if (!agentId) {
      agentId = uuidv4();
      window.sessionStorage.setItem('agentId', agentId);
    }
    return agentId;
  }

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
