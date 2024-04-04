import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    isActive: boolean;
  };
}

const AiAssistantButton: TemplateOnlyComponent<Signature> = <template>
  <button
    class={{cn 'ai-assistant-button' is-active=@isActive}}
    data-test-open-ai-assistant
    ...attributes
  />
  <style>
    .ai-assistant-button {
      width: var(--container-button-size);
      height: var(--container-button-size);

      position: absolute;
      bottom: var(--boxel-sp);
      right: var(--boxel-sp);
      border-radius: var(--boxel-border-radius);
      background-color: var(--boxel-dark);
      border: 1px solid rgba(255, 255, 255, 0.35);

      background-image: image-set(
        url('./ai-assist-icon.webp') 1x,
        url('./ai-assist-icon@2x.webp') 2x,
        url('./ai-assist-icon@3x.webp')
      );
      background-size: 26px 26px;
      background-position: center;
      background-repeat: no-repeat;
    }
    .ai-assistant-button:hover {
      cursor: pointer;
    }

    .ai-assistant-button.is-active {
      background-image: image-set(
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
      border: 1px solid rgba(0, 0, 0, 0.35);
    }
  </style>
</template>;

export default AiAssistantButton;
