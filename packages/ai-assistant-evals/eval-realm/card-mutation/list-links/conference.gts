import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class Speaker extends CardDef {
  static displayName = 'Speaker';
  @field fullName = contains(StringField);
  @field company = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Speaker) {
      return this.fullName ?? 'Unnamed speaker';
    },
  });
}

export class Session extends FieldDef {
  static displayName = 'Session';
  // 24-hour HH:MM
  @field time = contains(StringField);
  @field title = contains(StringField);
  @field speaker = linksTo(() => Speaker);
}

export class Conference extends CardDef {
  static displayName = 'Conference';
  @field name = contains(StringField);
  @field date = contains(DateField);
  @field venue = contains(StringField);
  @field sessions = containsMany(Session);
  @field sessionCount = contains(NumberField, {
    computeVia: function (this: Conference) {
      return this.sessions?.length ?? 0;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Conference) {
      return this.name ?? 'Untitled conference';
    },
  });
}
