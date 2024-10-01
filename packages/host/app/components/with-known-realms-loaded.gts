import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import RealmService from '../services/realm';
import RealmServerService from '../services/realm-server';

interface Signature {
  Args: {};
  Blocks: {
    default: [];
    loading: [];
  };
}
export default class WithKnownRealmsLoaded extends Component<Signature> {
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmsTask.perform();
  }

  private loadRealmsTask = task(async () => {
    let realmURLs = this.realmServer.availableRealmURLs;
    await Promise.all(
      realmURLs.map(
        async (realmURL) => await this.realm.ensureRealmMeta(realmURL),
      ),
    );
  });

  <template>
    {{#if this.loadRealmsTask.last.isSuccessful}}
      {{yield}}
    {{else if this.loadRealmsTask.isRunning}}
      {{#if (has-block 'loading')}}
        {{yield to='loading'}}
      {{else}}
        <div>Loading...</div>
      {{/if}}
    {{else}}
      <div>Failed to load known realms</div>
    {{/if}}
  </template>
}
