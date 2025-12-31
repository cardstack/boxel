import Component from '@glimmer/component';
import { cn, cssVar } from '@cardstack/boxel-ui/helpers';

interface SkillFlowStepSignature {
  Element: HTMLDivElement;
  Args: {
    step?: string;
    title?: string;
    description?: string;
    icon?: string;
    accentColor?: string;
  };
}

export interface DiagramBoxSignature {
  Args: {
    accentColor?: string;
  };
  Element: HTMLDivElement;
  Blocks: { default: [] };
}

export class DiagramBox extends Component<DiagramBoxSignature> {
  <template>
    <div
      class={{cn 'diagram-box' diagram-box--accent=@accentColor}}
      style={{cssVar accent-color=@accentColor}}
      ...attributes
    >
      {{yield}}
    </div>

    <style scoped>
      .diagram-box {
        --diagram-accent: var(--primary, var(--boxel-highlight));
        --diagram-accent-fg: var(--primary-foreground, var(--boxel-dark));

        background: var(--diagram-background, var(--muted, var(--boxel-100)));
        color: var(--diagram-foreground, var(--foreground, var(--boxel-dark)));
        padding: 1.25rem;
        border: 1px dashed var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-border-radius-sm);
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.85rem;
        text-align: center;
        margin-bottom: 0.75rem;
        transition: var(--boxel-transition-properties);
      }
      .diagram-box--accent {
        border-color: var(--accent-color, var(--diagram-accent));
      }
      .diagram-box:hover {
        border-color: var(--diagram-accent);
        background: color-mix(in oklab, var(--diagram-accent) 5%, transparent);
        color: var(--diagram-accent-fg);
      }
    </style>
  </template>
}

export class SkillFlowStep extends Component<SkillFlowStepSignature> {
  <template>
    <DiagramBox
      class='skill-flow-step'
      @accentColor={{@accentColor}}
      ...attributes
    >
      {{#if @step}}
        <div class='skill-flow-step__label'>Step {{@step}}</div>
      {{/if}}
      <div class='skill-flow-step__title'>{{@title}}</div>
      <div class='skill-flow-step__desc'>
        {{#if @icon}}
          <span>{{@icon}}</span>
        {{/if}}
        {{@description}}
      </div>
    </DiagramBox>

    <style scoped>
      .skill-flow-step {
        margin: 0;
      }
      .skill-flow-step__label {
        font-size: 0.65rem;
        color: var(--muted-foreground);
      }
      .skill-flow-step__title {
        font-weight: 600;
        font-size: 0.8rem;
      }
      .skill-flow-step__desc {
        font-size: 0.7rem;
        margin-top: 0.5rem;
      }
    </style>
  </template>
}
