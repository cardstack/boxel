// Pretui — Affix usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Affix } from './affix';
import { Toolbar } from './toolbar';
import { Button } from './button';

const PARAS = Array.from({ length: 12 }, (_, i) => `Roast note ${i + 1}: first crack at 9:40, dropped at 11:05, development 17%.`);

export class AffixUsage extends Component {
  paras = PARAS;
  @tracked pinned = false;
  setPinned = (v: boolean) => (this.pinned = v);
  get usage() {
    return "<Affix @onChange={{this.setPinned}} as |pinned|>\n  <Toolbar>…</Toolbar>\n</Affix>";
  }
  <template>
    <FreestyleUsage
      @name='Affix'
      @description='Pins a child, usually a Toolbar, to the top or bottom of its scroll container once it scrolls past. It is CSS sticky against the pane, not the window, with an IntersectionObserver that reports whether it is pinned. Scroll the demo pane.'
      @source={{this.usage}}
    >
      <:example>
        <div class='af-demo'>
          <p class='af-demo-p'>Lot 7 · Huila, washed</p>
          <Affix @onChange={{this.setPinned}} as |pinned|>
            <div class='af-demo-bar' data-pinned={{if pinned 'true' 'false'}}>
              <Toolbar><Button @size='s'>Save</Button><Button @size='s' @appearance='outlined'>Share</Button></Toolbar>
            </div>
          </Affix>
          {{#each this.paras as |note|}}<p class='af-demo-p'>{{note}}</p>{{/each}}
        </div>
        <p class='af-demo-state'>Pinned: {{if this.pinned 'yes' 'no'}}</p>
      </:example>
      <:api as |Args|>
        <Args.String @name='position' @defaultValue='top' @description='top or bottom.' />
        <Args.String @name='offset' @defaultValue='0' @description='Distance from that edge while pinned.' />
        <Args.Action @name='onChange' @description='true when pinned, false when released.' />
        <Args.Yield @name='default' @description='The child, yielded whether it is pinned.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .af-demo {
        block-size: 14rem;
        overflow-y: auto;
        padding-inline: var(--space-4, 0.6875rem);
        border-radius: var(--radius-surface, 10px);
        box-shadow: 0 0 0 1px var(--border);
        background: var(--card);
      }
      .af-demo-p {
        font-size: var(--text-ui-md, 0.78rem);
      }
      .af-demo-bar {
        padding-block: var(--space-2, 0.375rem);
        background: var(--card);
      }
      .af-demo-bar[data-pinned='true'] {
        box-shadow: 0 1px 0 var(--border);
      }
      .af-demo-state {
        margin: var(--space-2, 0.375rem) 0 0;
        font-size: var(--text-ui-sm, 0.72rem);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_AFFIX: Record<string, unknown> = {
  Affix: AffixUsage,
};
