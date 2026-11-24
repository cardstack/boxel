// Pretui — the showcase as one card: the home view and the docs view behind a
// shared top bar. Moving between them, and between components, happens inside
// the card, so nothing piles up on the stack and home is always one click away.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { ShowcaseTopbar, SpecIndex } from './showcase-chrome';
import { SegmentedControl } from './components/segmented-control';
import { specIdFor } from './showcase-data';
import { HomeView } from './showcase-home';
import { DocsView } from './showcase-docs';

export interface ShowcaseAppSignature {
  Args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
    /** where the card opens */
    start: 'home' | 'docs';
    /** for `docs`, the category it opens on */
    category?: string | null;
    tagline?: string | null;
  };
}

const MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export class ShowcaseApp extends Component<ShowcaseAppSignature> {
  modes = MODES;
  @tracked mode = 'auto';
  setMode = (mode: string) => (this.mode = mode);
  // 'auto' stamps nothing, so the page follows the host's own scheme
  get dataTheme(): string | undefined {
    return this.mode === 'auto' ? undefined : this.mode;
  }
  @tracked view: 'home' | 'docs' = this.args.start;
  @tracked category: string | undefined = this.args.category ?? undefined;
  @tracked selectedId: string | undefined;

  goHome = () => {
    this.view = 'home';
  };
  goDocs = () => {
    this.view = 'docs';
    this.category = undefined;
    this.selectedId = undefined;
  };
  browse = (category?: string) => {
    this.view = 'docs';
    this.category = category;
    this.selectedId = undefined;
  };
  select = (id: string | undefined, category?: string) => {
    this.view = 'docs';
    this.selectedId = id;
    if (category) {
      this.category = category;
    }
  };
  openByName = (name: string, category: string) =>
    this.select(specIdFor(name), category);
  setCategory = (category: string | undefined) => {
    this.category = category;
    this.selectedId = undefined;
  };
  get atHome() {
    return this.view === 'home';
  }

  <template>
    <div class='showcase' data-theme={{this.dataTheme}}>
      <ShowcaseTopbar
        @here={{this.view}}
        @onHome={{this.goHome}}
        @onDocs={{this.goDocs}}
      >
        <SegmentedControl
          @label='Color scheme'
          @options={{this.modes}}
          @value={{this.mode}}
          @onValueChange={{this.setMode}}
        />
      </ShowcaseTopbar>
      <SpecIndex @context={{@context}} as |specs|>
        {{#if this.atHome}}
          <HomeView
            @context={{@context}}
            @specs={{specs}}
            @tagline={{@tagline}}
            @onBrowse={{this.browse}}
            @onOpen={{this.openByName}}
          />
        {{else}}
          <DocsView
            @context={{@context}}
            @specs={{specs}}
            @category={{this.category}}
            @selectedId={{this.selectedId}}
            @onSelect={{this.select}}
            @onCategory={{this.setCategory}}
          />
        {{/if}}
      </SpecIndex>
    </div>
    <style scoped>
      .showcase[data-theme='dark'] {
        color-scheme: dark;
      }
      .showcase[data-theme='light'] {
        color-scheme: light;
      }
      .showcase {
        container-type: inline-size;
        min-height: 100%;
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font-sans, inherit);
      }
    </style>
  </template>
}
