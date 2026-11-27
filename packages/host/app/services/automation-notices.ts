import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import type { AutomationNoticeReason } from '@cardstack/runtime-common/automation-notices';
import {
  AUTOMATION_NOTICES_PATH,
  AUTOMATION_NOTICE_RESOURCE_TYPE,
} from '@cardstack/runtime-common/automation-routes';

import { canonicalRealmIdentifier } from '../lib/realm-utils';

import type MessageService from './message-service';
import type NetworkService from './network';
import type RealmServerService from './realm-server';
import type SecureWindowService from './secure-window';
import type SessionService from './session';
import type { SessionParticipant } from './session';

// One automation notice for the user, as the realm server lists it.
export interface AutomationNoticeEntry {
  // The automation card's URL.
  automation: string;
  // The realm, in the form card ids carry.
  realm: string;
  reason: AutomationNoticeReason;
}

// How long a burst of realm events waits before the notices are read again:
// a run sends several in quick succession as it starts, is admitted and ends.
const SETTLE_MS = 500;

// The user's automation notices, for the badges that tell someone who isn't
// looking at a realm's Automations console that an automation there needs
// them: on the workspace in the dashboard, and on Realm Settings in the
// workspace's menu. Each notice is the realm server's, read from what the
// automation's row and runs record, so it ends the moment its problem is
// fixed.
//
// The notices are read when a session starts, on each `automation` realm
// event and each `job` event for a run that ended (both reach a direct
// writer's session for every realm they write directly, whether or not a view
// of the realm is open), and when the
// user comes back from the secure window, where reconnecting a key or
// approving an operation fixes a notice without moving any automation. A
// read that fails leaves the last notices shown.
export default class AutomationNoticesService
  extends Service
  implements SessionParticipant
{
  @service declare private messageService: MessageService;
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;
  @service declare private secureWindow: SecureWindowService;
  @service declare private session: SessionService;

  @tracked notices: AutomationNoticeEntry[] = [];

  // Which session the notices were asked for, so an answer that comes after
  // the session ended isn't shown to whoever signs in next.
  #generation = 0;

  constructor(owner: Owner) {
    super(owner);
    let stopListening = this.messageService.onEveryRealmEvent((event) => {
      // A notice changes only when an automation's row changes, or one of
      // its runs ends; a run starting or reaching a milestone changes none.
      if (
        event.eventName === 'automation' ||
        (event.eventName === 'job' &&
          (event.state === 'complete' || event.state === 'error'))
      ) {
        this.refresh({ settle: true });
      }
    });
    let stopWatching = this.secureWindow.onReturn(() => this.refresh());
    registerDestructor(this, () => {
      stopListening();
      stopWatching();
    });
    this.session.register(this);
  }

  resetState() {
    this.#generation++;
    this.refreshTask.cancelAll();
    this.notices = [];
  }

  sessionStarted() {
    this.refresh();
  }

  // How many of the user's automation notices are about automations in
  // `realm`, under any of the realm's spellings.
  countFor = (realm: string | undefined): number => {
    if (!realm) {
      return 0;
    }
    let key = canonicalRealmIdentifier(this.network.virtualNetwork, realm);
    return this.notices.filter((notice) => notice.realm === key).length;
  };

  refresh = ({ settle = false }: { settle?: boolean } = {}) => {
    if (!this.session.isAuthenticated) {
      return;
    }
    this.refreshTask.perform(settle);
  };

  private refreshTask = restartableTask(async (settle: boolean) => {
    let generation = this.#generation;
    if (settle) {
      await timeout(SETTLE_MS);
    }
    try {
      let notices = await this.read();
      if (generation === this.#generation) {
        this.notices = notices;
      }
    } catch (e) {
      console.warn(`Could not read the automation notices: ${e}`);
    }
  });

  private async read(): Promise<AutomationNoticeEntry[]> {
    let response = await this.realmServer.authedFetch(
      new URL(AUTOMATION_NOTICES_PATH.slice(1), this.realmServer.url).href,
      { headers: { Accept: 'application/vnd.api+json' } },
    );
    if (!response.ok) {
      throw new Error(
        `the realm server answered ${response.status} for ${AUTOMATION_NOTICES_PATH}`,
      );
    }
    let body = (await response.json()) as {
      data?: {
        type?: unknown;
        id?: unknown;
        attributes?: { realm?: unknown; reason?: unknown };
      }[];
    };
    let notices: AutomationNoticeEntry[] = [];
    for (let resource of body.data ?? []) {
      let realm = resource.attributes?.realm;
      let reason = resource.attributes?.reason;
      if (
        resource.type !== AUTOMATION_NOTICE_RESOURCE_TYPE ||
        typeof resource.id !== 'string' ||
        typeof realm !== 'string' ||
        typeof reason !== 'string'
      ) {
        continue;
      }
      notices.push({
        automation: resource.id,
        realm: canonicalRealmIdentifier(this.network.virtualNetwork, realm),
        reason: reason as AutomationNoticeReason,
      });
    }
    return notices;
  }
}

declare module '@ember/service' {
  interface Registry {
    'automation-notices': AutomationNoticesService;
  }
}
