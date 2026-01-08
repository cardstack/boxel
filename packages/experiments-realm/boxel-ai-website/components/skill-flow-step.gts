import GlimmerComponent from '@glimmer/component';
import { DiagramBox } from './diagram-box';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    step?: string;
    title?: string;
    description?: string;
    icon?: string;
    accentColor?: string;
  };
}

export class SkillFlowStep extends GlimmerComponent<Signature> {
  <template>
    <DiagramBox
      class='skill-flow-step'
      @accentColor={{@accentColor}}
      @highlightOnHover={{true}}
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
