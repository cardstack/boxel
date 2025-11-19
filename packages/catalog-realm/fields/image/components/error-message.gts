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
        padding: calc(var(--spacing, 0.25rem) * 2)
          calc(var(--spacing, 0.25rem) * 3);
        border-radius: var(--radius, 0.375rem);
        background: var(--muted, #f3f4f6);
        border-left: 3px solid var(--primary, #3b82f6);
        color: var(--muted-foreground, #6b7280);
        font-size: 0.8125rem;
        white-space: pre-wrap;
      }
    </style>
  </template>
}
