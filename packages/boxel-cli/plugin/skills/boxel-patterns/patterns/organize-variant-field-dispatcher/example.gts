import { FieldDef, StringField, contains, field, Component } from 'https://cardstack.com/base/card-api';

// 🧩 PATTERN: Variant-configuration FieldDef dispatcher
//
// One FieldDef holds the data; configuration.variant picks the edit component.

class RatingConfig extends FieldDef {
  @field variant = contains(StringField); // 'stars' | 'dots' | 'number'
  @field max = contains(StringField);     // store as string, parse at use site
}

class StarsEdit extends Component<typeof RatingField> {
  <template>
    <fieldset class='stars'>
      {{#each (range 1 (max @model.configuration.max 5)) as |n|}}
        <label>
          <input
            type='radio'
            name='star'
            value={{n}}
            checked={{eq @model.value (toString n)}}
            {{on 'change' (set @model.value (toString n))}}
          />
          ★
        </label>
      {{/each}}
    </fieldset>
  </template>
}

class DotsEdit extends Component<typeof RatingField> {
  <template>
    <div class='dots'>
      {{#each (range 1 (max @model.configuration.max 5)) as |n|}}
        <button
          type='button'
          class={{if (gte @model.value (toString n)) 'filled' 'empty'}}
          {{on 'click' (set @model.value (toString n))}}
        >•</button>
      {{/each}}
    </div>
  </template>
}

class NumberEdit extends Component<typeof RatingField> {
  <template>
    <input
      type='number'
      min='0'
      max={{or @model.configuration.max '5'}}
      value={{@model.value}}
      {{on 'input' (set @model.value)}}
    />
  </template>
}

// 🎯 The wrapper FieldDef — short by design.
export class RatingField extends StringField {
  static displayName = 'Rating';

  @field configuration = contains(RatingConfig);

  static edit = class extends Component<typeof RatingField> {
    get variant() { return this.args.model.configuration?.variant ?? 'stars'; }

    <template>
      {{#if (eq this.variant 'stars')}}
        <StarsEdit @model={{@model}} />
      {{else if (eq this.variant 'dots')}}
        <DotsEdit @model={{@model}} />
      {{else}}
        <NumberEdit @model={{@model}} />
      {{/if}}
    </template>
  };
}

// ℹ️ Helper imports (range, eq, gte, max, set, or, toString) come from
// `@cardstack/boxel-ui/helpers`. See boxel/references/quick-reference.md.
