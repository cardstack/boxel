import type { TemplateOnlyComponent } from "@ember/component/template-only";
import { ShadowRootModifier } from 'https://cardstack.com/base/shadow-root';

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
    styles?: string;
  }
  Blocks: {
    default: [];
  };
}

const CardContainer: TemplateOnlyComponent<Signature> = (
  <template>
    <div class="card-container" ...attributes>
      {{#if @label}}
        <span class="card-container__label">{{@label}}</span>
      {{/if}}
      <div {{ShadowRootModifier @label @styles}}>
        {{yield}}
      </div>
    </div>
  </template>
);

export default CardContainer;