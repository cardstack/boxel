import { assert } from '@ember/debug';
import Changeset from '../models/changeset';
/**
  Fades inserted, removed, and kept sprites.

  ```js
  import fade from 'ember-animated/transitions/fade';

  export default Component.extend({
    transition: fade
  });
  ```

  ```hbs
  {{#animated-if use=transition}}
    ...
  {{/animated-if}}
  ```

  @function fade
  @export default
*/
const FADE_DURATION = 300;

export default async function ({
  context,
  removedSprites,
  insertedSprites,
  keptSprites,
}: Changeset): Promise<void> {
  // TODO: removes before adds
  let animations: Animation[] = [];
  Array.from(removedSprites).forEach((s) => {
    assert('context has an orphansElement', context.orphansElement);
    context.orphansElement.appendChild(s.element);
    s.lockStyles();
    let a = s.element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: FADE_DURATION,
    });
    animations.push(a);
  });

  // TODO: if we get keptSprites of some things
  // were fading out and then we should get interrupted and decide to
  // keep them around after all.
  Array.from(insertedSprites)
    .concat(Array.from(keptSprites))
    .forEach((s) => {
      let a = s.element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: FADE_DURATION,
      });
      animations.push(a);
    });

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    context.clearOrphans();
  });
}
