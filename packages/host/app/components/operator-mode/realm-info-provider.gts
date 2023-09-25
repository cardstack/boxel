import Component from '@glimmer/component';

import { service } from '@ember/service';
import { use, resource } from 'ember-resources';
import { type RealmInfo } from '@cardstack/runtime-common';
import { TrackedObject } from 'tracked-built-ins';
import type RealmInfoService from '@cardstack/host/services/realm-info-service';

export interface Signature {
  Args: { realmURL?: string; fileURL?: string };
  Blocks: {
    ready: [RealmInfo];
    error: [Error];
  };
}

export default class RealmInfoProvider extends Component<Signature> {
  @service declare realmInfoService: RealmInfoService;

  @use private realmInfoResource = resource(() => {
    if (!this.args.fileURL) {
      return new TrackedObject({
        error: null,
        isLoading: false,
        value: null,
        load: () => Promise<void>,
      });
    }

    const state: {
      isLoading: boolean;
      value: RealmInfo | null;
      error: Error | undefined;
      load: () => Promise<void>;
    } = new TrackedObject({
      isLoading: true,
      value: null,
      error: undefined,
      load: async () => {
        state.isLoading = true;

        try {
          let realmInfo = await this.realmInfoService.fetchRealmInfo({
            realmURL: this.args.realmURL,
            fileURL: this.args.fileURL,
          });

          state.value = realmInfo;
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
        }
      },
    });

    state.load();
    return state;
  });

  <template>
    {{#if this.realmInfoResource.value}}
      {{yield this.realmInfoResource.value to='ready'}}
    {{else if this.realmInfoResource.error}}
      {{yield this.realmInfoResource.error to='error'}}
    {{/if}}
  </template>
}
