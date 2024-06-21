import { Coordinate } from './coordinate';
import { contains, FieldDef, field, CardDef, linksTo } from './card-api';

export class PositionedCard extends FieldDef {
  @field coordinate = contains(Coordinate);
  @field card = linksTo(CardDef);

  static displayName = 'Positioned Card';
}
