import Component from '@glimmer/component';

interface Signature {
  Args: {
    message?: string;
  };
}

export default class ErrorMessage extends Component<Signature> {
  get hasMessage() {
    return Boolean(this.args.message && this.args.message.trim().length > 0);
  }

  <template>
    {{#if this.hasMessage}}
      <div class='error-message'>{{@message}}</div>
    {{/if}}

    <style scoped>
      .error-message {
        padding: 0.5rem 0.75rem;
        border-radius: 0.375rem;
        background: #f3f4f6;
        border-left: 3px solid var(--boxel-primary-500, #3b82f6);
        font-size: 0.8125rem;
        white-space: pre-wrap;
      }
    </style>
  </template>
}
