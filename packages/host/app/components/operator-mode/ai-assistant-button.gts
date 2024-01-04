import Component from '@glimmer/component';
import './ai-assist-icon.webp';
import './ai-assist-icon@2x.webp';
import './ai-assist-icon@3x.webp';

interface Signature {
  Element: HTMLButtonElement;
}

export default class AiAssistantButton extends Component<Signature> {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <button
      class='ai-assistant-button'
      data-test-open-chat
      style="background-image: image-set(url('./ai-assist-icon.webp') 1x, url('./ai-assist-icon@2x.webp') 2x, url('./ai-assist-icon@3x.webp') 3x)"
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
        background-color: var(--boxel-ai-purple);
        border: none;
        background-size: 26px 26px;
        background-position: center;
        background-repeat: no-repeat;
      }
      .ai-assistant-button:hover {
        cursor: pointer;
      }
    </style>
  </template>
}
