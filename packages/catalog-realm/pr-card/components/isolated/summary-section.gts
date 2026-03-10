import GlimmerComponent from '@glimmer/component';

interface SummarySectionSignature {
  Args: {
    summary: string;
  };
}

export class SummarySection extends GlimmerComponent<SummarySectionSignature> {
  <template>
    <section class='summary-section'>
      <h2 class='section-heading'>Summary</h2>
      <p class='summary-content'>{{@summary}}</p>
    </section>

    <style scoped>
      .summary-section {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .section-heading {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--foreground, #1f2328);
        margin: 0;
      }

      .summary-content {
        margin: 0;
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--radius, 6px);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--muted, #f6f8fa);
        color: var(--card-foreground, #1f2328);
        line-height: 1.6;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
    </style>
  </template>
}
