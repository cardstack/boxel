import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Tooltip } from '@cardstack/boxel-ui/components';
import { Warning } from '@cardstack/boxel-ui/icons';

export const FALLBACK_WARNING_MESSAGE =
  "Custom system card couldn't be loaded — using built-in defaults. Some models may have reduced capabilities.";

interface Signature {
  Element: HTMLElement;
}

const FallbackWarning: TemplateOnlyComponent<Signature> = <template>
  <Tooltip @placement='bottom' data-test-fallback-warning ...attributes>
    <:trigger>
      <Warning
        class='warning-icon'
        width='16'
        height='16'
        role='img'
        aria-label='AI assistant is running in fallback mode'
      />
    </:trigger>
    <:content>
      {{FALLBACK_WARNING_MESSAGE}}
    </:content>
  </Tooltip>
  <style scoped>
    .warning-icon {
      color: var(--boxel-warning-200);
      display: block;
    }
  </style>
</template>;

export default FallbackWarning;
