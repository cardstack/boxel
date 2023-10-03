import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { use, resource } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import { type RealmInfo } from '@cardstack/runtime-common';

import type RealmInfoService from '@cardstack/host/services/realm-info-service';

const waiter = buildWaiter('realm-info-provider:load-waiter');

interface RealmURLArg {
  realmURL: string;
  fileURL?: never;
}

interface FileURLArg {
  fileURL: string;
  realmURL?: never;
}

export interface Signature {
  Args: RealmURLArg | FileURLArg;
  Blocks: {
    ready: [RealmInfo];
    error: [Error];
  };
}

export default class RealmInfoProvider extends Component<Signature> {
  @service declare realmInfoService: RealmInfoService;

  @use private realmInfoResource = resource(() => {
    if (!('fileURL' in this.args) && !('realmURL' in this.args)) {
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
        let token = waiter.beginAsync();
        try {
          let realmInfo = await this.realmInfoService.fetchRealmInfo(this.args);

          state.value = realmInfo;
        } catch (error: any) {
          state.error = error;
        } finally {
          state.isLoading = false;
          waiter.endAsync(token);
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
