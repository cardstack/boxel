export const BXL_AUTHORIZATION_IR_SCHEMA = 'bxl-authorization-ir/1' as const;

export type SubjectTypeReference =
  | string
  | {
      type: string;
      relation?: string;
      wildcard?: boolean;
      condition?: string;
    };

export interface AuthorizationGraphRelation {
  /** Subject types that may be written directly, such as `user` or `group#member`. */
  subjects?: readonly SubjectTypeReference[];
  /** BXL authorization expression. Defaults to `direct()` when subjects exist. */
  rewrite?: string;
}

export type AuthorizationGraphRelationDefinition =
  | readonly SubjectTypeReference[]
  | AuthorizationGraphRelation;

export interface AuthorizationGraphType {
  relations?: Readonly<Record<string, AuthorizationGraphRelationDefinition>>;
  permissions?: Readonly<Record<string, string>>;
}

export interface AuthorizationGraphCondition {
  expression: string;
  parameters?: Readonly<Record<string, string>>;
}

export interface AuthorizationGraphModel {
  schema: typeof BXL_AUTHORIZATION_IR_SCHEMA;
  types: Readonly<Record<string, AuthorizationGraphType>>;
  conditions?: Readonly<Record<string, AuthorizationGraphCondition>>;
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
