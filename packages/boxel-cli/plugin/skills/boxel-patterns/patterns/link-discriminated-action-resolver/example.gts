import { CardDef } from 'https://cardstack.com/base/card-api';

// 🧩 PATTERN: Discriminated-union action resolver
//
// One resolver knows the card → actions mapping. Consumers get type-safe
// access to only the actions valid for the card they have.

// Stand-in subtypes — yours will be richer.
export class Listing extends CardDef {}
export class SkillListing extends Listing {}
export class AppListing extends Listing {}
export class ThemeListing extends Listing {}

interface Context {
  installSkill: (id: string) => Promise<void>;
  installApp: (id: string) => Promise<void>;
  applyTheme: (id: string) => Promise<void>;
  openRoom: (id: string) => Promise<void>;
}

// 🎯 One interface per action set — each carries a literal `type` discriminant.

interface SkillActions {
  type: 'skill';
  installSkill: () => Promise<void>;
  openRoom: () => Promise<void>;
}

interface AppActions {
  type: 'app';
  installApp: () => Promise<void>;
}

interface ThemeActions {
  type: 'theme';
  applyTheme: () => Promise<void>;
}

interface RegularActions {
  type: 'regular';
}

export type ListingActions =
  | SkillActions
  | AppActions
  | ThemeActions
  | RegularActions;

// 🎯 The resolver.
export function resolveListingActions(
  card: Listing,
  ctx: Context,
): ListingActions {
  if (card instanceof SkillListing) {
    return {
      type: 'skill',
      installSkill: () => ctx.installSkill(card.id),
      openRoom: () => ctx.openRoom(card.id),
    };
  }
  if (card instanceof AppListing) {
    return {
      type: 'app',
      installApp: () => ctx.installApp(card.id),
    };
  }
  if (card instanceof ThemeListing) {
    return {
      type: 'theme',
      applyTheme: () => ctx.applyTheme(card.id),
    };
  }
  return { type: 'regular' };
}

// === Consumer side ====================================================
//
// const actions = resolveListingActions(card, context);
//
// switch (actions.type) {
//   case 'skill':
//     // ✅ TS knows installSkill + openRoom exist; nothing else
//     await actions.installSkill();
//     break;
//   case 'app':
//     await actions.installApp();
//     break;
//   // …
// }
