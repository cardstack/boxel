import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import MultipleDefaultExports from './multiple-default-exports';

export class MultipleDefaultExportsCard extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{MultipleDefaultExports}}
    </template>
  };
}
