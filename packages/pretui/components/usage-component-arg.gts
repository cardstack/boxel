// Pretui — UsageComponentArg: a doc-only row for a component argument.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { UsageArgument } from './usage-argument';
import type { UsagePresetSignature } from '../internal/freestyle';

export const UsageComponentArg: TemplateOnlyComponent<UsagePresetSignature> =
  <template>
    <UsageArgument
      @mode={{@mode}}
      @type='Component'
      @name={{@name}}
      @description={{@description}}
      @required={{@required}}
      @defaultValue={{@defaultValue}}
    />
  </template>;
