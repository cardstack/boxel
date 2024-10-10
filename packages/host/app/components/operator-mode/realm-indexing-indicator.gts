import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { TrackedMap } from 'tracked-built-ins';

import { type IndexEventData } from '@cardstack/runtime-common';

import type MessageService from '@cardstack/host/services/message-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { assertNever } from '@cardstack/host/utils/assert-never';

export default class RealmIndexingIndicator extends Component {
  @service private declare realmServer: RealmServerService;
  @service private declare realm: RealmService;
  @service private declare messageService: MessageService;

  private indexingRealms: TrackedMap<string, { name: string }> =
    new TrackedMap();
  private subscriptions: Map<string, () => void> = new Map();

  constructor(owner: Owner, args: any) {
    super(owner, args);
    registerDestructor(this, () => {
      for (let unsubscribe of this.subscriptions.values()) {
        unsubscribe();
      }
    });

    for (let realmURL of this.realmServer.availableRealmURLs) {
      this.subscriptions.set(
        realmURL,
        this.messageService.subscribe(
          realmURL,
          ({ type, data: dataStr }: { type: string; data: string }) => {
            if (type !== 'index') {
              return;
            }
            let data = JSON.parse(dataStr) as IndexEventData;
            if (data.type === 'full') {
              return;
            }
            switch (data.type) {
              case 'incremental-index-initiation':
                this.indexingRealms.set(realmURL, {
                  name: this.realm.info(realmURL).name,
                });
                break;
              case 'incremental':
                this.indexingRealms.delete(realmURL);
                break;
              default:
                throw assertNever(data);
            }
          },
        ),
      );
    }
  }

  @cached
  get indexingRealmNames() {
    return [...this.indexingRealms.values()].map((v) => v.name).join(', ');
  }

  get isIndexing() {
    return this.indexingRealms.size > 0;
  }

  get isPlural() {
    return this.indexingRealms.size > 1;
  }

  <template>
    {{#if this.isIndexing}}
      <div class='realm-indexing-indicator' data-test-realm-indexing-indicator>
        Indexing
        {{#if this.isPlural}}realms{{else}}realm{{/if}}
        {{this.indexingRealmNames}}
      </div>
    {{/if}}

    <style scoped>
      /* TODO unhide this after we get UI designs */
      .realm-indexing-indicator {
        display: none;
      }
    </style>
  </template>
}
