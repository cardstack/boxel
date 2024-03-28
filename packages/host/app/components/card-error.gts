import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { eq } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    type: 'index' | 'stack' | 'card';
    message: any;
    operatorModeState?: string;
  };
}

const CardError: TemplateOnlyComponent<Signature> = <template>
  <div data-card-error class='container'>
    {{#if (eq @type 'index')}}
      <b>Cannot load index card.</b>
    {{else if (eq @type 'stack')}}
      <b>Cannot load stack.</b>
    {{else}}
      <b>Cannot load card.</b>
    {{/if}}
    <pre class='error'>{{@message}}</pre>

    {{#if @operatorModeState}}
      <pre class='error'>Operator mode state: {{@operatorModeState}}</pre>
    {{/if}}
  </div>
  <style>
    .container {
      margin: 5em;
    }

    .error {
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</template>;

export default CardError;
