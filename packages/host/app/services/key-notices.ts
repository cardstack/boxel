import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { KEY_NOTICES_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import { unreadKeyNoticeCount } from '../lib/key-notices';
import { pageURL } from '../lib/secure-sign-in';

import type RealmServerService from './realm-server';
import type SecureWindowService from './secure-window';
import type SessionService from './session';
import type { SessionParticipant } from './session';

// Whether the user has notices about their keys they haven't seen, for the
// badges on their avatar and on the API Keys item of their profile menu.
//
// The count is the realm server's. It is asked for when a session starts, when
// the realm server says a notice was recorded for the user, and when the user
// comes back from the secure window, where opening the key page marks the
// notices it lists read. A count that can't be read leaves the last one shown.
export default class KeyNoticesService
  extends Service
  implements SessionParticipant
{
  @service declare private realmServer: RealmServerService;
  @service declare private secureWindow: SecureWindowService;
  @service declare private session: SessionService;

  @tracked unread = 0;

  // Which session a count was asked for, so one that answers after the
  // session ended isn't shown to whoever signs in next.
  #generation = 0;

  constructor(owner: Owner) {
    super(owner);
    this.realmServer.subscribeEvent(KEY_NOTICES_UPDATED_EVENT_TYPE, () =>
      this.refresh(),
    );
    let stopWatching = this.secureWindow.onReturn(() => this.refresh());
    registerDestructor(this, stopWatching);
    this.session.register(this);
  }

  resetState() {
    this.#generation++;
    this.refreshTask.cancelAll();
    this.unread = 0;
  }

  sessionStarted() {
    this.refresh();
  }

  refresh = () => {
    if (!this.session.isAuthenticated) {
      return;
    }
    this.refreshTask.perform();
  };

  // The secure origin's key page, where the notices are listed.
  openKeys = () => {
    this.secureWindow.open(pageURL('keys').href);
  };

  private refreshTask = restartableTask(async () => {
    let generation = this.#generation;
    try {
      let unread = await unreadKeyNoticeCount(this.realmServer);
      if (generation === this.#generation) {
        this.unread = unread;
      }
    } catch (e) {
      console.warn(`Could not read the unread key notices: ${e}`);
    }
  });
}

declare module '@ember/service' {
  interface Registry {
    'key-notices': KeyNoticesService;
  }
}
