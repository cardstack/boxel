import {
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';

// Host tools moved from `@cardstack/boxel-host/commands/*` to
// `@cardstack/boxel-host/tools/*`. parse aliases the old path but not
// the new one, so current tool imports fail to resolve.
export class Saver extends CardDef {
  static displayName = 'Saver';
  static isolated = class extends Component<typeof Saver> {
    get command(): typeof SaveCardCommand {
      return SaveCardCommand;
    }
    <template>{{if this.command 'ready'}}</template>
  };
}
