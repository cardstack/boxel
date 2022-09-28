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
    <style>
      .card-container {
        position: relative;
        margin-top: 1rem;
        border: 1px solid gray;
        border-radius: 10px;
        background-color: white;
        overflow: auto;
      }
      .card-container__label {
        position: absolute;
        top: 0;
        right: 0;
        background-color: #f4f4f4;
        color: darkgray;
        font-size: 0.9rem;
        font-weight: bold;
        font-family: Arial, Helvetica, sans-serif;
        padding: 0.5em 1em;
      }
    </style>
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