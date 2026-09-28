// Pretui — Switch example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  Lab,
  Row,
  Stack,
  SUPPLIERS,
  pick,
  seedFrom,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { Switch } from './switch';

// ── Switch ───────────────────────────────────────────────────────────────
const SWI = seedFrom('Switch');
const swiSupplier = pick(SWI, 0, SUPPLIERS);
const swiPortalLabel = 'Sync with the ' + swiSupplier + ' portal';

const SwitchPrefs: TemplateOnlyComponent = <template>
  <Stack>
    <Row>
      <Switch @defaultChecked={{true}} />
      <Lab>Alert on price changes</Lab>
    </Row>
    <Row>
      <Switch />
      <Lab>Auto-publish the seasonal menu</Lab>
    </Row>
  </Stack>
</template>;

const SwitchGuarded: TemplateOnlyComponent = <template>
  <Row>
    <Switch @disabled={{true}} />
    <Lab>{{swiPortalLabel}}</Lab>
  </Row>
</template>;

export const EXAMPLES_SWITCH: Record<string, ExampleSpec[]> = {
  Switch: [
    {
      title: 'Notification preferences',
      note: 'Label text sits beside the control, sentence case.',
      component: SwitchPrefs,
    },
    {
      title: 'Guarded until ready',
      note: 'Disabled until portal credentials land.',
      component: SwitchGuarded,
    },
  ],
};

