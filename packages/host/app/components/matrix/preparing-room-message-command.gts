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

  {{! template-lint-disable no-whitespace-for-layout  }}
  {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
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
