export const BXL_AUTHORIZATION_SCHEMA = 'bxl-authorization/1' as const;

export type SubjectTypeReference =
  | string
  | {
      type: string;
      relation?: string;
      wildcard?: boolean;
      condition?: string;
    };

export interface BxlAuthorizationRelation {
  /** Subject types that may be written directly, such as `user` or `group#member`. */
  subjects?: readonly SubjectTypeReference[];
  /** BXL authorization expression. Defaults to `direct()` when subjects exist. */
  rewrite?: string;
}

export type BxlAuthorizationRelationDefinition =
  | readonly SubjectTypeReference[]
  | BxlAuthorizationRelation;

export interface BxlAuthorizationType {
  relations?: Readonly<Record<string, BxlAuthorizationRelationDefinition>>;
  permissions?: Readonly<Record<string, string>>;
}

export interface BxlAuthorizationCondition {
  expression: string;
  parameters?: Readonly<Record<string, string>>;
}

export interface BxlAuthorizationModel {
  schema: typeof BXL_AUTHORIZATION_SCHEMA;
  types: Readonly<Record<string, BxlAuthorizationType>>;
  conditions?: Readonly<Record<string, BxlAuthorizationCondition>>;
}

export interface RelationshipCondition {
  name: string;
  context?: Readonly<Record<string, unknown>>;
}

export interface RelationshipTuple {
  subject: string;
  relation: string;
  object: string;
  condition?: RelationshipCondition;
}
