import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import AvatarField from '../fields/avatar';

export class Player extends CardDef {
  static displayName = 'Player';
  @field avatar = contains(AvatarField);
}
