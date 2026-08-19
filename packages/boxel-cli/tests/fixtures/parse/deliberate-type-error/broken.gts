import {
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';

// A genuine type error. parse must surface a real TS diagnostic here —
// not the environmental "exited with errors but produced no TS
// diagnostics" message that means glint resolved nothing and checked
// nothing. This is the fixture that proves glint actually ran.
export class Broken extends CardDef {
  static displayName = 'Broken';
  static isolated = class extends Component<typeof Broken> {
    get count(): number {
      return 'not a number';
    }
    <template>{{this.count}}</template>
  };
}
