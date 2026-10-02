// Pretui — DiffBlock usage page.
import Component from '@glimmer/component';
import { FreestyleUsage } from './freestyle-usage';
import { DiffBlock } from './diff-block';

const DIFF_LINES = [
  { text: 'lot: B-103' },
  { op: 'del' as const, text: 'status: draft' },
  { op: 'add' as const, text: 'status: approved' },
  { op: 'add' as const, text: 'approvedBy: Mei-Lin Chua' },
  { op: 'add' as const, text: 'approvedAt: 2026-08-13' },
  { text: 'origin: Shizuoka' },
];

class DiffBlockUsage extends Component {
  lines = DIFF_LINES;
  <template>
    <FreestyleUsage @name='DiffBlock' @description='A compact staged diff with textual prefixes, controlled expansion and an immutable receipt line.' @source='<DiffBlock @lines={{this.lines}} @receipt="3 fields changed" />' @viewportMode='wide'>
      <:example><DiffBlock @lines={{this.lines}} @receipt='3 fields changed · run_8F3C' @maxLines={{3}} /></:example>
      <:api as |Args|><Args.Object @name='lines' @value={{this.lines}} /><Args.String @name='receipt' @value='3 fields changed · run_8F3C' /><Args.Number @name='maxLines' @value={{3}} /></:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DIFF_BLOCK: Record<string, unknown> = {
  DiffBlock: DiffBlockUsage,
};
