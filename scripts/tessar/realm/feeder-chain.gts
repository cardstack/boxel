import {
  Component,
  field,
  contains,
  linksToMany,
  NumberField,
} from '@cardstack/base/card-api';
import { TessarRecord, DaySummary } from './tessar';

const tessarPending = (state: string) => state === 'pending';

// A deliberately long acyclic chain: one initially dirty leaf is insufficient
// to bound the number of waves needed to refresh all downstream consumers.
class TessarFeederOutput extends TessarRecord {
  static tessarMaterialized = true;

  @field scoreTotal = contains(NumberField, {
    computeVia: function (this: TessarFeederOutput) {
      return ((this as any).inputs ?? []).reduce(
        (sum: number, input: any) => sum + input.scoreTotal,
        0,
      );
    },
  });

  static isolated = class extends Component<typeof TessarFeederOutput> {
    <template>
      <article data-tessar-feeder-state={{@model.tessarState}}>
        <h1>Tessar feeder chain</h1>
        {{#if (tessarPending @model.tessarState)}}
          <p role='status'>Updating results…</p>
        {{else}}
          <p>Score:
            <span data-tessar-feeder-score>{{@model.scoreTotal}}</span></p>
        {{/if}}
      </article>
    </template>
  };
}

const query = {
  filter: { eq: { classroomKey: '$this.classroomKey', day: '$this.day' } },
  page: { size: 2000 },
};

export class TessarStage0 extends TessarFeederOutput {
  @field inputs = linksToMany(DaySummary, { query });
}
export class TessarStage1 extends TessarFeederOutput {
  @field inputs = linksToMany(TessarStage0, { query });
}
export class TessarStage2 extends TessarFeederOutput {
  @field inputs = linksToMany(TessarStage1, { query });
}
export class TessarStage3 extends TessarFeederOutput {
  @field inputs = linksToMany(TessarStage2, { query });
}
export class TessarStage4 extends TessarFeederOutput {
  @field inputs = linksToMany(TessarStage3, { query });
}
