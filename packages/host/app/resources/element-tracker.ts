import { TrackedArray } from 'tracked-built-ins';
import Modifier from 'ember-modifier';
import { registerDestructor } from '@ember/destroyable';

export default class ElementTracker<Meta = unknown> {
  elements: { element: HTMLElement; meta: Meta }[] = new TrackedArray();

  get trackElement(): typeof Modifier<{ Args: { Named: Meta } }> {
    const tracker = this;
    return class TrackElement extends Modifier<{ Args: { Named: Meta } }> {
      modify(element: HTMLElement, _pos: unknown, meta: Meta) {
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

        registerDestructor(this, () => {
          let found = tracker.elements.find((e) => e.element === element);
          if (found) {
            tracker.elements.splice(tracker.elements.indexOf(found), 1);
          }
        });
      }
    };
  }
}
