import type { Query, Filter, CodeRef } from '@cardstack/runtime-common';
import {
  baseRealm,
  ensureTrailingSlash,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import type {
  CardCollectionDocument,
  PrerenderedCardCollectionDocument,
} from '@cardstack/runtime-common/document-types';

import ENV from '@cardstack/host/config/environment';

export const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);

type MockSpecCard = {
  type: 'card';
  id: string;
  attributes: {
    title?: string;
    description?: string;
    specType: 'card' | 'field';
    ref: CodeRef;
  };
  meta: {
    adoptsFrom: CodeRef;
  };
};

const BASE_REALM_SPEC_CARDS: MockSpecCard[] = [
  {
    type: 'card',
    id: `${baseRealm.url}types/card`,
    attributes: {
      title: 'General Card',
      description: 'A general card that can contain any card type.',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}card-api`,
        name: 'CardDef',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/ai-app-generator`,
    attributes: {
      title: 'AI App Generator',
      description:
        'Design your own app UI by describing what you want to build',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}ai-app-generator`,
        name: 'AiAppGenerator',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/brand-guide`,
    attributes: {
      title: 'Brand Guide',
      description: 'Guide to brand elements and visual style',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}brand-guide`,
        name: 'default',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/detailed-style-reference`,
    attributes: {
      title: 'Detailed Style Reference',
      description:
        'Comprehensive reference card for documenting a product’s visual language and theme variables.',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}detailed-style-reference`,
        name: 'default',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/skill`,
    attributes: {
      title: 'Skill',
      description: 'A card with instructions to teach a skill to the AI bot',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}skill`,
        name: 'Skill',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/structured-theme`,
    attributes: {
      title: 'Structured Theme',
      description: 'A card for defining a structured theme with CSS variables',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}structured-theme`,
        name: 'default',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/style-reference`,
    attributes: {
      title: 'Style Reference',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}style-reference`,
        name: 'default',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/theme`,
    attributes: {
      title: 'Theme',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}theme`,
        name: 'default',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
  {
    type: 'card',
    id: `${baseRealm.url}cards/welcome-to-boxel`,
    attributes: {
      title: 'Welcome to Boxel',
      description: 'A welcome card with onboarding content and lesson cards',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}welcome-to-boxel`,
        name: 'WelcomeToBoxel',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
];

export type BaseRealmSpecCard = MockSpecCard;

const CATALOG_REALM_SPEC_CARDS: MockSpecCard[] = [
  {
    type: 'card',
    id: `${catalogRealmURL}Spec/catalog-card`,
    attributes: {
      title: 'Catalog Card',
      description: 'Catalog realm placeholder card.',
      specType: 'card',
      ref: {
        module: `${baseRealm.url}card-api`,
        name: 'CardDef',
      },
    },
    meta: {
      adoptsFrom: {
        module: `${baseRealm.url}spec`,
        name: 'Spec',
      },
    },
  },
];

function matchesCodeRef(a: CodeRef | undefined, b: CodeRef | undefined) {
  if (!isResolvedCodeRef(a) || !isResolvedCodeRef(b)) {
    return false;
  }
  return a.module === b.module && a.name === b.name;
}

function getAttributeValue(
  card: BaseRealmSpecCard,
  fieldName: string,
): unknown {
  if (fieldName === 'isCard') {
    return card.attributes.specType === 'card';
  }
  if (fieldName === 'isField') {
    return card.attributes.specType === 'field';
  }
  let value = (card.attributes as Record<string, unknown>)[fieldName];
  return value;
}

function matchesFilter(card: BaseRealmSpecCard, filter: Filter): boolean {
  if ('type' in filter) {
    return matchesCodeRef(card.meta?.adoptsFrom, filter.type);
  }
  if ('any' in filter) {
    return filter.any.some((entry) => matchesFilter(card, entry));
  }
  if ('every' in filter) {
    if (filter.on && !matchesCodeRef(card.meta?.adoptsFrom, filter.on)) {
      return false;
    }
    return filter.every.every((entry) => matchesFilter(card, entry));
  }
  if ('not' in filter) {
    return !matchesFilter(card, filter.not);
  }
  if ('eq' in filter) {
    return Object.entries(filter.eq).every(([field, value]) => {
      return getAttributeValue(card, field) === value;
    });
  }
  if ('contains' in filter) {
    return Object.entries(filter.contains).every(([field, value]) => {
      let cardValue = String(
        getAttributeValue(card, field) ?? '',
      ).toLowerCase();
      return cardValue.includes(String(value ?? '').toLowerCase());
    });
  }
  if ('range' in filter) {
    return true;
  }
  return true;
}

function filterCardsByQuery(
  cards: BaseRealmSpecCard[],
  query: Query,
): BaseRealmSpecCard[] {
  if (!query.filter) {
    return [...cards];
  }
  return cards.filter((card) => matchesFilter(card, query.filter!));
}

export function filterBaseRealmCards(query: Query): BaseRealmSpecCard[] {
  return filterCardsByQuery(BASE_REALM_SPEC_CARDS, query);
}

export function filterCatalogRealmCards(query: Query): BaseRealmSpecCard[] {
  return filterCardsByQuery(CATALOG_REALM_SPEC_CARDS, query);
}

export function buildSearchDocFromCards(
  cards: BaseRealmSpecCard[],
): CardCollectionDocument {
  return {
    data: cards.map((card) => ({
      type: card.type,
      id: card.id,
      attributes: card.attributes,
      meta: card.meta,
    })),
    meta: { page: { total: cards.length } },
  };
}

export function buildPrerenderedDocFromCards(
  cards: BaseRealmSpecCard[],
): PrerenderedCardCollectionDocument {
  return {
    data: cards.map((card) => ({
      type: 'prerendered-card',
      id: card.id,
      attributes: {
        html: `<div>${card.attributes.title ?? 'Card'}</div>`,
      },
      relationships: {
        'prerendered-card-css': {
          data: [],
        },
      },
      meta: {},
    })),
    meta: { page: { total: cards.length } },
  };
}
