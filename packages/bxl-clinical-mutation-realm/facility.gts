import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class HospitalFacility extends CardDef {
  static displayName = 'Hospital facility';

  @field facilityId = contains(StringField);
  @field name = contains(StringField);
  @field campus = contains(StringField);
  @field switchboard = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: HospitalFacility) {
      return this.name ?? 'Hospital facility';
    },
  });

  static embedded = class extends Component<typeof HospitalFacility> {
    <template>
      <div class='facility'>
        <span class='mark'>N</span>
        <span><strong>{{@model.name}}</strong><small>{{@model.campus}}</small></span>
      </div>
      <style scoped>
        .facility { display: flex; align-items: center; gap: 10px; color: var(--foreground); font-family: var(--font-sans); }
        .mark { width: 34px; height: 34px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font: 800 15px/1 var(--font-serif); }
        .facility > span:last-child { display: grid; }
        strong { font-size: 13px; }
        small { color: var(--muted-foreground); font-size: 11px; }
      </style>
    </template>
  };
}
