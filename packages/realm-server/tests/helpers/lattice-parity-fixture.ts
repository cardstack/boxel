import { rri, type LooseSingleCardDocument } from '@cardstack/runtime-common';

export const latticeParitySource = `
  import { bxl } from '@cardstack/bxl';
  import { CardDef, FieldDef, Component, field, contains, containsMany, linksToMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';
  const formula = (expression) => bxl(expression, { libraries: ['core'], readableSyntax: false });

  export class Rating extends FieldDef {
    @field metric = contains(StringField);
    @field points = contains(NumberField);
  }
  export class Observation extends CardDef {
    @field room = contains(StringField);
    @field status = contains(StringField);
    @field ratings = containsMany(Rating);
    @field score = contains(NumberField, { computeVia: formula('[.ratings[].points] | add // 0') });
    @field cardTitle = contains(StringField, { computeVia: formula('.room + ": " + .status') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.score}}</output></template>
    };
  }
  export class Day extends CardDef {
    static materialized = true;
    static queryInputs = { observations: {}, selected: {} };
    @field room = contains(StringField);
    @field observations = linksToMany(Observation, {
      query: { filter: { eq: { room: '$this.room' } }, page: { size: 20 } },
    });
    @field submittedIds = containsMany(StringField, {
      computeVia: formula('[.observations[] | select(.status == "done") | .id]'),
    });
    @field selected = linksToMany(Observation, {
      query: { filter: { in: { id: '$this.submittedIds' } }, page: { size: 20 } },
    });
    @field total = contains(NumberField, { computeVia: formula('[.selected[].score] | add // 0') });
    @field postedCount = contains(NumberField, { computeVia: formula('.selected | length') });
    @field cardTitle = contains(StringField, { computeVia: formula('.room + " day') });
    static isolated = class extends Component<typeof this> {
      <template><output>{{@model.cardTitle}}: {{@model.postedCount}} / {{@model.total}}</output></template>
    };
  }
`;

function card(
  realmURL: string,
  name: string,
  attributes: Record<string, unknown>,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(realmURL + 'cards'), name } },
    },
  };
}

export function latticeParityFixtures(realmURL: string) {
  return {
    'Observation/one.json': card(realmURL, 'Observation', {
      room: 'blue',
      status: 'done',
      ratings: [
        { metric: 'focus', points: 2 },
        { metric: 'care', points: 3 },
      ],
    }),
    'Observation/two.json': card(realmURL, 'Observation', {
      room: 'blue',
      status: 'draft',
      ratings: [],
    }),
    'Observation/three.json': card(realmURL, 'Observation', {
      room: 'red',
      status: 'done',
      ratings: [{ metric: 'focus', points: 7 }],
    }),
    'Day/blue.json': card(realmURL, 'Day', { room: 'blue' }),
    'Day/empty.json': card(realmURL, 'Day', { room: 'empty' }),
  };
}
