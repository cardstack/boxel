import Component from '@glimmer/component';

import url from './ai-assist-icon.webp';

interface Signature {
  Element: HTMLButtonElement;
}

export default class AiAssistantButton extends Component<Signature> {
  <template>
    {{! template-lint-disable no-inline-styles }}
    <button
      class='ai-assistant-button'
      data-test-open-ai-assistant
      style="background-image: url('{{url}}')"
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
