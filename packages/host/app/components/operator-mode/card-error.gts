import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FileAlert from '@cardstack/boxel-icons/file-alert';

const CardErrorComponent: TemplateOnlyComponent = <template>
  <div class='card-error'>
    <FileAlert class='icon' />
    <div class='message'>This card contains an error.</div>
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
    }
    .message {
      width: 100%;
      text-align: center;
      font: 600 var(--boxel-font);
    }
  </style>
</template>;

export default CardErrorComponent;
