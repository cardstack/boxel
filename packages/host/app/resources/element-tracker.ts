import { registerDestructor } from '@ember/destroyable';
import { schedule } from '@ember/runloop';

import Modifier from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

export default class ElementTracker<Meta extends object = object> {
  elements: { element: HTMLElement; meta: Meta }[] = new TrackedArray();

  get trackElement(): typeof Modifier<{ Args: { Named: Meta } }> {
    const tracker = this;
    let observers = new Map<HTMLElement, MutationObserver>();
    return class TrackElement extends Modifier<{ Args: { Named: Meta } }> {
      modify(element: HTMLElement, _pos: unknown, meta: Meta) {
        if (!('card' in meta) && !('cardId' in meta)) {
          throw new Error(
            'ElementTracker: meta.card or meta.cardId is required',
          );
        }
        // Without scheduling this after render, this produces the "attempted to update value, but it had already been used previously in the same computation" type error
        schedule('afterRender', () => {
          let updateTracker = () => {
            let found = tracker.elements.find((e) => e.element === element);
            if (found) {
              tracker.elements.splice(tracker.elements.indexOf(found), 1, {
                element,
                meta: { ...meta },
              });
            } else {
              tracker.elements.push({
                element,
                meta: { ...meta },
              });
            }
          };
          updateTracker();

          // This observer is currently used to track the activity of dragging an item
          // within the linksToMany field for reordering purposes.
          let parentElement = element.parentElement;
          if (
            parentElement &&
            Array.from(parentElement.classList).includes('sortable-item')
          ) {
            let observer = new MutationObserver(updateTracker);
            observer.observe(element.parentElement!, {
              attributes: true,
              attributeFilter: ['class'],
              childList: true,
              subtree: true,
              characterData: true,
            });
            observers.set(element, observer);
          }
        });

        registerDestructor(this, () => {
          let found = tracker.elements.find((e) => e.element === element);
          if (found) {
            tracker.elements.splice(tracker.elements.indexOf(found), 1);
          }
          Array.from(observers.values()).forEach((v) => v.disconnect());
        });
      }
    };
  }
}
