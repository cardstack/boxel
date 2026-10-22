// Pretui — Checkbox example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  Stack,
  SUPPLIERS,
  TASKS,
  pick,
  seedFrom,
  take,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { Checkbox } from './checkbox';

// ── Checkbox ─────────────────────────────────────────────────────────────
const CHK = seedFrom('Checkbox');
const chkTasks = take(CHK, 0, 3, TASKS);
const chkTasks0 = chkTasks[0];
const chkTasks1 = chkTasks[1];
const chkTasks2 = chkTasks[2];
const chkSupplier = pick(CHK, 1, SUPPLIERS);
const chkAutoLabel = 'Auto-reorder from ' + chkSupplier;

const CheckboxChecklist: TemplateOnlyComponent = <template>
  <Stack>
    <Checkbox @label={{chkTasks0}} @defaultChecked={{true}} />
    <Checkbox @label={{chkTasks1}} @defaultChecked={{true}} />
    <Checkbox @label={{chkTasks2}} />
  </Stack>
</template>;

const CheckboxAutoReorder: TemplateOnlyComponent = <template>
  <Checkbox @label={{chkAutoLabel}} @defaultChecked={{true}} />
</template>;

const CheckboxLocked: TemplateOnlyComponent = <template>
  <Checkbox
    @label='Organic certificate on file'
    @checked={{true}}
    @disabled={{true}}
  />
</template>;

export const EXAMPLES_CHECKBOX: Record<string, ExampleSpec[]> = {
  Checkbox: [
    {
      title: 'Intake checklist',
      note: 'Work items tick off as the batch moves through the room.',
      component: CheckboxChecklist,
    },
    {
      title: 'Standing preference',
      component: CheckboxAutoReorder,
    },
    {
      title: 'Locked fact',
      note: 'Checked and disabled — recorded upstream, not editable here.',
      component: CheckboxLocked,
    },
  ],
};

