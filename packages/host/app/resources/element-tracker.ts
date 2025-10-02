import { registerDestructor } from '@ember/destroyable';
import { schedule } from '@ember/runloop';
import { SafeString } from '@ember/template';

import Modifier from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

interface Meta {
  cardId?: string;
  card?: CardDef;
  format: Format | 'data';
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
}

export interface RenderedCardForOverlayActions {
  element: HTMLElement;
  cardDefOrId: CardDef | string;
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
  format: Format | 'data';
  overlayZIndexStyle?: SafeString;
}

export default class ElementTracker {
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

  filter(
    conditions: Partial<Meta>[],
    operator: 'and' | 'or' = 'and',
  ): RenderedCardForOverlayActions[] {
    const checkCondition = (
      entry: { element: HTMLElement; meta: Meta },
      condition: Partial<Meta>,
    ) => {
      return Object.keys(condition).every((key) => {
        return entry.meta[key as keyof Meta] === condition[key as keyof Meta];
      });
    };
    const filteredElements = this.elements.filter((entry) => {
      if (operator === 'and') {
        return conditions.every((condition) =>
          checkCondition(entry, condition),
        );
      } else {
        return conditions.some((condition) => checkCondition(entry, condition));
      }
    });

    return filteredElements.map((entry) => ({
      element: entry.element,
      cardDefOrId: entry.meta.card || entry.meta.cardId!,
      fieldType: entry.meta.fieldType,
      fieldName: entry.meta.fieldName,
      format: entry.meta.format,
    }));
  }
}
