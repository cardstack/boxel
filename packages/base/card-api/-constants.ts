import { Relationship } from '@cardstack/runtime-common';

export const serialize = Symbol.for('cardstack-serialize');
export const deserialize = Symbol.for('cardstack-deserialize');
export const useIndexBasedKey = Symbol.for('cardstack-use-index-based-key');
export const fieldDecorator = Symbol.for('cardstack-field-decorator');
export const fieldType = Symbol.for('cardstack-field-type');
export const queryableValue = Symbol.for('cardstack-queryable-value');
export const formatQuery = Symbol.for('cardstack-format-query');
export const relativeTo = Symbol.for('cardstack-relative-to');
export const realmInfo = Symbol.for('cardstack-realm-info');
export const realmURL = Symbol.for('cardstack-realm-url');

export const formats: Format[] = ['isolated', 'embedded', 'edit', 'atom'];
export type Format = 'isolated' | 'embedded' | 'edit' | 'atom';
export type FieldType = 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';

export const isBaseInstance = Symbol.for('isBaseInstance');
export const isSavedInstance = Symbol.for('cardstack-is-saved-instance');
export const fieldDescription = Symbol.for('cardstack-field-description');

export type JSONAPIResource =
  | {
      attributes: Record<string, any>;
      relationships?: Record<string, Relationship>;
      meta?: Record<string, any>;
    }
  | {
      attributes?: Record<string, any>;
      relationships: Record<string, Relationship>;
      meta?: Record<string, any>;
    };

export interface JSONAPISingleResourceDocument {
  data: Partial<JSONAPIResource> & { id?: string; type: string };
  included?: (Partial<JSONAPIResource> & { id: string; type: string })[];
}

export interface RecomputeOptions {
  loadFields?: true;
  // for host initiated renders (vs indexer initiated renders), glimmer will expect
  // all the fields to be available synchronously, in which case we need to buffer the
  // async in the recompute using this option
  recomputeAllFields?: true;
}
