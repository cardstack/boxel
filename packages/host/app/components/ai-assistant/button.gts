import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn } from '@cardstack/boxel-ui/helpers';

import OperatorModeIconButton from '@cardstack/host/components/operator-mode/icon-button';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    isActive: boolean;
  };
}

const AiAssistantButton: TemplateOnlyComponent<Signature> = <template>
  <OperatorModeIconButton
    class={{cn 'ai-assistant-button' is-active=@isActive}}
    data-test-open-ai-assistant
    ...attributes
  />
  <style scoped>
    .ai-assistant-button {
      background-image: image-set(
        url('./ai-assist-icon.webp') 1x,
        url('./ai-assist-icon@2x.webp') 2x,
        url('./ai-assist-icon@3x.webp')
      );
      background-size: 26px 26px;
      background-position: center;
      background-repeat: no-repeat;
    }
    .ai-assistant-button.is-active {
      background-image:
        image-set(
          url('./ai-assist-icon-bw.png') 1x,
          url('./ai-assist-icon-bw@2x.png') 2x,
          url('./ai-assist-icon-bw@3x.png')
        ),
        image-set(
          url('./ai-assist-button-active-bg.webp') 1x,
          url('./ai-assist-button-active-bg@2x.webp') 2x,
          url('./ai-assist-button-active-bg@3x.webp')
        );
      background-size:
        26px 26px,
        40px 40px;
      background-position: center, center;
      background-repeat: no-repeat, no-repeat;
    }
  </style>
</template>;

export default AiAssistantButton;
