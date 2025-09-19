import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import AvatarField from '../fields/avatar';

export class Player extends CardDef {
  static displayName = 'Player';
  @field avatar = contains(AvatarField, {
    description: 'Avatar for the player',
  });
  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: Player) {
      return this.avatar?.thumbnailURL;
    },
  });
}
