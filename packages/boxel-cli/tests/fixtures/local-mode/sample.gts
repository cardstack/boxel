import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Kbd } from '@cardstack/pretui/components/kbd';

// One field and two probe elements are the whole point: rendering any card at
// all, and a Pret UI component in it, is what the accompanying test asserts,
// so nothing here should be interesting enough to fail on its own. The Kbd
// draws its face through a module of its own realm, so a rendered face also
// shows the Pret UI mount resolving the kit's relative imports.
export class Sample extends CardDef {
  static displayName = 'Sample';

  @field nickname = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div data-sample-probe>{{@model.nickname}}</div>
      <Kbd data-test-sample-pretui-probe @value='Mod+K' @platform='other' />
    </template>
  };
}
