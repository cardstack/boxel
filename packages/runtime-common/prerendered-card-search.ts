import type { ComponentLike } from '@glint/template';
import type { Query } from './query';
import type { Format } from './formats';
import type { QueryResultsMeta } from './index-query-engine';
import type { ResolvedCodeRef } from './code-ref';

export interface PrerenderedCardData {
  url: string;
  realmUrl: string;
  html: string;
  isError: boolean;
  cardType?: string;
  iconHtml?: string;
  usedRenderType?: ResolvedCodeRef;
  isFileMeta?: boolean;
}

export interface PrerenderedCardLike {
  url: string;
  isError: boolean;
  realmUrl: string;
  component: ComponentLike<{ Args: {}; Element: Element }>;
  cardType?: string;
  iconHtml?: string;
  usedRenderType?: ResolvedCodeRef;
}

export interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
    cardUrls?: string[];
    isLive?: boolean;
  };
  Blocks: {
    loading: [];
    response: [cards: PrerenderedCardLike[]];
    meta: [meta: QueryResultsMeta];
  };
}
