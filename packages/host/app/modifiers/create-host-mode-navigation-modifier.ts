import Modifier from 'ember-modifier';

import type {
  CardDef,
  FieldType,
  Format,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

interface ModifierNamedArgs {
  card?: CardDef;
  cardId?: string;
  format: Format | 'data';
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
}

type ModifierSignature = {
  Args: {
    Named: ModifierNamedArgs;
  };
};

export function createHostModeNavigationModifier(
  viewCard: ViewCardFn | undefined,
) {
  return class HostModeNavigationModifier extends Modifier<ModifierSignature> {
    private element: HTMLElement | undefined;
    private handler: ((event: MouseEvent) => void) | undefined;

    modify(element: HTMLElement, _positional: [], named: ModifierNamedArgs) {
      this.teardown();

      if (!viewCard || !this.shouldHandle(named)) {
        return;
      }

      let target = this.resolveTarget(named);
      if (!target) {
        return;
      }

      let format = this.normalizeFormat(named.format);
      let options = this.buildOptions(named);

      element.style.cursor = 'pointer';

      this.element = element;
      this.handler = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return;
        }

        viewCard(target, format, options);
      };

      element.addEventListener('click', this.handler);
    }

    willDestroy() {
      this.teardown();
    }

    private teardown() {
      if (this.element && this.handler) {
        this.element.removeEventListener('click', this.handler);
      }
      this.element = undefined;
      this.handler = undefined;
    }

    private resolveTarget(named: ModifierNamedArgs): CardDef | URL | undefined {
      if (named.card) {
        return named.card;
      }

      if (!named.cardId) {
        return undefined;
      }

      try {
        return new URL(named.cardId);
      } catch {
        return undefined;
      }
    }

    private normalizeFormat(format: Format | 'data'): Format | undefined {
      return format === 'data' ? undefined : format;
    }

    private buildOptions(named: ModifierNamedArgs):
      | {
          fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
          fieldName?: string;
        }
      | undefined {
      if (!named.fieldType && !named.fieldName) {
        return undefined;
      }

      return {
        fieldType: named.fieldType,
        fieldName: named.fieldName,
      };
    }

    private shouldHandle(named: ModifierNamedArgs) {
      return (
        named.format === 'data' ||
        named.fieldType === 'linksTo' ||
        named.fieldType === 'linksToMany'
      );
    }
  };
}
