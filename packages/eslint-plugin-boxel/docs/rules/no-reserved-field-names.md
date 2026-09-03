# Disallow `@field` declarations under names the system reserves for its own getters (e.g. `screenshotURLs`) (`@cardstack/boxel/no-reserved-field-names`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

Certain property names are provided by the system as getters on
`CardDef`/`FileDef` — `screenshotURLs`, which exposes the durable served URLs
of a card's declared screenshots. A userland `@field` under one of these
names would shadow the system getter via the prototype chain. card-api's
`field` decorator refuses these names at runtime; this rule surfaces the
mistake at authoring time.

## Rule Details

Examples of **incorrect** code for this rule:

```gts
import { field, contains, CardDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

class Product extends CardDef {
  @field screenshotURLs = contains(StringField);
}
```

Examples of **correct** code for this rule:

```gts
import { CardDef, Component } from 'https://cardstack.com/base/card-api';

class Product extends CardDef {
  static fitted = class extends Component<typeof Product> {
    <template>
      {{#if @model.screenshotURLs.card}}
        <img src={{@model.screenshotURLs.card}} alt='preview' />
      {{/if}}
    </template>
  };
}
```

## References

- `RESERVED_FIELD_NAMES` in `packages/base/card-api.gts` — the runtime
  enforcement this rule backstops.
