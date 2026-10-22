// How long the CLI waits for a sign-in to reach it, said on the pages a
// sign-in reaches after an email: by then the CLI may have stopped waiting.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { CliCallback } from '../../security/cli-handoff.js';

// The CLI's own wait (`CLI_AUTH_TIMEOUT_MS` in runtime-common's `cli-auth`),
// in its words; `tests/cli-wait.test.ts` holds the two together.
export const CLI_WAIT = '30 minutes';

interface Signature {
  Args: { cli: CliCallback };
}

const CliWaitNotice: TemplateOnlyComponent<Signature> = <template>
  <p class='notice' data-test-secure-cli-wait>The CLI stops waiting after
    {{CLI_WAIT}}. If signing in doesn't reach it, run
    <code>{{if @cli.profile 'boxel profile add' 'boxel keys sign-in'}}</code>
    again.</p>

  <style scoped>
    .notice {
      margin: 0 0 var(--boxel-sp-lg);
      color: var(--muted-foreground);
      font: var(--boxel-font-xs);
      line-height: 1.4;
    }
    .notice code {
      font-family: var(--boxel-monospace-font-family, monospace);
    }
  </style>
</template>;

export default CliWaitNotice;
