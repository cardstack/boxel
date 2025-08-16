import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MusicIcon from '@cardstack/boxel-icons/music';

export class MusicAlbumCard extends CardDef {
  static displayName = 'MusicAlbum';
  static icon = MusicIcon;

  @field albumTitle = contains(StringField);
  @field artist = contains(StringField);
  @field releaseYear = contains(NumberField);
  @field genre = contains(StringField);
  @field recordLabel = contains(StringField);
  @field producer = contains(StringField);
}
