import { expression, fx } from '@cardstack/bxl';
import { CardDef, field, contains } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

// `@cardstack/bxl` is a workspace package rather than a boxel-cli
// dependency, so it reaches card code through a path alias onto the
// bundled source. Its `.ts` sources are the type surface consumers
// compile against, so a wrong formula argument is a real diagnostic
// here — not a module silently resolved as `any`.
export class Invoice extends CardDef {
  static displayName = 'Invoice';
  @field paidAmount = contains(NumberField);
  @field reserveAmount = contains(NumberField);
  @field total = contains(NumberField, {
    computeVia: expression(fx`ROUND((PaidAmount + ReserveAmount) * 100) / 100`),
  });
}
