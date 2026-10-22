// Pretui — PromptLibrary usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PromptLibrary } from './prompt-library';
import type { PromptTemplate } from './prompt-library';

// ── PromptLibrary ────────────────────────────────────────────────────────
const PROMPTS: PromptTemplate[] = [
  {
    id: 'p1',
    title: 'Price a lot',
    body: 'Price {lot} against the {year} seasonal mean, netting Colombo freight, and name the comparable you used.',
    category: 'Sourcing',
    tags: ['pricing', 'auction'],
    icon: 'rectangle-horizontal',
  },
  {
    id: 'p2',
    title: 'Draft a buying note',
    body: 'Write a buying note for {lot}: the case in three sentences, the risk in one, and the number.',
    category: 'Sourcing',
    tags: ['writing'],
    icon: 'rectangle-horizontal',
  },
  {
    id: 'p3',
    title: 'Explain a rule change',
    body: 'Explain what changed in {file} and why, for someone who has not read the diff.',
    category: 'Code',
    tags: ['diff', 'review'],
    icon: 'layout-grid',
  },
  {
    id: 'p4',
    title: 'Audit a pricing rule',
    body: 'Read {file} and list every assumption it makes about freight, currency and grading.',
    category: 'Code',
    tags: ['review'],
    icon: 'layout-grid',
  },
  {
    id: 'p5',
    title: 'Summarise a catalogue',
    body: 'Summarise the {auction} catalogue: how many lots, how many unsold, the score distribution.',
    category: 'Research',
    tags: ['summary'],
  },
  {
    id: 'p6',
    title: 'Find the comparable',
    body: 'Find the closest prior sale to {lot} by estate, grade and season, and say how close it is.',
    category: 'Research',
    tags: ['search', 'pricing'],
  },
];

class PromptLibraryUsage extends GlimmerComponent {
  @tracked used = '—';

  use = (prompt: PromptTemplate) => (this.used = 'used: ' + prompt.title);
  copy = (prompt: PromptTemplate) => (this.used = 'copied: ' + prompt.title);

  <template>
    <FreestyleUsage
      @name='PromptLibrary'
      @description='A shelf of prompts worth keeping. The search is instant and unthrottled, deliberately: a debounce here would be a re-arming timer, which a realm forbids and which this component does not need — filtering N strings on keystroke is cheaper than the render it triggers. Filtering is overridable in both directions, so the same component serves a self-contained shelf and one driven from a card’s own query. The category segments are DERIVED from the prompts in first-seen order, so a caller never keeps a second list in sync, and the result count is announced politely once per change rather than per keystroke. The grid reflows through unnamed container queries — three columns, two, then one — because a card knows its pane, not the viewport.'
    >
      <:example>
        <PromptLibrary
          @prompts={{PROMPTS}}
          @onUse={{this.use}}
          @onCopy={{this.copy}}
        />
        <p class='demo-log'>last:
          <strong>{{this.used}}</strong></p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='prompts'
          @description='{ id, title, body, category?, tags?, icon? }. Title, body and tags are all searched. The icon is a boxel-ui export name resolved through icon-registry.'
          @value={{PROMPTS}}
        />
        <Args.Base
          @name='query / onQueryChange / category / defaultCategory / onCategoryChange'
          @description='Both filters are uncontrolled by default and become controlled the moment you pass them — the same two-way contract the rest of the kit uses. "all" is the category value that shows everything.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='onUse / useLabel / onCopy'
          @description='The @onUse arg is the primary action and always renders; @onCopy is optional and its button only appears when it is supplied. Neither touches the clipboard — copying is the caller’s call, because a kit component should not decide that a click may write to the system clipboard.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='title / emptyMessage'
          @description='The heading and what an empty result says. Empty is EmptyState, so a search with no hits is still a designed frame.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-log {
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .demo-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

export const DEMOS_PROMPT_LIBRARY: Record<string, unknown> = {
  PromptLibrary: PromptLibraryUsage,
};
