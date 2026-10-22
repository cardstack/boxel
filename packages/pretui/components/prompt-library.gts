// Pretui — PromptLibrary: a searchable shelf of reusable prompt templates.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, fn } from '@ember/helper';
import { Button } from './button';
import { Input } from './input';
import { SegmentedControl } from './segmented-control';
import { Chip } from './chip';
import { EmptyState } from './empty-state';
import { iconFor } from '../icon-registry';

// ── PromptLibrary ────────────────────────────────────────────────────────
// A shelf of prompts worth keeping. The search is instant and unthrottled —
// deliberately, because a debounce here would be a re-arming timer, which a
// realm forbids and which this component does not need: filtering N strings
// on keystroke is cheaper than the render it triggers.
//
// Filtering is caller-overridable in both directions: pass `@query` and
// `@category` to drive it from outside, or leave both and the shelf keeps
// its own. Either way the result count is announced politely once per
// change, never per keystroke, because it is derived rather than pushed.

export interface PromptTemplate {
  /** stable id — the {{#each}} key */
  id: string;
  /** what the prompt is for */
  title: string;
  /** the prompt text itself */
  body: string;
  /** grouping; becomes a filter segment */
  category?: string;
  /** free tags, rendered as chips and searched */
  tags?: string[];
  /** boxel-ui icon export name, resolved through icon-registry */
  icon?: string;
}

export interface PromptLibrarySignature {
  Args: {
    /** the shelf */
    prompts: PromptTemplate[];
    /** heading (default 'Prompt library') */
    title?: string;
    /** controlled search text */
    query?: string;
    /** fires with the new search text */
    onQueryChange?: (query: string) => void;
    /** controlled category filter; 'all' shows everything */
    category?: string;
    /** starting category when uncontrolled (default 'all') */
    defaultCategory?: string;
    /** fires with the newly chosen category */
    onCategoryChange?: (category: string) => void;
    /** fires when a prompt is chosen — the primary action */
    onUse?: (prompt: PromptTemplate) => void;
    /** use-button wording (default 'Use') */
    useLabel?: string;
    /** fires when a prompt's text is copied; omit to hide the copy action */
    onCopy?: (prompt: PromptTemplate) => void;
    /** what an empty result says */
    emptyMessage?: string;
  };
  Element: HTMLElement;
}

export class PromptLibrary extends Component<PromptLibrarySignature> {
  @tracked private innerQuery = '';
  @tracked private innerCategory?: string;

  get prompts(): PromptTemplate[] {
    return this.args.prompts ?? [];
  }
  get title(): string {
    return this.args.title ?? 'Prompt library';
  }
  get query(): string {
    return this.args.query ?? this.innerQuery;
  }
  get category(): string {
    return (
      this.args.category ?? this.innerCategory ?? this.args.defaultCategory ?? 'all'
    );
  }
  /** 'All' plus every category present, in first-seen order — derived, so a
   * caller never has to keep a second list in sync */
  get segments(): { value: string; label: string }[] {
    let seen: string[] = [];
    for (let prompt of this.prompts) {
      let category = prompt.category;
      if (category && !seen.includes(category)) {
        seen.push(category);
      }
    }
    return [
      { value: 'all', label: 'All' },
      ...seen.map((category) => ({ value: category, label: category })),
    ];
  }
  get hasCategories(): boolean {
    return this.segments.length > 1;
  }
  get results(): PromptTemplate[] {
    let needle = this.query.trim().toLowerCase();
    let category = this.category;
    return this.prompts.filter((prompt) => {
      if (category !== 'all' && prompt.category !== category) {
        return false;
      }
      if (!needle) {
        return true;
      }
      let haystack = [prompt.title, prompt.body, ...(prompt.tags ?? [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }
  get resultSummary(): string {
    let n = this.results.length;
    return n === 1 ? '1 prompt' : n + ' prompts';
  }
  get useLabel(): string {
    return this.args.useLabel ?? 'Use';
  }

  setQuery = (value: string) => {
    if (this.args.query === undefined) {
      this.innerQuery = value;
    }
    this.args.onQueryChange?.(value);
  };

  setCategory = (value: string) => {
    if (this.args.category === undefined) {
      this.innerCategory = value;
    }
    this.args.onCategoryChange?.(value);
  };

  use = (prompt: PromptTemplate) => this.args.onUse?.(prompt);
  copy = (prompt: PromptTemplate) => this.args.onCopy?.(prompt);

  <template>
    <section
      class='pretui-plib'
      aria-label={{this.title}}
      data-test-pretui-prompt-library
      ...attributes
    >
      <header class='pretui-plib-head'>
        <h3 class='pretui-plib-title'>{{this.title}}</h3>
        <span class='pretui-plib-count' role='status'>{{this.resultSummary}}</span>
      </header>

      <div class='pretui-plib-filters'>
        <Input
          @value={{this.query}}
          @onInput={{this.setQuery}}
          @type='search'
          @placeholder='Search prompts…'
          class='pretui-plib-search'
          aria-label='Search prompts'
          data-test-pretui-prompt-library-search
        />
        {{#if this.hasCategories}}
          <SegmentedControl
            @options={{this.segments}}
            @value={{this.category}}
            @onValueChange={{this.setCategory}}
            data-test-pretui-prompt-library-categories
          />
        {{/if}}
      </div>

      {{#if this.results.length}}
        <ul class='pretui-plib-grid'>
          {{#each this.results key='id' as |prompt|}}
            <li class='pretui-plib-card'>
              <div class='pretui-plib-card-head'>
                {{#let (iconFor prompt.icon) as |PromptIcon|}}
                  {{#if PromptIcon}}
                    <PromptIcon class='pretui-plib-icon' role='presentation' />
                  {{/if}}
                {{/let}}
                <h4 class='pretui-plib-card-title'>{{prompt.title}}</h4>
              </div>
              <p class='pretui-plib-card-body'>{{prompt.body}}</p>
              {{#if prompt.tags}}
                <span class='pretui-plib-tags'>
                  {{#each prompt.tags as |tag|}}
                    <Chip @label={{tag}} @dot={{false}} />
                  {{/each}}
                </span>
              {{/if}}
              <div class='pretui-plib-card-foot'>
                <Button
                  @size='s'
                  data-test-pretui-prompt-library-use
                  {{on 'click' (fn this.use prompt)}}
                >{{this.useLabel}}</Button>
                {{#if @onCopy}}
                  <Button
                    @size='s'
                    @tone='neutral'
                    @appearance='outlined'
                    aria-label={{concat 'Copy prompt: ' prompt.title}}
                    data-test-pretui-prompt-library-copy
                    {{on 'click' (fn this.copy prompt)}}
                  >Copy</Button>
                {{/if}}
              </div>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <EmptyState
          @title='Nothing on this shelf'
          @message={{if
            @emptyMessage
            @emptyMessage
            'No prompt matches that search in this category.'
          }}
        />
      {{/if}}
    </section>

    <style scoped>
      /* above Input's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-plib {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 9px);
          padding: var(--space-4, 13px);
          border-radius: var(--radius-surface, 14px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.08)
          );
          font-size: var(--text-ui-md, 12.5px);
          container-type: inline-size;
        }
        .pretui-plib-head {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .pretui-plib-title {
          margin: 0;
          flex: 1;
          min-width: 0;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .pretui-plib-count {
          flex: none;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--ink-3, var(--boxel-400));
          font-variant-numeric: tabular-nums;
        }
        .pretui-plib-filters {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pretui-plib-search {
          flex: 1;
          min-width: 12rem;
        }
        .pretui-plib-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        /* unnamed container queries — a card knows its pane, not the viewport */
        @container (max-width: 46rem) {
          .pretui-plib-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @container (max-width: 28rem) {
          .pretui-plib-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .pretui-plib-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px 11px;
          border-radius: 10px;
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-plib-card:hover,
        .pretui-plib-card:focus-within {
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border),
            0 2px 10px rgb(0 0 0 / 0.1)
          );
        }
        .pretui-plib-card-head {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .pretui-plib-icon {
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-plib-card-title {
          margin: 0;
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 600;
          min-width: 0;
        }
        .pretui-plib-card-body {
          margin: 0;
          flex: 1;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.55;
          color: var(--muted-foreground);
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          line-clamp: 3;
          overflow: hidden;
        }
        .pretui-plib-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .pretui-plib-card-foot {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }
      }
    </style>
  </template>
}
