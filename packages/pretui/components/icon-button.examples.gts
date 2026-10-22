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
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import CopyIcon from '@cardstack/boxel-icons/copy';
import EllipsisIcon from '@cardstack/boxel-icons/ellipsis';
import PencilIcon from '@cardstack/boxel-icons/pencil';
import XIcon from '@cardstack/boxel-icons/x';
import { IconButton } from './icon-button';

// ── IconButton ───────────────────────────────────────────────────────────
const IBT = seedFrom('IconButton');
const ibtTea = pick(IBT, 0, TEAS);
const ibtSupplier = pick(IBT, 1, SUPPLIERS);

const IconButtonToolbar: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ibtTea}}</Lab>
    <IconButton @appearance='plain' @label='Edit' @icon={{PencilIcon}} />
    <IconButton @appearance='plain' @label='Duplicate' @icon={{CopyIcon}} />
    <IconButton @appearance='plain' @label='More' @icon={{EllipsisIcon}} />
  </Row>
</template>;

const IconButtonRemove: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ibtSupplier}}</Lab>
    <IconButton @tone='danger' @appearance='accent' @label='Remove supplier' @icon={{XIcon}} />
  </Row>
</template>;

const IconButtonPager: TemplateOnlyComponent = <template>
  <Row>
    <IconButton @label='Previous page' @icon={{ChevronLeftIcon}} />
    <Mono>3 / 7</Mono>
    <IconButton @label='Next page' @icon={{ChevronRightIcon}} />
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

