import Component from '@glimmer/component';

export interface ValidationStep {
  id: string;
  title: string;
  message: string;
  status: 'complete' | 'incomplete';
}

interface ValidationStepsSignature {
  Args: {
    steps: ValidationStep[];
    title?: string;
    description?: string;
  };
  Element: HTMLElement;
  Blocks: {
    default: [ValidationStep];
  };
}

export default class ValidationSteps extends Component<ValidationStepsSignature> {
  <template>
    <section class='validation-content' ...attributes>
      <div class='validation-chip' aria-hidden='true'>
        <svg
          class='validation-chip__svg'
          viewBox='0 0 48 48'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          {{! Outer ring }}
          <circle cx='24' cy='24' r='22' stroke='#c9a84c' stroke-width='1.5' />
          {{! Inner circle fill }}
          <circle cx='24' cy='24' r='17' fill='#0d0f12' stroke='#c9a84c' stroke-width='1' />
          {{! Chip segments — 8 notches around the rim }}
          <rect x='22.5' y='1' width='3' height='6' rx='1' fill='#c9a84c' />
          <rect
            x='22.5'
            y='41'
            width='3'
            height='6'
            rx='1'
            fill='#c9a84c'
          />
          <rect
            x='1'
            y='22.5'
            width='6'
            height='3'
            rx='1'
            fill='#c9a84c'
          />
          <rect
            x='41'
            y='22.5'
            width='6'
            height='3'
            rx='1'
            fill='#c9a84c'
          />
          <rect
            x='35.2'
            y='6.1'
            width='3'
            height='6'
            rx='1'
            fill='#c9a84c'
            transform='rotate(45 35.2 6.1)'
          />
          <rect
            x='6.1'
            y='35.2'
            width='3'
            height='6'
            rx='1'
            fill='#c9a84c'
            transform='rotate(45 6.1 35.2)'
          />
          <rect
            x='6.1'
            y='6.1'
            width='6'
            height='3'
            rx='1'
            fill='#c9a84c'
            transform='rotate(45 6.1 6.1)'
          />
          <rect
            x='35.2'
            y='35.2'
            width='6'
            height='3'
            rx='1'
            fill='#c9a84c'
            transform='rotate(45 35.2 35.2)'
          />
          {{! Card suit in centre }}
          <text
            x='24'
            y='29'
            text-anchor='middle'
            font-size='16'
            fill='#c9a84c'
            font-family='Georgia, serif'
          >♠</text>
        </svg>
      </div>
      <h2>{{@title}}</h2>
      {{#if @description}}
        <p class='validation-description'>{{@description}}</p>
      {{/if}}
      <div class='validation-steps'>
        {{#each @steps as |step|}}
          <div class='validation-step {{step.status}}' data-step-id={{step.id}}>
            <strong>{{step.title}}</strong>
            {{#if (has-block)}}
              {{yield step}}
            {{else}}
              <span class='validation-step__message'>{{step.message}}</span>
            {{/if}}
          </div>
        {{/each}}
      </div>
    </section>

    {{! template-lint-disable no-whitespace-for-layout }}
    <style scoped>
      /* Classic casino validation panel
         Parent can override three surface tokens:
           --validation-content-background  (default: near-black)
           --validation-content-foreground  (default: gold)
           --validation-content-max-width   (default: 520px)
      */
      .validation-content {
        --casino-gold: #c9a84c;
        --casino-gold-bright: #e8c96a;
        --casino-gold-border: rgba(201, 168, 76, 0.6);
        --casino-gold-border-dim: rgba(201, 168, 76, 0.2);
        --casino-gold-dim: rgba(201, 168, 76, 0.55);
        --casino-crimson: #8b1a1a;
        --casino-crimson-border: rgba(139, 26, 26, 0.55);
        --casino-crimson-text: #f0b8b8;
        --casino-crimson-strong: #e87070;
        --casino-emerald: #0e7a50;
        --casino-emerald-border: rgba(14, 122, 80, 0.45);
        --casino-emerald-strong: #52c89a;
        --casino-text: #f0e6c8;
        --casino-text-muted: rgba(240, 230, 200, 0.55);
        --casino-font: 'Georgia', 'Times New Roman', serif;

        background: var(--validation-content-background, #08090b);
        color: var(--validation-content-foreground, var(--casino-gold));
        max-width: var(--validation-content-max-width, 520px);

        border-radius: 4px;
        padding: 2rem 2rem 1.75rem;
        width: 100%;
        position: relative;
        overflow: hidden;
        font-family: var(--casino-font);

        /* Outer gold frame — two stacked borders */
        box-shadow:
          0 0 0 1px #08090b,
          0 0 0 2px var(--casino-gold-border),
          0 0 0 3px #08090b,
          0 0 0 4px rgba(201, 168, 76, 0.25),
          0 1rem 3rem rgba(0, 0, 0, 0.8);
        border: 1px solid var(--casino-gold-border);
      }

      /* Tight diamond crosshatch */
      .validation-content::before {
        content: '';
        position: absolute;
        inset: 0;
        opacity: 0.04;
        background-image:
          repeating-linear-gradient(
            45deg,
            var(--casino-gold) 0px,
            var(--casino-gold) 1px,
            transparent 1px,
            transparent 14px
          ),
          repeating-linear-gradient(
            -45deg,
            var(--casino-gold) 0px,
            var(--casino-gold) 1px,
            transparent 1px,
            transparent 14px
          );
        pointer-events: none;
        z-index: 0;
      }

      .validation-content > * {
        position: relative;
        z-index: 1;
      }

      .validation-chip {
        display: flex;
        justify-content: center;
        margin-bottom: 0.75rem;
      }

      .validation-chip__svg {
        width: 3rem;
        height: 3rem;
        filter: drop-shadow(0 0 6px rgba(201, 168, 76, 0.35));
      }

      /* Title with flanking suit ornaments */
      .validation-content h2 {
        margin: 0 0 0.25rem;
        text-align: center;
        font-size: 1.375rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--casino-gold-bright);
      }

      .validation-content h2::before {
        content: '♠  ';
        font-size: 0.9em;
        opacity: 0.75;
      }

      .validation-content h2::after {
        content: '  ♠';
        font-size: 0.9em;
        opacity: 0.75;
      }

      /* Thin gold rule below title */
      .validation-content .validation-rule {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.5rem 0 1rem;
      }

      .validation-description {
        text-align: center;
        margin: 0 0 1.25rem;
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--casino-text-muted);
        letter-spacing: 0.01em;
      }

      .validation-steps {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }

      .validation-step {
        font-size: 0.9rem;
        line-height: 1.5;
        padding: 0.875rem 1rem;
        border-radius: 3px;
        background: #0d0f12;
        color: var(--casino-text);
        border: 1px solid var(--casino-gold-border-dim);
        border-top: 2px solid var(--casino-gold-dim);
        position: relative;
        overflow: hidden;
        transition: border-top-color 0.15s ease;
      }

      .validation-step:hover {
        border-top-color: var(--casino-gold-border);
      }

      .validation-step.incomplete {
        background: #110808;
        border-color: var(--casino-crimson-border);
        border-top-color: var(--casino-crimson);
        color: var(--casino-crimson-text);
      }

      .validation-step.complete {
        background: #080f0c;
        border-color: var(--casino-emerald-border);
        border-top-color: var(--casino-emerald);
        color: var(--casino-text);
      }

      .validation-step strong {
        display: block;
        margin: 0 0 0.3rem;
        font-weight: 700;
        font-size: 0.875rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--casino-gold);
      }

      .validation-step__message {
        display: block;
        font-size: 0.875rem;
      }

      .validation-step.incomplete strong {
        color: var(--casino-crimson-strong);
      }

      .validation-step.complete strong {
        color: var(--casino-emerald-strong);
      }
    </style>
    {{! template-lint-enable no-whitespace-for-layout }}
  </template>
}
