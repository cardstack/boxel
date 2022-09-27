import type { TemplateOnlyComponent } from "@ember/component/template-only";

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
  };
  Blocks: {
    default: [];
  };
}

const CardContainer: TemplateOnlyComponent<Signature> = (
  <template>
    <div class="card {{@label}}" ...attributes>
      {{#if @label}}
        <div class="card-label"><span>{{@label}}</span></div>
      {{/if}}
      {{yield}}
    </div>
  </template>
);

export default CardContainer;