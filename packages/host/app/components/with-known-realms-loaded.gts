import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import CardService from '../services/card-service';
import RealmService from '../services/realm';

interface Signature {
  Args: {};
  Blocks: {
    default: [];
    loading: [];
  };
}
export default class WithKnownRealmsLoaded extends Component<Signature> {
  @service declare realm: RealmService;
  @service declare cardService: CardService;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmsTask.perform();
  }

  private loadRealmsTask = task(async () => {
    let realmURLs = this.cardService.unresolvedRealmURLs;
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
