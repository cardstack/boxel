// Pretui — Input example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  DATES,
  PEOPLE,
  SUPPLIERS,
  pick,
  seedFrom,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { Input } from './input';
import { Field } from './field';

// ── Input ────────────────────────────────────────────────────────────────
const INP = seedFrom('Input');
const inpSupplier = pick(INP, 0, SUPPLIERS);
const inpBadEmail = pick(INP, 1, PEOPLE).split(' ')[0].toLowerCase() + '@silverpeak';
const inpLot = 'LOT-' + pick(INP, 2, DATES).replaceAll('-', '').slice(2);

const InputPrefilled: TemplateOnlyComponent = <template>
  <Field @label='Supplier name' @hint='Public — shows on the order card' as |id|>
    <Input @controlId={{id}} @value={{inpSupplier}} />
  </Field>
</template>;

const InputInvalid: TemplateOnlyComponent = <template>
  <Field
    @label='Contact email'
    @error='This does not look like an email'
    as |id|
  >
    <Input @controlId={{id}} @type='email' @invalid={{true}} @value={{inpBadEmail}} />
  </Field>
</template>;

const InputDisabled: TemplateOnlyComponent = <template>
  <Field @label='Lot code' @hint='Assigned at intake — read-only' as |id|>
    <Input @controlId={{id}} @disabled={{true}} @value={{inpLot}} />
  </Field>
</template>;

export const EXAMPLES_INPUT: Record<string, ExampleSpec[]> = {
  Input: [
    {
      title: 'Prefilled field',
      note: 'Field supplies the label and the reserved message line.',
      component: InputPrefilled,
    },
    {
      title: 'Invalid email',
      note: 'The error replaces the hint without shifting the layout.',
      component: InputInvalid,
    },
    {
      title: 'Read-only lot code',
      note: 'Disabled keeps the value legible for reference.',
      component: InputDisabled,
    },
  ],
};

