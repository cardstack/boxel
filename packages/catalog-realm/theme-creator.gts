import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import MarkdownField from 'https://cardstack.com/base/markdown';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import NumberField from 'https://cardstack.com/base/number';
import { Button } from '@cardstack/boxel-ui/components';

export class ThemeCreator extends CardDef {
  static displayName = 'Theme Creator';

  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(CodeRefField);
  @field numberOfVariants = contains(NumberField);

  static isolated = class Isolated extends Component<typeof ThemeCreator> {
    get canGenerate() {
      return Boolean(this.args.model.realm && this.args.model.codeRef);
    }

    get isGenerateDisabled() {
      return !this.canGenerate;
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
              Instruction to AI describing the type of theme (e.g., “a bold red festival kit”).
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
                Choose the theme type you want to generate (structured-theme, style-reference, or theme).
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
          <Button @kind='primary' disabled={{this.isGenerateDisabled}}>Generate</Button>
        </div>
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
      </style>
    </template>
  };
}
