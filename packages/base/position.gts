import NumberField from './number';
import { contains, FieldDef, field, CardDef, linksTo } from './card-api';

export class Position extends FieldDef {
  @field x = contains(NumberField);
  @field y = contains(NumberField);

  static displayName = 'Position';
}

export class PositionedCard extends FieldDef {
  @field position = contains(Position);
  @field card = linksTo(CardDef);

  static displayName = 'Positioned Card';
}
