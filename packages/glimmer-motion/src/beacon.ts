/**
 * `{{beacon 'trash'}}` — claim a name for this element's box.
 *
 * The element takes no part in any changeset and is never animated. A <Choreo>
 * step reads its measurement to give another sprite a fake start or a fake end:
 *
 *   <button type='button' {{beacon 'trash'}}>Trash</button>
 *   <c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} />
 *
 * See choreo/beacons.ts for why the registry is global, and why this is not
 * `layoutId`.
 */
import { modifier } from 'ember-modifier';

import { registerBeacon } from './choreo/beacons.ts';

export const beacon = modifier((element: Element, positional: [string]) => {
  const name = positional[0];
  if (!name) {
    return;
  }
  return registerBeacon(name, element);
});

export default beacon;
