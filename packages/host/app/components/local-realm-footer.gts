import Component from '@glimmer/component';
import { ConnectedRealm } from '@cardstack/host/components/in-local-realm';
import { on } from '@ember/modifier';
import ENV from '@cardstack/host/config/environment';
import { withPreventDefault } from '@cardstack/host/helpers/with-prevent-default';

const { isLocalRealm } = ENV;

interface Signature {
  Args: {
    connected: ConnectedRealm;
    close: () => void;
  };
  Blocks: { default: [string] };
}

export default class LocalRealmFooter extends Component<Signature> {
  isLocalRealm = isLocalRealm;
  <template>
    {{! template-lint-disable no-inline-styles }}
    <footer class='realm-footer' style='text-align:center;margin:1em auto'>
      Local realm connected ({{@connected.directoryName}}).
      <a
        {{on 'click' (withPreventDefault @close)}}
        style='color:#6638ff;text-decoration:underline'
        type='button'
      >Close local realm</a>
    </footer>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    LocalRealmFooter: typeof LocalRealmFooter;
  }
}
