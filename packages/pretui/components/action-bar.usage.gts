// Pretui — ActionBar usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { ActionBar } from './action-bar';
import type { ActionBarAction } from './action-bar';
import { TEAS } from '../examples-kit';

// ── ActionBar ───────────────────────────────────────────────────────────
const ROSTER = TEAS.slice(0, 7);

class ActionBarUsage extends Component {
  @tracked picked: string[] = [ROSTER[0] as string, ROSTER[2] as string];
  @tracked maxVisible = 2;
  @tracked noun = 'lot';
  @tracked showTotal = true;
  @tracked lastFired = 'Nothing fired yet.';

  setMaxVisible = (v: number | null) => (this.maxVisible = v ?? 2);
  setNoun = (v: string) => (this.noun = v);
  setShowTotal = (v: boolean) => (this.showTotal = v);

  get total(): number | undefined {
    return this.showTotal ? ROSTER.length : undefined;
  }
  get roster(): { name: string; on: boolean }[] {
    return ROSTER.map((name) => ({
      name,
      on: this.picked.indexOf(name) !== -1,
    }));
  }

  toggle = (event: Event) => {
    let name = (event.currentTarget as HTMLElement).getAttribute('data-name');
    if (!name) {
      return;
    }
    this.picked =
      this.picked.indexOf(name) === -1
        ? [...this.picked, name]
        : this.picked.filter((n) => n !== name);
  };
  clear = () => (this.picked = []);
  fire = (id: string) => {
    this.lastFired =
      id + ' fired on ' + this.picked.length + ' selected lots.';
  };

  get actions(): ActionBarAction[] {
    return [
      { id: 'cup', label: 'Schedule cupping', onAction: this.fire },
      { id: 'price', label: 'Re-price', onAction: this.fire },
      { id: 'export', label: 'Export', icon: 'file', onAction: this.fire },
      { id: 'archive', label: 'Archive', icon: 'folder', onAction: this.fire },
      {
        id: 'withdraw',
        label: 'Withdraw from sale',
        icon: 'circle-minus',
        destructive: true,
        onAction: this.fire,
      },
    ];
  }

  get usage(): string {
    return (
      '<ActionBar @count={{this.picked.length}} @total={{this.total}}' +
      " @noun='" + this.noun + "'" +
      ' @actions={{this.actions}} @maxVisible={{' + this.maxVisible + '}}' +
      ' @onClear={{this.clear}} />'
    );
  }

  <template>
    <FreestyleUsage
      @name='ActionBar'
      @description='The bar that appears when a selection exists. Every control in it is an existing kit component — Button, IconButton and Menu for the overflow — so what the bar adds is the count as a sentence, an overflow threshold, and the APG toolbar keyboard contract: one tab stop, arrows within, Home and End to the ends, Escape to clear. Select a row or two below to bring it in.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-ab-demo'>
          <ul class='pretui-ab-demo-list'>
            {{#each this.roster key='name' as |row|}}
              <li>
                <button
                  type='button'
                  class='pretui-ab-demo-row'
                  data-name={{row.name}}
                  data-on={{if row.on 'true'}}
                  aria-pressed={{if row.on 'true' 'false'}}
                  {{on 'click' this.toggle}}
                >{{row.name}}</button>
              </li>
            {{/each}}
          </ul>
          <ActionBar
            @count={{this.picked.length}}
            @total={{this.total}}
            @noun={{this.noun}}
            @actions={{this.actions}}
            @maxVisible={{this.maxVisible}}
            @onClear={{this.clear}}
            @position='inline'
          />
          <p class='pretui-ab-demo-note'>{{this.lastFired}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='count'
          @required={{true}}
          @description='How many things are selected. Zero hides the bar entirely.'
        />
        <Args.Bool
          @name='total'
          @value={{this.showTotal}}
          @description='Demo switch for the total argument: with it set the bar reads 3 lots selected of 7.'
          @onInput={{this.setShowTotal}}
        />
        <Args.String
          @name='noun'
          @value={{this.noun}}
          @defaultValue='item'
          @description='Singular noun, pluralised by adding an s.'
          @onInput={{this.setNoun}}
        />
        <Args.Number
          @name='maxVisible'
          @value={{this.maxVisible}}
          @min={{0}}
          @max={{5}}
          @step={{1}}
          @description='How many actions get their own button before the rest collapse into an overflow Menu. Exactly one action over the limit is promoted instead — a menu holding one item is worse than one more button.'
          @onInput={{this.setMaxVisible}}
        />
        <Args.Array
          @name='actions'
          @description='Each has an id, a label, and optionally an icon, tone, disabled or destructive flag and an onAction callback.'
        />
        <Args.Action
          @name='onClear'
          @description='Called by the clear button and by Escape inside the bar. Omit it and no clear button is drawn.'
        />
        <Args.Yield
          @name='default'
          @description='Extra controls appended after the actions. Give anything focusable a data-actionbar-item attribute so it joins the arrow-key rotation.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-actionbar-enter'
          @type='duration'
          @description='How long the bar takes to arrive. Reduced motion lands on the end state.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-ab-demo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 520px;
      }
      .pretui-ab-demo-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
      }
      .pretui-ab-demo-row {
        padding: 4px 10px;
        border: 0;
        border-radius: var(--radius-control, 8px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font: inherit;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--foreground);
        cursor: pointer;
      }
      .pretui-ab-demo-row[data-on='true'] {
        background: color-mix(
          in oklch,
          var(--primary) 12%,
          var(--card)
        );
        color: color-mix(
          in oklch,
          var(--foreground) 16%,
          var(--primary)
        );
      }
      .pretui-ab-demo-row:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      .pretui-ab-demo-note {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_ACTION_BAR: Record<string, unknown> = {
  ActionBar: ActionBarUsage,
};
