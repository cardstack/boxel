import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FileAlert from '@cardstack/boxel-icons/file-alert';

interface Signature {
  Args: {
    cardCreationError?: boolean;
  };
}

const CardErrorComponent: TemplateOnlyComponent<Signature> = <template>
  <div class='card-error'>
    <FileAlert class='icon' />
    <div class='message'>
      {{#if @cardCreationError}}
        Failed to create card.
      {{else}}
        This card contains an error.
      {{/if}}
    </div>
  </div>

  <style scoped>
    .icon {
      height: 100px;
      width: 100px;
    }
    .card-error {
      display: flex;
      height: 100%;
      align-content: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp);
    }
    .message {
      width: 100%;
      text-align: center;
      font: 600 var(--boxel-font);
    }
  </style>
</template>;

export default CardErrorComponent;
