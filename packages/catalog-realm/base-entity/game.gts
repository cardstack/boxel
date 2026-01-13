import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

import GamepadIcon from '@cardstack/boxel-icons/gamepad-2';

export class Game extends CardDef {
  static displayName = 'Game';
  static icon = GamepadIcon;

  @field cardTitle = contains(StringField);
  @field cardDescription = contains(MarkdownField);
  @field genre = contains(StringField);
}
