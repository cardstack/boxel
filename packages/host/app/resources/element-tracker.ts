import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import type { SafeString } from '@ember/template';

import Modifier from 'ember-modifier';
import { TrackedArray } from 'tracked-built-ins';

import type { CardDef, Format, FieldType } from '@cardstack/base/card-api';

import type { ArgsFor } from 'ember-modifier';

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
  readonly trackElement: typeof Modifier<{ Args: { Named: Meta } }>;

  constructor() {
    const tracker = this;

    this.trackElement = class TrackElement extends Modifier<{
      Args: { Named: Meta };
    }> {
      private element: HTMLElement | undefined;
      private meta: Meta | undefined;
      private observer: MutationObserver | undefined;
      private isDestroyed = false;

      constructor(owner: Owner, args: ArgsFor<{ Args: { Named: Meta } }>) {
        super(owner, args);
        registerDestructor(this, () => {
          this.isDestroyed = true;
          this.teardown();
        });
      }

      modify(element: HTMLElement, _pos: unknown, meta: Meta) {
        if (!('card' in meta) && !('cardId' in meta)) {
          throw new Error(
            'ElementTracker: meta.card or meta.cardId is required',
          );
        }

        this.element = element;
        this.meta = { ...meta };

        // Without scheduling this after render, this produces the
        // "attempted to update value, but it had already been used previously
        // in the same computation" type error.
        schedule('afterRender', () => {
          if (this.isDestroyed || !this.element || !this.meta) {
            return;
          }

          this.updateTracker(tracker);
          this.syncObserver();
        });
      }

      private updateTracker(tracker: ElementTracker) {
        if (!this.element || !this.meta) {
          return;
        }

        let found = tracker.elements.find(
          (entry) => entry.element === this.element,
        );
        if (found) {
          tracker.elements.splice(tracker.elements.indexOf(found), 1, {
            element: this.element,
            meta: this.meta,
          });
        } else {
          tracker.elements.push({
            element: this.element,
            meta: this.meta,
          });
        }
      }

      private syncObserver() {
        this.observer?.disconnect();
        this.observer = undefined;

        let parentElement = this.element?.parentElement;
        if (
          parentElement &&
          Array.from(parentElement.classList).includes('sortable-item')
        ) {
          let observer = new MutationObserver(() =>
            this.updateTracker(tracker),
          );
          observer.observe(parentElement, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
            characterData: true,
          });
          this.observer = observer;
        }
      }

      private teardown() {
        this.observer?.disconnect();
        this.observer = undefined;

        if (this.element) {
          let found = tracker.elements.find(
            (entry) => entry.element === this.element,
          );
          if (found) {
            tracker.elements.splice(tracker.elements.indexOf(found), 1);
          }
        }

        this.element = undefined;
        this.meta = undefined;
      }
    };
  }

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
