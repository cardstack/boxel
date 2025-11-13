import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import { Button } from '@cardstack/boxel-ui/components';
import { IconTrash } from '@cardstack/boxel-ui/icons';
import Wand from '@cardstack/boxel-icons/wand';
import {
  type Query,
  type PrerenderedCardLike,
} from '@cardstack/runtime-common';
import ThemeCodeRefField from './fields/theme-code-ref';
import PaginatedCards from './components/paginated-cards';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export class ThemeCreator extends CardDef {
  static displayName = 'Theme Creator';

  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(ThemeCodeRefField);
  @field numberOfVariants = contains(NumberField);

  static isolated = class Isolated extends Component<typeof ThemeCreator> {
    get canGenerate() {
      return Boolean(this.args.model.realm && this.args.model.codeRef);
    }

    get isGenerateDisabled() {
      return !this.canGenerate;
    }

    get selectedRealm(): string | null {
      let realm = this.args.model.realm;
      if (typeof realm !== 'string') {
        return null;
      }
      let trimmed = realm.trim();
      return trimmed.length ? trimmed : null;
    }

    get codeRefSelection() {
      let ref = this.args.model.codeRef;
      if (ref && ref.module && ref.name) {
        return ref;
      }
      return null;
    }

    get generatedCardsRealms(): string[] {
      return this.selectedRealm ? [this.selectedRealm] : [];
    }

    get generatedCardsQuery(): Query | undefined {
      let ref = this.codeRefSelection;
      if (!ref) {
        return undefined;
      }
      return {
        filter: {
          type: {
            module: ref.module,
            name: ref.name,
          },
        },
        sort: [
          {
            by: 'createdAt',
            direction: 'desc',
          },
        ],
      };
    }

    get canShowGeneratedCards(): boolean {
      return Boolean(
        this.generatedCardsQuery && this.generatedCardsRealms.length,
      );
    }

    get generatedCardsHint(): string {
      if (!this.selectedRealm && !this.codeRefSelection) {
        return 'Select a realm and theme type to preview matching cards.';
      }
      if (!this.selectedRealm) {
        return 'Select a realm to preview cards.';
      }
      if (!this.codeRefSelection) {
        return 'Select a theme type to preview cards.';
      }
      return 'Update the selections above to preview cards.';
    }

    get newlyGeneratedCardsQuery(): Query | undefined {
      let ref = this.codeRefSelection;
      if (!ref) {
        return undefined;
      }
      return {
        filter: {
          type: {
            module: ref.module,
            name: ref.name,
          },
        },
        sort: [
          {
            by: 'createdAt',
            direction: 'desc',
          },
        ],
      };
    }

    get canShowNewlyGeneratedCards(): boolean {
      return Boolean(
        this.newlyGeneratedCardsQuery && this.generatedCardsRealms.length,
      );
    }

    get newlyGeneratedCardsHint(): string {
      if (!this.selectedRealm && !this.codeRefSelection) {
        return 'Select a realm and theme type to preview newly generated cards.';
      }
      if (!this.selectedRealm) {
        return 'Select a realm to preview newly generated cards.';
      }
      if (!this.codeRefSelection) {
        return 'Select a theme type to preview newly generated cards.';
      }
      return 'Generate themes to see newly created cards here.';
    }

    <template>
      <section class='theme-creator'>
        <header class='theme-creator__header'>
          <h2>Describe the theme you want to create</h2>
        </header>

        <div class='theme-creator__layout'>
          <div class='theme-creator__prompt-pane theme-creator__meta-field'>
            <label class='theme-creator__label'>Prompt</label>
            <p class='theme-creator__description'>
              Instruction to AI describing the type of theme (e.g., “a bold red
              festival kit”).
            </p>
            <@fields.prompt @format='edit' />
          </div>

          <aside class='theme-creator__meta-pane'>
            <div class='theme-creator__meta-field'>
              <label class='theme-creator__label'>Realm</label>
              <p class='theme-creator__description'>
                Where the generated theme card will be installed.
              </p>
              <@fields.realm @format='edit' />
            </div>

            <div class='theme-creator__meta-field'>
              <label class='theme-creator__label'>Code reference</label>
              <p class='theme-creator__description'>
                Choose the theme type you want to generate.
              </p>
              <@fields.codeRef @format='edit' />
            </div>

            <div class='theme-creator__meta-field'>
              <label class='theme-creator__label'>Number of variants</label>
              <p class='theme-creator__description'>
                How many different generations to produce in one run.
              </p>
              <@fields.numberOfVariants @format='edit' />
            </div>
          </aside>
        </div>

        <div class='theme-creator__actions'>
          <Button
            @kind='primary'
            disabled={{this.isGenerateDisabled}}
          >Generate</Button>
        </div>

        <section class='theme-creator__generated'>
          <div class='theme-creator__section-header'>
            <h2>Newly Generated Theme Cards</h2>
            <p class='theme-creator__description'>
              Preview newly generated theme cards in this realm.
            </p>
          </div>

          {{#if this.canShowNewlyGeneratedCards}}
            <PaginatedCards
              @query={{this.newlyGeneratedCardsQuery}}
              @realms={{this.generatedCardsRealms}}
              @context={{@context}}
              as |card|
            >
              <div class='theme-creator__card-wrapper'>
                <card.component />
                <div class='theme-creator__card-actions'>
                  <label class='theme-creator__checkbox'>
                    <input type='checkbox' />
                  </label>
                  <Button @kind='secondary-light' @size='small'>
                    <Wand width='14' height='14' />
                  </Button>
                  <Button @kind='destructive' @size='small'>
                    <IconTrash width='14' height='14' />
                  </Button>
                </div>
              </div>
            </PaginatedCards>
          {{else}}
            <p class='theme-creator__hint'>{{this.newlyGeneratedCardsHint}}</p>
          {{/if}}
        </section>

        <section class='theme-creator__generated'>
          <div class='theme-creator__section-header'>
            <h2>Existing Theme Cards</h2>
            <p class='theme-creator__description'>
              Preview ALL theme cards in this realm.
            </p>
          </div>

          {{#if this.canShowGeneratedCards}}
            <PaginatedCards
              @query={{this.generatedCardsQuery}}
              @realms={{this.generatedCardsRealms}}
              @context={{@context}}
              as |card|
            >
              <div class='theme-creator__card-wrapper'>
                <card.component />
                <div class='theme-creator__card-actions'>
                  <label class='theme-creator__checkbox'>
                    <input type='checkbox' />
                  </label>
                  <Button @kind='secondary-light' @size='small'>
                    <Wand width='14' height='14' />
                  </Button>
                  <Button @kind='destructive' @size='small'>
                    <IconTrash width='14' height='14' />
                  </Button>
                </div>
              </div>
            </PaginatedCards>
          {{else}}
            <p class='theme-creator__hint'>{{this.generatedCardsHint}}</p>
          {{/if}}
        </section>
      </section>

      <style scoped>
        .theme-creator {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
          background: var(--boxel-0);
        }

        .theme-creator__header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .theme-creator__layout {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: var(--boxel-sp-xl);
        }

        .theme-creator__prompt-pane {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
        }

        .theme-creator__meta-pane {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-md);
        }

        .theme-creator__meta-field {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
        }

        .theme-creator__label {
          font-size: var(--boxel-font-size);
          font-weight: 600;
        }

        .theme-creator__description {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-500);
        }

        .theme-creator__actions {
          display: flex;
          gap: var(--boxel-sp-sm);
        }

        .theme-creator__generated {
          margin-top: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-md);
        }

        .theme-creator__section-header {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
          margin-bottom: var(--boxel-sp-lg);
        }

        .theme-creator__section-header h2 {
          margin: 0;
        }

        .theme-creator__section-header p,
        .theme-creator__hint {
          margin: 0;
          color: var(--boxel-600);
          font-size: var(--boxel-font-size-sm);
        }

        .theme-creator__card-wrapper {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          height: 100%;
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
        }

        .theme-creator__card-actions {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-top: auto;
        }

        .theme-creator__checkbox {
          display: flex;
          align-items: center;
          cursor: pointer;
        }

        .theme-creator__checkbox input[type='checkbox'] {
          cursor: pointer;
          width: 1.125rem;
          height: 1.125rem;
          margin: 0;
        }
      </style>
    </template>
  };
}
