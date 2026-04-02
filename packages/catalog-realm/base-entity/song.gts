import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import MusicIcon from '@cardstack/boxel-icons/music';

export class Song extends CardDef {
  static displayName = 'Song';
  static icon = MusicIcon;

  @field songTitle = contains(StringField);
  @field artist = contains(StringField);
  @field duration = contains(StringField);
  @field genre = contains(StringField);
}
