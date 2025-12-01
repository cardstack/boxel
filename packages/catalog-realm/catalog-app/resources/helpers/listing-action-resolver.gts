import { CardContext } from 'https://cardstack.com/base/card-api';
import { Listing } from '../../listing/listing';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import ListingBuildCommand from '@cardstack/boxel-host/commands/listing-action-build';
import ListingRemixCommand from '@cardstack/boxel-host/commands/listing-remix';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';

// Typed available actions mapped to function signatures

export interface BaseAction {
  view: () => Promise<void>;
}
export interface SkillActions extends BaseAction {
  readonly type: 'skill';
  preview: () => Promise<void>;
  addSkillsToRoom?: () => Promise<void>;
  remix?: (realmUrl: string) => Promise<void>;
}

export interface StubActions extends BaseAction {
  readonly type: 'stub';
  preview: () => Promise<void>;
  build: (realmUrl: string) => Promise<void>;
}

export interface RegularActions extends BaseAction {
  readonly type: 'regular';
  preview?: () => Promise<void>;
  remix?: (realmUrl: string) => Promise<void>;
}

export interface ThemeActions extends BaseAction {
  readonly type: 'theme';
  preview?: () => Promise<void>;
  remix?: (realmUrl: string) => Promise<void>;
}

export type ListingActions =
  | SkillActions
  | StubActions
  | RegularActions
  | ThemeActions;

/**
 * Resolves listing type and returns appropriate action configuration
 */
export function resolveListingActions(
  listing: Listing,
  context: CardContext,
): ListingActions {
  const hasExamples = Boolean(listing.examples?.length);
  const hasSpecs = Boolean(listing.specs?.length);
  const hasSkills = Boolean(listing.skills?.length);
  const isStub = listing.tags?.some((tag) => tag.name === 'Stub') ?? false;
  const isSkillListing = listing.constructor?.name === 'SkillListing';
  const isThemeListing = listing.constructor?.name === 'ThemeListing';

  // Create appropriate adapter instances
  const cardOrFieldAdapter = new CardOrFieldListingAdapter(context);
  const skillAdapter = new SkillListingAdapter(context);
  const stubAdapter = new StubListingAdapter(context);

  // Return typed adapter based on listing condition
  if (isSkillListing) {
    return {
      type: 'skill',
      ...(hasExamples && {
        preview: () => skillAdapter.preview(listing),
      }),
      ...(hasSkills && {
        addSkillsToRoom: () => skillAdapter.addSkillsToRoom(listing),
      }),
      ...(hasSkills && {
        remix: (realmUrl: string) => skillAdapter.remix(listing, realmUrl),
      }),
      view: () => skillAdapter.view(listing),
    } as SkillActions;
  }

  if (isStub) {
    return {
      type: 'stub',
      ...(hasExamples && {
        preview: () => stubAdapter.preview(listing),
      }),
      build: (realmUrl: string) => stubAdapter.build(listing, realmUrl),
      view: () => stubAdapter.view(listing),
    } as StubActions;
  }

  if (isThemeListing) {
    return {
      type: 'theme',
      ...(hasExamples && {
        preview: () => cardOrFieldAdapter.preview(listing),
      }),
      ...((hasSpecs || hasSkills || hasExamples) && {
        remix: (realmUrl: string) =>
          cardOrFieldAdapter.remix(listing, realmUrl),
      }),
      view: () => cardOrFieldAdapter.view(listing),
    } as ThemeActions;
  }

  return {
    type: 'regular',
    ...(hasExamples && {
      preview: () => cardOrFieldAdapter.preview(listing),
    }),
    ...(hasSpecs && {
      remix: (realmUrl: string) => cardOrFieldAdapter.remix(listing, realmUrl),
    }),
    view: () => cardOrFieldAdapter.view(listing),
  } as RegularActions;
}

/**
 * Base adapter class with common functionality - preview and view only
 */
export class BaseListingAdapter {
  context: CardContext;
  // Common action implementations available to all adapters
  constructor(context: CardContext) {
    this.context = context;
  }

  async preview(listing: Listing): Promise<void> {
    if (!listing.examples?.length) throw new Error('No examples available');
    const commandContext = this.context.commandContext;
    if (!commandContext) {
      return;
    }
    await new ShowCardCommand(commandContext).execute({
      cardId: listing.examples[0].id,
    });
  }

  async view(listing: Listing): Promise<void> {
    if (!listing.id) throw new Error('No listing id available');
    const commandContext = this.context.commandContext;
    if (!commandContext) {
      return;
    }
    await new ShowCardCommand(commandContext).execute({
      cardId: listing.id,
      format: 'isolated',
    });
  }
}

/**
 * Card or Field listing adapter - includes remix
 */
export class CardOrFieldListingAdapter extends BaseListingAdapter {
  async remix(listing: Listing, realmUrl: string): Promise<void> {
    if (!realmUrl) throw new Error('Realm URL required for remix action');
    const commandContext = this.context.commandContext;
    if (!commandContext) throw new Error('Missing commandContext');
    await new ListingRemixCommand(commandContext).execute({
      realm: realmUrl,
      listing: listing,
    });
  }
}

/**
 * Skill listing adapter - includes remix + addSkillsToRoom
 */
export class SkillListingAdapter extends CardOrFieldListingAdapter {
  async addSkillsToRoom(listing: Listing): Promise<void> {
    if (!listing.skills?.length) throw new Error('No skills available');
    const commandContext = this.context.commandContext;
    if (!commandContext) throw new Error('Missing commandContext');
    const useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
    await useAiAssistantCommand.execute({
      skillCards: [...listing.skills],
      openRoom: true,
    });
  }
}

/**
 * Stub listing adapter - no remix, just build
 */
export class StubListingAdapter extends BaseListingAdapter {
  async build(listing: Listing, realmUrl: string): Promise<void> {
    if (!realmUrl) throw new Error('Realm URL required for build action');
    const commandContext = this.context.commandContext;
    if (!commandContext) throw new Error('Missing commandContext');
    await new ListingBuildCommand(commandContext).execute({
      realm: realmUrl,
      listing: listing,
    });
  }
}
