import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MusicIcon from '@cardstack/boxel-icons/music';

export class Song extends CardDef {
  static displayName = 'Song';
  static icon = MusicIcon;

  @field songTitle = contains(StringField);
  @field artist = contains(StringField);
  @field duration = contains(StringField);
  @field genre = contains(StringField);
}
