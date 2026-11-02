// Whether people who aren't signed in may use a key, as rows of a card's edit
// format: a checkbox, with what ticking it means beside it, and once it is
// ticked, the key's optional anonymous cap. It is a key's own setting, made
// when the key is added or on the key page, never per workspace. Each page
// words the checkbox and its note for itself; the cap reads the same
// everywhere, since it is the key's, counted across every workspace the key
// is shared into.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Checkbox from '../../components/checkbox.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import Users from '../../components/icons/users.gts';
import BoxelInput from '../../components/input.gts';

// The most calls a day a cap can be, as the realm server takes it.
const MAX_CAP = 2_147_483_647;

// The cap as typed: null for none (empty, or anonymous use not allowed), a
// whole number of calls from one up, or undefined when it is neither.
// Whether a key can serve people who aren't signed in at all, and so takes
// the setting and is held to a workspace's rule about them: a sign-in app's
// calls are each person's own sign-in, and a connection is one person's, so
// neither ever does. An app that gets its own tokens (`client_credentials`)
// does.
export function servesVisitors(key: {
  kind: string;
  oauth?: { client?: { grantType: string } };
}): boolean {
  return (
    key.kind !== 'oauth-connection' &&
    (key.kind !== 'oauth-client' ||
      key.oauth?.client?.grantType === 'client_credentials')
  );
}

export function anonymousCapOf(
  anonymous: boolean,
  text: string,
): number | null | undefined {
  let trimmed = text.trim();
  if (!anonymous || trimmed === '') {
    return null;
  }
  let cap = Number(trimmed);
  return /^\d+$/.test(trimmed) && cap >= 1 && cap <= MAX_CAP ? cap : undefined;
}

// What a key's anonymous use is, as a line under it: whether people who
// aren't signed in can use it, and up to how many calls a day.
export function anonymousUseSummary(key: {
  anonymous: boolean;
  anonymousDailyCap: number | null;
}): string {
  if (!key.anonymous) {
    return 'Only people who are signed in can use it';
  }
  return key.anonymousDailyCap
    ? `People who aren’t signed in can use it where a workspace lets them, up to ${key.anonymousDailyCap} calls a day all together`
    : 'People who aren’t signed in can use it where a workspace lets them, with no daily cap';
}

function capInvalid(anonymous: boolean, text: string): boolean {
  return anonymousCapOf(anonymous, text) === undefined;
}

function capState(anonymous: boolean, text: string): 'none' | 'invalid' {
  return capInvalid(anonymous, text) ? 'invalid' : 'none';
}

function capError(anonymous: boolean, text: string): string | undefined {
  return capInvalid(anonymous, text)
    ? 'A whole number of calls, at least one, or empty for no cap'
    : undefined;
}

interface Signature {
  Args: {
    anonymous: boolean;
    // The cap as typed.
    cap: string;
    // What ticking the checkbox says, and the note under it.
    agreement: string;
    note: string;
    onToggle: () => void;
    onCap: (value: string) => void;
  };
}

const AnonymousUseFields: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='label'
    @label='People who aren’t signed in'
    @icon={{Users}}
    data-test-anonymous-use
  >
    <span class='agree'>
      <Checkbox
        @checked={{@anonymous}}
        @onChange={{@onToggle}}
        data-test-anonymous-use-input
      />
      <span class='agree-text'>
        <span data-test-anonymous-use-agreement>{{@agreement}}</span>
        <span class='note' data-test-anonymous-use-note>{{@note}}</span>
      </span>
    </span>
  </FieldContainer>
  {{#if @anonymous}}
    <FieldContainer
      @tag='div'
      @label='Anonymous cap (optional)'
      @icon={{KeyRound}}
      data-test-anonymous-cap
      as |labelId|
    >
      <BoxelInput
        @type='text'
        @autocomplete='off'
        @placeholder='No cap'
        @value={{@cap}}
        @onInput={{@onCap}}
        @state={{capState @anonymous @cap}}
        @errorMessage={{capError @anonymous @cap}}
        @describedBy='anonymous-cap-note'
        inputmode='numeric'
        aria-labelledby={{labelId}}
        data-test-anonymous-cap-input
      />
      <span id='anonymous-cap-note' class='note cap-note'>How many calls people
        who aren’t signed in can make with this key each day, all together, in
        every workspace it’s shared into. Leave it empty for no cap.</span>
    </FieldContainer>
  {{/if}}

  <style scoped>
    .agree {
      display: flex;
      align-items: flex-start;
      gap: var(--boxel-sp-xs);
      cursor: pointer;
    }
    .agree-text {
      display: grid;
      min-width: 0;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
    .note {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
    .cap-note {
      display: block;
    }
  </style>
</template>;

export default AnonymousUseFields;
