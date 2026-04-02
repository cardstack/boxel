import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
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
