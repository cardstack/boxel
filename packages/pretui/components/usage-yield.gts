// Pretui — UsageYield: a doc-only row for a yielded block.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { UsageArgument } from './usage-argument';
import type { UsagePresetSignature } from '../internal/freestyle';

export const UsageYield: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Yield'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;
