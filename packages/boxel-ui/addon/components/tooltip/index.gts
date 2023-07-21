import Component from '@glimmer/component';
import { MiddlewareState } from '@floating-ui/dom';
import { Velcro } from 'ember-velcro';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

interface Signature {
  Element: HTMLElement;
  Args: {
    placement?: MiddlewareState['placement'];
    offset?: number;
  };
  Blocks: {
    trigger: [];
    content: [];
  };
}
export default class Tooltip extends Component<Signature> {
  @tracked isHoverOnTrigger = false;

  @action
  onMouseEnter() {
    this.isHoverOnTrigger = true;
  }

  @action
  onMouseLeave() {
    this.isHoverOnTrigger = false;
  }

  <template>
    <Velcro @placement={{if @placement @placement 'top'}} @offsetOptions={{if @offset @offset 6}} as |velcro|>
      <div class='trigger' {{velcro.hook}} {{on 'mouseenter' this.onMouseEnter}} {{on 'mouseleave' this.onMouseLeave}}>
        {{yield to='trigger'}}
      </div>
      {{#if this.isHoverOnTrigger}}
        <div class='tooltip' {{velcro.loop}}>
          {{yield to='content'}}
        </div>
      {{/if}}
    </Velcro>
    
    <style>
      .trigger {
        width: max-content;
      }

      .tooltip {
        background-color: rgb(0 0 0 / 80%);
        box-shadow: 0 0 0 1px var(--boxel-light-500);
        color: var(--boxel-light);
        text-align: center;
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-sm);
        width: max-content;
        position: absolute;
        font: var(--boxel-tooltip-font, var(--boxel-font-xs));
        z-index: 5;
      }
    </style>
  </template>
}
