import type { ComponentLike } from '@glint/template';
import { type Query } from './query';
import { type Format } from './formats';

export interface PrerenderedCardData {
  url: string;
  realmUrl: string;
  html: string;
  isError: boolean;
}

export interface PrerenderedCardLike {
  url: string;
  isError: boolean;
  realmUrl: string;
  component: ComponentLike<{ Args: {} }>;
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
  };
}
