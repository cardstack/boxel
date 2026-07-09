/**
 * Shared parse test fixtures used by `parse-validation.spec.ts` (which
 * tests the full `ParseValidationStep` including `ParseResult` artifact
 * creation) and `run-parse-in-memory.spec.ts` (which tests the in-memory
 * agent tool). Keeping the canonical valid / broken samples in one place
 * means both specs drift together.
 */

/**
 * A valid `.gts` card module — intentionally simple (no
 * `Component<typeof X>`) to avoid BaseDef constraint errors that vary
 * between CI and local type resolution environments.
 */
export const VALID_MODULE_GTS = `import {
  CardDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class ParseTestCard extends CardDef {
  static displayName = 'Parse Test Card';
  @field name = contains(StringField);
}
`;

/**
 * A `.gts` module with an unclosed template tag (GTS syntax error). Glint
 * reports it as a template parse error.
 */
export const BROKEN_TEMPLATE_GTS = `import {
  CardDef,
  Component,
} from '@cardstack/base/card-api';

export class BrokenCard extends CardDef {
  static displayName = 'Broken Card';
  static isolated = class Isolated extends Component<typeof BrokenCard> {
    <template>
      <div>Hello world</div>
  };
}
`;

/** A valid card document JSON matching `VALID_MODULE_GTS`. */
export const VALID_EXAMPLE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: { name: 'Valid Example' },
      meta: {
        adoptsFrom: {
          module: '../parse-test-card',
          name: 'ParseTestCard',
        },
      },
    },
  },
  null,
  2,
);

/** Card document JSON missing the required `adoptsFrom` block. */
export const BROKEN_EXAMPLE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: { name: 'Broken Example' },
      meta: {},
    },
  },
  null,
  2,
);
