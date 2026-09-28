// Pretui — Select example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  PLACES,
  SUPPLIERS,
  seedFrom,
  slugOf,
  take,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { Select } from './select';
import type { SelectOption } from './select';
import { Field } from './field';

// ── Select ───────────────────────────────────────────────────────────────
const SEL = seedFrom('Select');
const selCurrencies: SelectOption[] = [
  { value: 'usd', label: 'USD — US dollar' },
  { value: 'cny', label: 'CNY — Chinese yuan' },
  { value: 'jpy', label: 'JPY — Japanese yen' },
  { value: 'inr', label: 'INR — Indian rupee' },
  { value: 'kes', label: 'KES — Kenyan shilling' },
  { value: 'eur', label: 'EUR — Euro' },
];
const selSupplierOptions: SelectOption[] = take(SEL, 0, 8, SUPPLIERS).map(
  (s) => ({ value: slugOf(s), label: s }),
);
const selSupplierDefault = selSupplierOptions[2]?.value;
const selPlaceOptions: SelectOption[] = take(SEL, 1, 5, PLACES).map((p) => ({
  value: slugOf(p),
  label: p,
}));

const SelectCurrency: TemplateOnlyComponent = <template>
  <Field @label='Settlement currency' as |id|>
    <Select @controlId={{id}} @options={{selCurrencies}} @defaultValue='usd' />
  </Field>
</template>;

const SelectSupplier: TemplateOnlyComponent = <template>
  <Field @label='Preferred supplier' as |id|>
    <Select
      @controlId={{id}}
      @options={{selSupplierOptions}}
      @defaultValue={{selSupplierDefault}}
    />
  </Field>
</template>;

const SelectPlaceholder: TemplateOnlyComponent = <template>
  <Field @label='Origin region' @hint='Filters the incoming-lot ledger' as |id|>
    <Select
      @controlId={{id}}
      @options={{selPlaceOptions}}
      @placeholder='Choose an origin'
    />
  </Field>
</template>;

export const EXAMPLES_SELECT: Record<string, ExampleSpec[]> = {
  Select: [
    {
      title: 'Currency picker',
      note: 'A chosen value — the trigger reads as the answer.',
      component: SelectCurrency,
    },
    {
      title: 'Supplier picker',
      note: 'Eight options — long enough that the listbox grows its search box.',
      component: SelectSupplier,
    },
    {
      title: 'Awaiting a choice',
      note: 'Placeholder ink until an origin is picked.',
      component: SelectPlaceholder,
    },
  ],
};

