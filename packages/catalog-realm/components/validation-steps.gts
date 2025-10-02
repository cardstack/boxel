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
    editModeNote?: string;
  };
  Element: HTMLElement;
}

export default class ValidationSteps extends Component<ValidationStepsSignature> {
  <template>
    <section class='validation-content' ...attributes>
      <h2>{{@title}}</h2>
      {{#if @description}}
        <p class='validation-description'>{{@description}}</p>
      {{/if}}
      <div class='validation-steps'>
        {{#each @steps as |step|}}
          <div class='validation-step {{step.status}}' data-step-id={{step.id}}>
            <strong>{{step.title}}</strong>
            {{step.message}}
          </div>
        {{/each}}
      </div>
      {{#if @editModeNote}}
        <p class='edit-mode-note'>{{@editModeNote}}</p>
      {{/if}}
    </section>

    <style scoped>
      .validation-content {
        background: var(--validation-content-background, var(--background));
        color: var(--validation-content-foreground, var(--foreground));
        border-radius: var(
          --boxel-border-radius,
          var(--validation-content-border-radius)
        );
        padding: var(--boxel-sp-xl, var(--validation-content-padding));
        max-width: var(--validation-content-max-width, 500px);
        width: 100%;
        box-shadow: var(--boxel-box-shadow-lg);
        border: 3px solid var(--border, var(--boxel-border-color));
        position: relative;
        backdrop-filter: blur(15px);
      }

      .validation-content > * {
        position: relative;
        z-index: 1;
      }

      .validation-content h2 {
        margin: 0 0 var(--boxel-sp) 0;
        text-align: center;
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        letter-spacing: -0.025em;
      }

      .validation-description {
        text-align: center;
        margin: 0 0 var(--boxel-sp-lg) 0;
        font-size: var(--boxel-font-size);
        line-height: 1.5;
      }

      .validation-steps {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .validation-step {
        background: var(--card);
        color: var(--card-foreground);
        font-size: var(--boxel-font-size);
        line-height: 1.5;
        padding: var(--boxel-sp);
        border: 2px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        border-left: 4px solid var(--muted);
        box-shadow: var(--boxel-box-shadow-sm);
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }

      .validation-step:last-child {
        margin-bottom: 0;
      }

      .validation-step:hover {
        transform: translateY(-1px);
        box-shadow: var(--boxel-box-shadow);
      }

      .validation-step.incomplete {
        background: rgba(220, 2, 2, 0.6); /* 50% transparent red */
        color: #ffffff;
        backdrop-filter: blur(4px);
      }

      .validation-step.complete {
        background: rgba(55, 235, 119, 0.6); /* 50% transparent green */
        color: #ffffff;
        backdrop-filter: blur(4px);
      }

      .validation-step strong {
        display: block;
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-weight: 600;
        font-size: var(--boxel-font-size);
      }

      .edit-mode-note {
        font-style: italic;
        margin: var(--boxel-sp-lg) 0 0 0;
        font-size: var(--boxel-font-size-sm);
        text-align: center;
        background: var(--muted);
        color: var(--card-foreground);
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--border, var(--boxel-border-color));
      }
    </style>
  </template>
}
