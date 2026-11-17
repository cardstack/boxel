// Pretui — Button example gallery: real compositions worn at the foot of the
// Button workbench page, not knob rigs.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Button } from './button';
import {
  PLACES,
  Row,
  SUPPLIERS,
  TEAS,
  pick,
  seedFrom,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';

// ── Button ───────────────────────────────────────────────────────────────
const BTN = seedFrom('Button');
const btnTea = pick(BTN, 0, TEAS);
const btnPlace = pick(BTN, 1, PLACES);
const btnSupplier = pick(BTN, 2, SUPPLIERS);

const ButtonDialogFooter: TemplateOnlyComponent = <template>
  <Row>
    <Button @tone='neutral' @appearance='outlined'>Keep selling</Button>
    <Button @tone='danger' @appearance='accent'>Retire it</Button>
  </Row>
</template>;

const ButtonBusyPublish: TemplateOnlyComponent = <template>
  <Row>
    <Button @tone='primary' @appearance='accent' @busy={{true}}>Publishing…</Button>
    <Button @tone='neutral' @appearance='plain' @disabled={{true}}>Discard</Button>
  </Row>
</template>;

const longName = btnSupplier + ' Wholesale Provisions and Trading';

const ButtonLongLabel: TemplateOnlyComponent = <template>
  <div class='lane'>
    <Button @tone='neutral' @appearance='outlined' title={{longName}} class='who'>
      <span class='who-name'>{{longName}}</span>
    </Button>
  </div>
  <style scoped>
    .lane {
      inline-size: 11rem;
    }
    .who {
      max-inline-size: 100%;
    }
    .who-name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</template>;

const ButtonRowActions: TemplateOnlyComponent = <template>
  <Row>
    <Button @tone='neutral' @appearance='plain' @size='xs'>Open</Button>
    <Button @tone='neutral' @appearance='plain' @size='xs'>Duplicate</Button>
    <Button @tone='danger' @appearance='plain' @size='xs'>Retire</Button>
  </Row>
</template>;

export const EXAMPLES_BUTTON: Record<string, ExampleSpec[]> = {
  Button: [
    {
      title: 'Dialog-footer pair',
      note:
        'Confirming retirement of “' +
        btnTea +
        '” — outlined keeps the safe exit, danger accent carries the point of no return.',
      component: ButtonDialogFooter,
    },
    {
      title: 'Busy while publishing',
      note:
        'The seasonal menu for ' +
        btnPlace +
        ' mid-save — busy locks the pair until the write lands.',
      component: ButtonBusyPublish,
    },
    {
      title: 'Row actions at xs',
      note: 'Plain xs row as worn beside ' + btnSupplier + ' in the DataGrid.',
      component: ButtonRowActions,
    },
    {
      title: 'Long label in a narrow lane',
      note: 'The label shrinks to the button, so a child that sets its own ellipsis truncates instead of spilling past both edges.',
      component: ButtonLongLabel,
    },
  ],
};
