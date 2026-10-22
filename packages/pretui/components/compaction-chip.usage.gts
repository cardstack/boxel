// Pretui — CompactionChip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { CompactionChip } from './compaction-chip';

// ── CompactionChip ───────────────────────────────────────────────────────
const COMPACTION_SUMMARY =
  'The session opened on the Kandy auction catalogue, settled on lot 118 as the ' +
  'lead candidate, and rewrote the pricing rule twice — once to add the ' +
  'unsold filter and once to correct the 2025 mean. Everything before the ' +
  'pricing rewrite is condensed to this paragraph; the rewrite itself and ' +
  'both receipts are still in the transcript.';

const COMPACTION_STATES = ['running', 'done'];

class CompactionUsage extends GlimmerComponent {
  @tracked state = 'done';
  @tracked expanded = false;

  setState = (state: string) => (this.state = state);
  setExpanded = (expanded: boolean) => (this.expanded = expanded);
  flip = () => (this.state = this.state === 'done' ? 'running' : 'done');

  get stateValue(): 'running' | 'done' {
    return this.state === 'running' ? 'running' : 'done';
  }

  <template>
    <FreestyleUsage
      @name='CompactionChip'
      @description='Compaction is the moment a session quietly loses its history, and the law the spec states is that it must be RENDERED — a transcript that silently forgets is a transcript the reader cannot reason about. So: a marker in the stream while it runs, and a receipt afterwards that expands to the written summary of what was condensed. The counts are text beside the label, not a tooltip, so the receipt survives the screenshot test and greyscale. Without a summary the chip does not pretend to have one; it says so.'
    >
      <:example>
        <div class='demo-stream'>
          <p class='demo-msg'>…and that is why lot 104 was dropped.</p>
          <CompactionChip
            @state={{this.stateValue}}
            @messageCount={{14}}
            @toolCallCount={{9}}
            @summary={{COMPACTION_SUMMARY}}
            @expanded={{this.expanded}}
            @onExpandedChange={{this.setExpanded}}
          />
          <p class='demo-msg'>Re-running the valuation with the corrected mean.</p>
        </div>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          {{on 'click' this.flip}}
        >Toggle running</Button>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @description='"running" shows the spinner marker and no disclosure; "done" (default) shows the receipt chip with its counts and, when there is a summary, the expander.'
          @value={{this.state}}
          @options={{COMPACTION_STATES}}
          @onInput={{this.setState}}
          @defaultValue='done'
        />
        <Args.Number
          @name='messageCount'
          @description='Messages condensed; joined with toolCallCount into the "14 messages · 9 tool calls condensed" line. Omit both and the line does not appear.'
          @value={{14}}
          @hideControls={{true}}
        />
        <Args.Bool
          @name='expanded'
          @description='Controlled disclosure of the written summary.'
          @value={{this.expanded}}
          @onInput={{this.setExpanded}}
          @defaultValue={{false}}
        />
        <Args.Base
          @name='summary / runningLabel / doneLabel / toolCallCount / onExpandedChange'
          @description='The written summary and the two labels. A summary is a plain string here; for a rich one, use the <:summary> block instead.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='summary'
          @description='Rich summary content, replacing the @summary string — a Prose block, a list of dropped receipts, an embedded report.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-stream {
        display: flex;
        flex-direction: column;
        gap: var(--space-4, 11px);
        margin-bottom: var(--space-4, 11px);
      }
      .demo-msg {
        margin: 0;
        max-width: 62ch;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_COMPACTION_CHIP: Record<string, unknown> = {
  CompactionChip: CompactionUsage,
};
