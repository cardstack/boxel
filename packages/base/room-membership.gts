import {
  contains,
  field,
  Component,
  primitive,
  useIndexBasedKey,
  FieldDef,
} from './card-api';
import StringField from './string';
import DateTimeField from './datetime';

class RoomMemberView extends Component<typeof RoomMemberField> {
  <template>
    <div class='container'>
      <div>
        User ID:
        {{@model.userId}}
      </div>
      <div>
        Name:
        {{@model.displayName}}
      </div>
      <div>
        Membership:
        {{@model.membership}}
      </div>
    </div>
    <style>
      .container {
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

class RoomMembershipField extends FieldDef {
  static [primitive]: 'invite' | 'join' | 'leave';
  static [useIndexBasedKey]: never;
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  // The edit template is meant to be read-only, this field card is not mutable, room state can only be changed via matrix API
  static edit = class Edit extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

export class RoomMemberField extends FieldDef {
  @field userId = contains(StringField);
  @field roomId = contains(StringField);
  @field displayName = contains(StringField);
  @field membership = contains(RoomMembershipField);
  @field membershipDateTime = contains(DateTimeField);
  @field membershipInitiator = contains(StringField);
  @field name = contains(StringField, {
    computeVia: function (this: RoomMemberField) {
      return this.displayName ?? this.userId?.split(':')[0].substring(1);
    },
  });
  static embedded = class Embedded extends RoomMemberView {};
  static isolated = class Isolated extends RoomMemberView {};
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends RoomMemberView {};
}
