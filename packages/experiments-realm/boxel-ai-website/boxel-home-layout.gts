import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import { cn } from '@cardstack/boxel-ui/helpers';
import { Site } from './site-config';
import { PageSectionField } from './fields/page-section-field';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

class Isolated extends Component<typeof HomeLayoutCard> {
  @tracked isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  <template>
    <div class={{cn 'home-layout' dark-mode=this.isDarkMode}}>
      {{! Main sections container }}
      <main class='sections-container'>
        {{#if @model.sections.length}}
          {{#each @fields.sections as |Section|}}
            <Section @format='embedded' />
          {{/each}}
        {{else}}
          <div class='empty-state'>No sections configured</div>
        {{/if}}
      </main>

      {{#if @model.showDarkModeToggle}}
        <button class='dark-mode-toggle' {{on 'click' this.toggleDarkMode}}>
          {{if this.isDarkMode '☀️' '🌙'}}
        </button>
      {{/if}}
    </div>

    <style scoped>
      /* Layout styles */
      .home-layout {
        min-height: 100vh;
        background: var(--background, #ffffff);
        color: var(--foreground, #000000);
      }

      .home-layout.dark-mode {
        background: var(--background, #1a1a1a);
        color: var(--foreground, #ffffff);
      }

      /* CSS API for sections */
      .sections-container {
        --section-padding-block: clamp(3rem, 8vw, 6rem);
        --section-padding-inline: clamp(1.5rem, 5vw, 3rem);
        --section-max-width: 1400px;
        --section-gap: clamp(2rem, 6vw, 4rem);
        --hero-padding-block: clamp(5rem, 12vw, 10rem);
        --footer-padding-block: clamp(2rem, 5vw, 3rem);

        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .empty-state {
        padding: 4rem 2rem;
        text-align: center;
        color: var(--muted-foreground, #666);
        font-size: 1.125rem;
      }

      .dark-mode-toggle {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 1px solid var(--border, #e5e5e5);
        background: var(--card, #ffffff);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.1));
        transition: transform 0.2s;
        z-index: 100;
      }

      .dark-mode-toggle:hover {
        transform: scale(1.1);
      }
    </style>
  </template>
}

// Home page layout orchestrator
export class HomeLayoutCard extends CardDef {
  static displayName = 'Home Layout';
  static prefersWideFormat = true;

  @field site = linksTo(() => Site);
  @field currentPageId = contains(StringField);
  @field showDarkModeToggle = contains(BooleanField);
  @field sections = containsMany(PageSectionField);

  // Isolated template - main layout orchestrator
  static isolated = Isolated;
}
