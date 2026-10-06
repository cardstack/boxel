// Pretui — DocReport usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { DocReport } from './doc-report';
import type { DocCard } from './doc-report';

// ── DocReport ────────────────────────────────────────────────────────────
const REPORT_CARDS: DocCard[] = [
  {
    id: 'c1',
    label: 'Kandy lot 118',
    icon: 'rectangle-horizontal',
    summary: 'Cupping 88.6 · unsold · 1,240 kg · Nuwara Eliya estate',
  },
  {
    id: 'c2',
    label: 'Kandy lot 104',
    icon: 'rectangle-horizontal',
    summary: 'Cupping 84.1 · unsold · 980 kg · below the 2025 mean once netted',
  },
  {
    id: 'c3',
    label: '2025 pricing rule',
    icon: 'layout-grid',
    summary: 'Rewritten twice this session; current receipt changeset-m3k1',
  },
];

const REPORT_META = ['12 sources', '6 min read', 'changeset-m3k1'];

class DocReportUsage extends GlimmerComponent {
  @tracked expanded = false;
  @tracked opened = '—';

  setExpanded = (expanded: boolean) => (this.expanded = expanded);
  open = (card: DocCard) => (this.opened = card.label);

  <template>
    <FreestyleUsage
      @name='DocReport'
      @description='The deliverable at the end of a research run: a document, not a chat message. Two things make it a component rather than a div of prose — it is capped, so a 4000-word report cannot swallow the transcript, and the cards it cites are pills you can preview without leaving the report. The cap is a mask gradient rather than a hard edge, so the reader can see that there IS more instead of guessing. The body is a slot, never a string, because a report is markdown, tables and embedded cards, whatever the run produced. Prose supplies the reading measure and the inline-code treatment; Tooltip supplies the pill preview, and being CSS-only on hover AND focus-within it works from the keyboard — which the design mirror’s hover-only fit-preview did not.'
    >
      <:example>
        <DocReport
          @title='Should we bid on the Kandy catalogue?'
          @eyebrow='Research · sourcing desk'
          @meta={{REPORT_META}}
          @cards={{REPORT_CARDS}}
          @onOpenCard={{this.open}}
          @expanded={{this.expanded}}
          @onExpandedChange={{this.setExpanded}}
        >
          <p>The catalogue lists eighteen lots, of which four remain unsold at
            the close of the second session. Only one of those four scores
            above 88 on the cupping sheet.</p>
          <p><strong>Lot 118</strong>
            scores 88.6 and carries 1,240 kg from a Nuwara Eliya estate that
            has appeared in three of the last five catalogues. Its 2024
            comparable cleared at twelve per cent over the seasonal mean.</p>
          <p><strong>Lot 104</strong>
            is the obvious alternative on price alone. It scores 84.1, and
            once Colombo freight is netted out its landed cost exceeds lot
            118 — the saving is nominal rather than real. This is the finding
            that changed the recommendation between the first and second
            drafts.</p>
          <p>Freight is quoted flat this quarter, which is what makes the
            netting stable enough to price against. Were it floating, the
            comparison would collapse to a guess and the recommendation would
            drop to medium confidence.</p>
          <p>The pricing rule was rewritten twice during this run: once to add
            the unsold filter, and once to correct the 2025 mean, which had
            been computed across all lots rather than across cleared lots
            only. Both changes are in
            <code>changeset-m3k1</code>.</p>
        </DocReport>
        <p class='demo-log'>last pill opened:
          <strong>{{this.opened}}</strong></p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='cards'
          @description='The cards this report cites: { id, label, summary?, icon? }. The icon is a boxel-ui export name resolved through icon-registry — data, never a static component. Each pill is a real button, so the preview is reachable by Tab as well as by pointer.'
          @value={{REPORT_CARDS}}
        />
        <Args.Array
          @name='meta'
          @description='Short facts rendered as a machine-value strip under the title: source counts, read time, the receipt id.'
          @value={{REPORT_META}}
        />
        <Args.Bool
          @name='expanded'
          @description='Controlled expansion. Collapsed, the body is capped at --pretui-doc-cap (16rem by default) and faded out at the bottom edge.'
          @value={{this.expanded}}
          @onInput={{this.setExpanded}}
          @defaultValue={{false}}
        />
        <Args.Base
          @name='title / eyebrow / onOpenCard / expandLabel / collapseLabel'
          @description='The heading pair, the pill callback, and the two button faces (default "Full report" / "Collapse").'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default / actions'
          @description='The report body, and actions in the header right of the title. The body is a slot rather than a markdown string so that an embedded card, a table or a chart is a first-class part of a report.'
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

export const DEMOS_DOC_REPORT: Record<string, unknown> = {
  DocReport: DocReportUsage,
};
