import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Principal extends CardDef {
  static displayName = 'Access principal';

  @field partyId = contains(StringField);
  @field displayName = contains(StringField);
  @field jobTitle = contains(StringField);
  @field principalType = contains(StringField);
  @field department = contains(StringField);
  @field members = linksToMany(() => Principal);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Principal) {
      return this.displayName ?? this.partyId ?? 'Access principal';
    },
  });

  static embedded = class extends Component<typeof Principal> {
    <template>
      <article class='principal'>
        <span class='monogram'>{{@model.displayName.[0]}}</span>
        <span class='copy'>
          <strong>{{@model.displayName}}</strong>
          <span>{{@model.jobTitle}}</span>
        </span>
      </article>
      <style scoped>
        .principal { display: flex; align-items: center; gap: 10px; min-width: 0; font-family: var(--font-sans); }
        .monogram { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 50%; background: var(--muted); color: var(--foreground); font: 700 12px/1 var(--font-mono); }
        .copy { display: grid; min-width: 0; }
        strong { overflow: hidden; color: var(--foreground); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .copy > span { overflow: hidden; color: var(--muted-foreground); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      </style>
    </template>
  };
}
