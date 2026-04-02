import { CardDef, field, contains } from '@cardstack/base/card-api';

import StringField from '@cardstack/base/string';
import MarkdownField from '@cardstack/base/markdown';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';

export class Game extends CardDef {
  static displayName = 'Game';
  static icon = GamepadIcon;

  @field cardTitle = contains(StringField);
  @field cardDescription = contains(MarkdownField);
  @field genre = contains(StringField);
}
