import Service, { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

type RealmJWT = {
  sub: String;
  exp: number;
  permissions: {
    read: boolean;
    write: boolean;
  };
};

export default class SessionsService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;

  realmURLToJWT = new TrackedMap<URL, RealmJWT>();

  get canRead() {
    return this.currentJWT?.permissions?.read || false;
  }

  get canWrite() {
    return this.currentJWT?.permissions?.write || false;
  }

  private get currentJWT() {
    return this.realmURLToJWT.get(this.operatorModeStateService.realmURL);
  }
}
