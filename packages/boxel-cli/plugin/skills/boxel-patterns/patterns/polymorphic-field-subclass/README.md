---
validated: source-proven
---

# polymorphic-field-subclass — Assign a FieldDef subclass instance to a `contains()` field

**What this gives you:** A `contains(BaseField)` slot that can hold any _subclass_ of `BaseField` — and you can SWAP the held value to a different subclass at runtime by assigning a fresh `new SubClass({})` to the model field. The host detects the new type and re-resolves which `static fitted`/`static embedded`/`static edit` template to render.

**When to use:**

- "This field is a Shape — it can be a Circle, a Square, or a Triangle, each with its own editor and visual representation."
- A FieldDef hierarchy where the parent defines the schema and subclasses override rendering (e.g. `Vehicle` → `Car`/`Bike`/`Boat`, with shared `make`/`model` fields and per-type templates).
- "I need to mutate a field from a non-edit component" — assigning a fresh subclass instance is the _legitimate_ way to do this, not `(model as any).field = value`.

**The insight:** `contains(BaseField)` accepts any FieldDef that extends BaseField. The held instance carries its own `displayName` and its own template definitions; the host looks those up when rendering. Subclassing FieldDef and assigning `new SubClass({})` to the slot is a first-class operation.

**Recipe shape:**

```gts
import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';

// Base FieldDef — shared schema + default templates
export class Shape extends FieldDef {
  static displayName = 'Shape';
  @field label = contains(StringField);

  static fitted = class extends Component<typeof this> {
    <template>
      <div data-test-shape='base'>Generic Shape: <@fields.label /></div>
    </template>
  };

  static embedded = class extends Component<typeof this> {
    <template>
      <div>Shape: <@fields.label /></div>
    </template>
  };
}

// Subclass overrides templates, inherits the field schema
export class Circle extends Shape {
  static displayName = 'Circle';

  static fitted = class extends Component<typeof this> {
    <template>
      <div data-test-shape='circle' class='circle'>
        ○
        <@fields.label />
      </div>
      <style scoped>
        .circle {
          border-radius: 50%;
        }
      </style>
    </template>
  };

  static edit = class extends Component<typeof this> {
    <template>
      <label>Circle label: <@fields.label /></label>
    </template>
  };
}

// CardDef hosting the polymorphic slot
export class Drawing extends CardDef {
  static displayName = 'Drawing';

  @field shape = contains(Shape); // accepts Shape OR any subclass

  static isolated = class extends Component<typeof Drawing> {
    morphToCircle = () => {
      this.args.model.shape = new Circle({ label: 'My circle' });
    };

    <template>
      <button {{on 'click' this.morphToCircle}}>Make it a Circle</button>
      <@fields.shape />
    </template>
  };
}
```

**What happens at click:** `this.args.model.shape = new Circle(...)` swaps the held value. The host re-resolves the field templates against `Circle` (not `Shape`), so the `<@fields.shape />` slot now renders `Circle.fitted` with its red border-radius. The mutation is real — the host's save lifecycle picks it up, and the new subclass identity is persisted in the JSON.

**Why this beats `(model as any).field = value`:**

- Type-safe (`Circle extends Shape` — the assignment is valid).
- Persistable (the host serializes `Circle` correctly, preserves the type ref).
- Triggers validation and dirty-tracking.
- Doesn't bypass the framework.

**Gotchas:**

- The held subclass must be a real `FieldDef` subclass, not a plain object. `new Circle({ ... })` — call the constructor.
- Schema additions in the subclass are allowed but the JSON has to carry the type info — the host writes `adoptsFrom` for the subclass automatically.
- For `linksTo`/`linksToMany` (CardDef relationships), you don't subclass — you link to a different card type entirely. This pattern is specifically for `contains(FieldDef)`.
- Don't override `displayName` and forget to override it — the field's identity for the host's lookup uses the displayName + class chain.

**Source:** `~/Projects/boxel/packages/experiments-realm/polymorphic-field.gts` — `TestField` → `SubTestField`, and a `CardWithSpecialFields` whose component mutates `this.args.model.specialField = new SubTestField({})` from a button click. The pattern is tested in the host as the canonical polymorphic-FieldDef behavior.

**See also:** `format-morph-shared-component` (different reuse axis — same component across formats vs. different subclasses in same slot), `organize-variant-field-dispatcher` (the dispatch-by-discriminator alternative when you'd rather match on a tag field than on subclass identity).
