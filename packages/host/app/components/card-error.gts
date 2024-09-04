import Component from '@glimmer/component';

interface Signature {
  Args: {
    isIndexCard: boolean;
    message: any;
  };
}

export default class CardError extends Component<Signature> {
  <template>
    <div data-card-error class='container'>
      {{#if @isIndexCard}}
        <b>Cannot load index card.</b>
      {{else}}
        <b>Cannot load card.</b>
      {{/if}}
      <pre class='error'>
        {{@message}}
      </pre>
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
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardError: typeof CardError;
  }
}
