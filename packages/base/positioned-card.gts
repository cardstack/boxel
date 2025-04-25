import { contains, FieldDef, field, CardDef, linksTo } from './card-api';
import CoordinateField from './coordinate';

export default class PositionedCardField extends FieldDef {
  @field coordinate = contains(CoordinateField);
  @field card = linksTo(CardDef);

  static displayName = 'Positioned Card';
}
