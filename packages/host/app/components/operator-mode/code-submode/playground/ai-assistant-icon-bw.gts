import type { Icon } from '@cardstack/boxel-ui/icons';

const AiAssistantIcon: Icon = <template>
  <span class='ai-icon' />
  <style scoped>
    .ai-icon {
      --size: var(--boxel-ai-icon-size, var(--boxel-icon-xs));
      display: inline-block;
      width: var(--size);
      height: var(--size);
      background-image: image-set(
        url('../../../ai-assistant/assets/ai-assist-icon-bw.png') 1x,
        url('../../../ai-assistant/assets/ai-assist-icon-bw@2x.png') 2x,
        url('../../../ai-assistant/assets/ai-assist-icon-bw@3x.png')
      );
      background-position: center;
      background-repeat: no-repeat;
      background-size: contain;
    }
  </style>
</template>;

export default AiAssistantIcon;
