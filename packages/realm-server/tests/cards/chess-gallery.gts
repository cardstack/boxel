import DateField from 'https://cardstack.com/base/date';
import {
  FieldDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';

// This is intentionally using a FieldDef so it can replicate the error in
// https://linear.app/cardstack/issue/CS-7797/indexer-hangs-when-encountering-instance-json-that-refers-to-a-field
export class ChessGallery extends FieldDef {
  @field pgn = contains(StringField);
  @field dateOfGame = contains(DateField);
  @field whitePlayer = contains(StringField);
  @field blackPlayer = contains(StringField);
  static displayName = 'Chess Gallery';

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='chess-gallery-edit'>
        <@fields.whitePlayer />
        <@fields.blackPlayer />
        <@fields.dateOfGame />
        <@fields.pgn />
      </div>
      <style scoped>
        .chess-gallery-edit {
          display: grid;
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='chess-gallery-view'>
        <div class='players'>
          <span class='white'>{{@model.whitePlayer}}</span>
          vs
          <span class='black'>{{@model.blackPlayer}}</span>
        </div>
      </div>
      <style scoped>
        .chess-gallery-view {
          padding: var(--boxel-sp);
        }
        .players {
          font-weight: 600;
          margin-bottom: var(--boxel-sp-xxs);
        }
        .white,
        .black {
          color: var(--boxel-600);
        }
      </style>
    </template>
  };
}
