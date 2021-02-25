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
export default async function ({
  context,
  removedSprites,
  insertedSprites,
  keptSprites,
  duration = 300,
}) {
  // TODO: removes before adds
  let animations = [];
  Array.from(removedSprites).forEach((s) => {
    context.orphansElement.appendChild(s.element);
    s.lockStyles();
    let a = s.element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
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
        duration,
      });
      animations.push(a);
    });

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    context.clearOrphans();
  });
}
