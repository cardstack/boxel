import Component from '@glimmer/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
//@ts-ignore glint does not think this is consumed but it is consumed
import { hash } from '@ember/helper';
import type RouterService from '@ember/routing/router-service';
import type LocalRealm from '../services/local-realm';

export interface ConnectedRealm {
  url: string;
  directoryName: string;
}

interface RealmBlockArgs {
  connected?: ConnectedRealm;
  close: () => void;
  open: () => void;
  isAvailable: boolean;
  isLoading: boolean;
  isEmpty: boolean;
  status: string;
}

interface Signature {
  Blocks: { default: [RealmBlockArgs] };
}

export default class InLocalRealm extends Component<Signature> {
  <template>
    {{yield
      (hash
        connected=this.connectedInfo
        close=this.closeRealm
        open=this.openRealm
        isAvailable=this.localRealm.isAvailable
        isLoading=this.localRealm.isLoading
        isEmpty=this.localRealm.isEmpty
        status=this.localRealm.status
      )
    }}
  </template>

  @service declare router: RouterService;
  @service declare localRealm: LocalRealm;

  get connectedInfo(): ConnectedRealm | undefined {
    if (this.localRealm.isAvailable) {
      return {
        url: this.localRealm.url.href,
        directoryName: this.localRealm.directoryName as string,
      };
    }
    return undefined;
  }

  @action
  async openRealm() {
    await this.localRealm.chooseDirectory();
    await this.router.refresh();
  }

  @action
  closeRealm() {
    if (this.localRealm.isAvailable) {
      this.localRealm.close();
      this.router.transitionTo({ queryParams: { path: undefined } });
    }
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    InLocalRealm: typeof InLocalRealm;
  }
}
