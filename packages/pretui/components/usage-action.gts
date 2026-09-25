// Pretui — UsageAction: a doc-only row for an action argument.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { UsageArgument } from './usage-argument';
import type { UsagePresetSignature } from '../internal/freestyle';

export const UsageAction: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Action'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;
