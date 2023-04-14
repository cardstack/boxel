import Component from '@glimmer/component';

interface Signature {
  Args: {
    isIndexCard: boolean;
    message: any;
  };
}

export default class CardError extends Component<Signature> {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <div data-card-error style='margin: 5em'>
      {{#if @isIndexCard}}
        <b>Cannot load index card.</b>
      {{else}}
        <b>Cannot load card.</b>
      {{/if}}
      <pre
        style='overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;'
      >
        {{@message}}
      </pre>
    </div>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    CardError: typeof CardError;
  }
}
