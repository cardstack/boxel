// Pretui — MorphingDialog usage page.
import Component from '@glimmer/component';
import {
  PLACES,
  TEAS,
  seedFrom,
  take,
} from '../examples';
import { FreestyleUsage } from './freestyle-usage';
import { MorphingDialog } from './morphing-dialog';

// ── MorphingDialog ───────────────────────────────────────────────────────
const MORPH_SEED = seedFrom('pretui-morph-demo');

const DEMO_TEAS = take(MORPH_SEED, 0, 3, TEAS);

interface DemoLot {
  id: string;
  tea: string;
  place: string;
  chests: number;
}

const DIALOG_LOTS: DemoLot[] = DEMO_TEAS.map((tea, i) => ({
  id: 'B-' + (204 + i),
  tea,
  place: PLACES[(seedFrom('morph#' + tea) + i) % PLACES.length] as string,
  chests: 30 + (seedFrom('chests#' + tea) % 210),
}));

export class MorphingDialogUsage extends Component {
  lots = DIALOG_LOTS;

  get usage(): string {
    return [
      "<MorphingDialog @label='Lot B-204'>",
      '  <:trigger><LotCard @lot={{this.lot}} /></:trigger>',
      '  <:default><LotDetail @lot={{this.lot}} /></:default>',
      '  <:actions>…</:actions>',
      '</MorphingDialog>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='MorphingDialog'
      @description='A card that grows into its own modal dialog. Open any of the three cards and watch which one it came from — with six tiles on a page that is information the reader would otherwise have to reconstruct, which is exactly what Law 5 licenses motion for. It WRAPS Dialog, so the focus trap, Escape, the top layer, the backdrop and focus RETURN to the trigger are all the native <dialog> element’s rather than a re-implementation.'
      @source={{this.usage}}
      @viewportMode='wide'
    >
      <:example>
        <div class='md-grid'>
          {{#each this.lots key='id' as |lot|}}
            <MorphingDialog @label={{lot.tea}} @size='m'>
              <:trigger>
                <article class='md-card'>
                  <p class='md-id'>{{lot.id}}</p>
                  <h4 class='md-tea'>{{lot.tea}}</h4>
                  <p class='md-meta'>{{lot.place}}</p>
                </article>
              </:trigger>
              <:title>{{lot.tea}}</:title>
              <:default>
                <p class='md-body'>Lot
                  {{lot.id}}
                  landed at
                  {{lot.place}}:
                  {{lot.chests}}
                  chests, cleared and bonded. The dialog grew out of the card
                  you clicked, so the connection between the two never has to
                  be inferred.</p>
                <p class='md-body'>Escape closes it, the backdrop closes it,
                  and focus goes back to the card either way — all of that is
                  the platform’s, not this component’s.</p>
              </:default>
              <:actions>
                <span class='md-hint'>Press Escape to close</span>
              </:actions>
            </MorphingDialog>
          {{/each}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @description='Accessible name for the dialog, and its visible title when no <:title> block is given.'
        />
        <Args.Bool
          @name='open'
          @description='Controlled open state. Omit for uncontrolled.'
        />
        <Args.Action
          @name='onOpenChange'
          @description='Fires with the next open state on every change, including a platform dismissal (Escape or backdrop).'
        />
        <Args.String
          @name='size'
          @description='Dialog width preset, forwarded to Dialog: s, m (default) or l.'
        />
        <Args.Bool
          @name='dismissible'
          @description='Allow Escape and backdrop dismissal.'
          @defaultValue={{true}}
        />
        <Args.Yield
          @name='trigger'
          @description='The resting card. It becomes a real <button> with aria-haspopup="dialog", and its rectangle is what the dialog grows out of.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='actions'
          @description='Actions row, rendered under a hairline at the foot of the body.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .md-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: var(--space-4, 11px);
      }
      .md-card {
        display: grid;
        gap: 2px;
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(0 0 0 / 0.2)
        );
        text-align: start;
      }
      .md-id {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        color: var(--muted-foreground);
      }
      .md-tea {
        margin: 0;
        font-size: var(--text-ui-lg, 14px);
        font-weight: var(--weight-strong, 600);
      }
      .md-meta {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .md-body {
        margin: 0 0 var(--space-3, 8px);
        max-inline-size: 62ch;
      }
      .md-hint {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_MORPHING_DIALOG: Record<string, unknown> = {
  MorphingDialog: MorphingDialogUsage,
};
