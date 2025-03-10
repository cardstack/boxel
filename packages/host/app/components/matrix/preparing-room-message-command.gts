import { TemplateOnlyComponent } from '@ember/component/template-only';

import ApplyButton from '../ai-assistant/apply-button';

interface Signature {
  Element: HTMLDivElement;
}

const RoomMessageCommand: TemplateOnlyComponent<Signature> = <template>
  <div ...attributes>
    <div class='command-button-bar'>
      <ApplyButton @state='preparing' data-test-command-apply='preparing' />
    </div>
  </div>

  <style scoped>
    .command-button-bar {
      display: flex;
      justify-content: flex-end;
      gap: var(--boxel-sp-xs);
      margin-top: var(--boxel-sp);
    }
  </style>
</template>;

export default RoomMessageCommand;
