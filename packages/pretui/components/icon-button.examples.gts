// Pretui — IconButton example gallery.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  Lab,
  Mono,
  Row,
  SUPPLIERS,
  TEAS,
  pick,
  seedFrom,
} from '../examples-kit';
import type { ExampleSpec } from '../examples-kit';
import { IconButton } from './icon-button';

// ── IconButton ───────────────────────────────────────────────────────────
const IBT = seedFrom('IconButton');
const ibtTea = pick(IBT, 0, TEAS);
const ibtSupplier = pick(IBT, 1, SUPPLIERS);

const IconButtonToolbar: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ibtTea}}</Lab>
    <IconButton @variant='ghost' @label='Edit'>✎</IconButton>
    <IconButton @variant='ghost' @label='Duplicate'>⧉</IconButton>
    <IconButton @variant='ghost' @label='More'>⋯</IconButton>
  </Row>
</template>;

const IconButtonRemove: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ibtSupplier}}</Lab>
    <IconButton @variant='destructive' @label='Remove supplier'>✕</IconButton>
  </Row>
</template>;

const IconButtonPager: TemplateOnlyComponent = <template>
  <Row>
    <IconButton @variant='secondary' @label='Previous page'>‹</IconButton>
    <Mono>3 / 7</Mono>
    <IconButton @variant='secondary' @label='Next page'>›</IconButton>
  </Row>
</template>;

export const EXAMPLES_ICON_BUTTON: Record<string, ExampleSpec[]> = {
  IconButton: [
    {
      title: 'Toolbar cluster',
      note: 'Ghost trio at the end of a record header.',
      component: IconButtonToolbar,
    },
    {
      title: 'Destructive remove',
      note: 'The label rides aria-label and the tooltip — never the face.',
      component: IconButtonRemove,
    },
    {
      title: 'Pager pair',
      note: 'Mono counter between secondary steppers.',
      component: IconButtonPager,
    },
  ],
};

