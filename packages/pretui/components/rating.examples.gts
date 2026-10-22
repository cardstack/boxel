// Pretui — Rating example gallery.
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
import { Rating } from './rating';

// ── Rating ───────────────────────────────────────────────────────────────
const RAT = seedFrom('Rating');
const ratTea = pick(RAT, 0, TEAS);
const ratSupplier = pick(RAT, 1, SUPPLIERS);
const ratLabel = 'Rate this ' + ratTea;
const ratCupCount = '(' + String((RAT % 40) + 12) + ' cuppings)';

const RatingBatch: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ratTea}}</Lab>
    <Rating @defaultValue={{4}} @label={{ratLabel}} />
  </Row>
</template>;

const RatingAverage: TemplateOnlyComponent = <template>
  <Row>
    <Rating
      @value={{3.5}}
      @precision={{0.5}}
      @readonly={{true}}
      @label='Average cupping score'
    />
    <Mono>{{ratCupCount}}</Mono>
  </Row>
</template>;

const RatingScorecard: TemplateOnlyComponent = <template>
  <Row>
    <Lab>{{ratSupplier}}</Lab>
    <Rating @value={{4}} @readonly={{true}} @label='Supplier score' />
  </Row>
</template>;

export const EXAMPLES_RATING: Record<string, ExampleSpec[]> = {
  Rating: [
    {
      title: 'Rate a batch',
      note: 'Editable — hover previews, click commits.',
      component: RatingBatch,
    },
    {
      title: 'Average, half stars',
      note: 'Read-only at 0.5 precision with the sample size in mono.',
      component: RatingAverage,
    },
    {
      title: 'Scorecard row',
      note: 'As worn in the supplier review list.',
      component: RatingScorecard,
    },
  ],
};

