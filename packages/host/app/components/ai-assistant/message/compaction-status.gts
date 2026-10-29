import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CompactionChip } from '@cardstack/pretui/components/compaction-chip';

import type { MessageCompaction } from '@cardstack/host/lib/matrix-classes/message';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    compaction: MessageCompaction;
  };
}

// A compaction as Pret UI's CompactionChip: a live status while ai-bot
// summarizes the earlier conversation, then a marker that opens onto the
// summary it kept, or says it could not make one.
const CompactionStatus: TemplateOnlyComponent<Signature> = <template>
  <CompactionChip
    class='compaction-status'
    @state={{@compaction.status}}
    @runningLabel='Summarizing earlier conversation'
    @doneLabel='Summarized earlier conversation'
    @failedLabel='Could not summarize earlier conversation'
    data-test-compaction-status={{@compaction.status}}
    ...attributes
  >
    <:summary>
      {{#if @compaction.summary}}
        <div class='summary' data-test-compaction-summary>
          {{@compaction.summary}}
        </div>
      {{else}}
        <p class='summary-none'>No written summary was kept for this compaction.</p>
      {{/if}}
    </:summary>
  </CompactionChip>
  <style scoped>
    .compaction-status {
      margin-bottom: var(--boxel-sp-xs);
    }
    .summary {
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
  </style>
</template>;

export default CompactionStatus;
