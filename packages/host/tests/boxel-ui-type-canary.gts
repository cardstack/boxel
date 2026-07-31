// Type-checking canary for @cardstack/boxel-ui. Never imported at runtime.
//
// Broken declaration re-exports once silently degraded every boxel-ui symbol
// to `any` under skipLibCheck, so the type check passed while checking
// nothing. Degraded symbols accept values real ones reject, so each
// assertion here expects an error that a degraded symbol cannot produce:
// if a directive below reports as unused, that barrel has stopped being
// type-checked and the lint fails.
//
// (Positive detection à la `IsAny<typeof X>` is NOT sufficient: an import
// from an unresolvable module is TypeScript's error type, which behaves
// like `any` in value positions but evades `IsAny` in conditional types.)
import type { Avatar } from '@cardstack/boxel-ui/components';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import type { cn } from '@cardstack/boxel-ui/helpers';
import type { ArrowLeft } from '@cardstack/boxel-ui/icons';
import type { setCssVar } from '@cardstack/boxel-ui/modifiers';

// @ts-expect-error a number is not a component class
export const componentsBarrelIsTyped: typeof Avatar = 42;

// @ts-expect-error a number is not the cn helper function
export const helpersBarrelIsTyped: typeof cn = 42;

// @ts-expect-error a number is not an icon component
export const iconsBarrelIsTyped: typeof ArrowLeft = 42;

// @ts-expect-error a number is not a modifier
export const modifiersBarrelIsTyped: typeof setCssVar = 42;

// If glint ever stops checking boxel-ui component invocations, the expected
// error below never materializes and the unused expect-error directive
// itself fails the type check.
export const invocationCheckingIsLive = <template>
  {{! @glint-expect-error BoxelButton takes @kind, not @variant }}
  <BoxelButton @variant='primary'>canary</BoxelButton>
</template>;
