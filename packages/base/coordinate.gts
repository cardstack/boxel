import NumberField from './number';
import { contains, FieldDef, field } from './card-api';

export default class CoordinateField extends FieldDef {
  @field x = contains(NumberField);
  @field y = contains(NumberField);

  static displayName = 'Coordinate';
}
