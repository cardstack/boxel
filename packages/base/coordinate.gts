import NumberField from './number';
import { contains, FieldDef, field, Component } from './card-api';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';

export default class CoordinateField extends FieldDef {
  @field x = contains(NumberField);
  @field y = contains(NumberField);

  static displayName = 'Coordinate';

  // CS-10786: emit `(x, y)` with numeric components escaped to avoid a
  // negative-number leading dash being read as a bullet marker at line
  // start. Empty when both components are null.
  static markdown = class Markdown extends Component<typeof CoordinateField> {
    get text() {
      let x = this.args.model?.x;
      let y = this.args.model?.y;
      if (x == null && y == null) {
        return '';
      }
      let xs = x == null ? '' : markdownEscape(String(x));
      let ys = y == null ? '' : markdownEscape(String(y));
      return `(${xs}, ${ys})`;
    }
    <template>{{this.text}}</template>
  };
}
