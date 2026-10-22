// Pretui — Fold usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { Fold } from './fold';
import { ResultCard } from './result-card';

class FoldUsage extends Component {
  <template>
    <FreestyleUsage @name='Fold' @description='Agent work that collapses to a receipt while preserving containment through one hairline indentation step.' @source='<Fold @receipt="Inspected 4 linked cards">…</Fold>'>
      <:example><Fold @receipt='Inspected 4 linked cards' @defaultOpen={{true}}><ResultCard @eyebrow='Inspection' @title='No broken links' @lines={{this.lines}} /></Fold></:example>
      <:api as |Args|><Args.String @name='receipt' @value='Inspected 4 linked cards' /><Args.Bool @name='defaultOpen' @value={{true}} /><Args.Bool @name='open' /><Args.Action @name='onOpenChange' /><Args.Yield @name='default' /></:api>
    </FreestyleUsage>
  </template>
  lines = ['4 references resolved', '0 missing cards'];
}

export const DEMOS_FOLD: Record<string, unknown> = {
  Fold: FoldUsage,
};
