import { schedule } from '@ember/runloop';
import type { SafeString } from '@ember/template';

import { modifier } from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

import type {
  CardDef,
  Format,
  FieldType,
} from 'https://cardstack.com/base/card-api';

type Meta = {
  cardId?: string;
  card?: CardDef;
  format: Format | 'data';
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
};

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

  private observers = new Map<HTMLElement, MutationObserver>();

  trackElement = modifier((element: HTMLElement, _pos: unknown, meta: Meta) => {
    if (!('card' in meta) && !('cardId' in meta)) {
      throw new Error('ElementTracker: meta.card or meta.cardId is required');
    }
    // Without scheduling this after render, this produces the "attempted to update value, but it had already been used previously in the same computation" type error
    schedule('afterRender', () => {
      let updateTracker = () => {
        let found = this.elements.find((e) => e.element === element);
        if (found) {
          this.elements.splice(this.elements.indexOf(found), 1, {
            element,
            meta: { ...meta },
          });
        } else {
          this.elements.push({
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
        this.observers.set(element, observer);
      }
    });

    return () => {
      let found = this.elements.find((e) => e.element === element);
      if (found) {
        this.elements.splice(this.elements.indexOf(found), 1);
      }
      Array.from(this.observers.values()).forEach((v) => v.disconnect());
    };
  });

  filter(
    conditions: Partial<Meta>[],
    operator: 'and' | 'or' = 'and',
    opts?: { exclude?: Partial<Meta>[] },
  ): RenderedCardForOverlayActions[] {
    const checkCondition = (
      entry: { element: HTMLElement; meta: Meta },
      condition: Partial<Meta>,
    ) => {
      return Object.keys(condition).every((key) => {
        return entry.meta[key as keyof Meta] === condition[key as keyof Meta];
      });
    };
    let excludes = opts?.exclude ?? [];

    const filteredElements = this.elements.filter((entry) => {
      if (excludes.length > 0) {
        let isExcluded = excludes.some((condition) =>
          checkCondition(entry, condition),
        );
        if (isExcluded) {
          return false;
        }
      }

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
