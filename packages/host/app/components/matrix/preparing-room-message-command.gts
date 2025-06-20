import { TemplateOnlyComponent } from '@ember/component/template-only';

import ApplyButton from '../ai-assistant/apply-button';
import CommandButtonBar from './command-button-bar';

interface Signature {
  Element: HTMLDivElement;
}

const RoomMessageCommand: TemplateOnlyComponent<Signature> = <template>
  <div ...attributes>
    <CommandButtonBar>
      <ApplyButton @state='preparing' data-test-command-apply='preparing' />
    </CommandButtonBar>
  </div>
</template>;

export default RoomMessageCommand;
