import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';

import RealmService from '../services/realm';

interface Signature {
  Args: {
    realmURL: string;
  };
  Blocks: {
    default: [realm: { info: EnhancedRealmInfo; canWrite: boolean }];
  };
}
export default class WithLoadedRealm extends Component<Signature> {
  @service declare realm: RealmService;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmTask.perform();
  }

  private loadRealmTask = task(async () => {
    await this.realm.ensureRealmMeta(this.args.realmURL);
  });

  <template>
    {{#if this.loadRealmTask.last.isSuccessful}}
      {{yield (this.realm.meta @realmURL)}}
    {{else if this.loadRealmTask.isRunning}}
      <div>Loading...</div>
    {{else}}
      <div>Failed to load realm</div>
    {{/if}}
  </template>
}
