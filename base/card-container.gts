import type { TemplateOnlyComponent } from "@ember/component/template-only";
import ShadowDOM from 'https://cardstack.com/base/shadow-dom';

interface Signature {
  Element: HTMLElement;
  Args: {
    name?: string;
  }
  Blocks: {
    default: [];
  };
}

export const CardContainer: TemplateOnlyComponent<Signature> = (
  <template>
    <div class="card-container" ...attributes>
      {{#if @name}}<span class="card-container__label">{{@name}}</span>{{/if}}
      <ShadowDOM class="card-container__contents">
        {{yield}}
      </ShadowDOM>
    </div>
  </template>
);