import type { SubjectTypeConstraint } from './identifiers.ts';

export interface AuthorizationPredicateInput {
  context: Readonly<Record<string, unknown>>;
  subject: Readonly<{
    type: string;
    id: string;
    canonical: string;
    relation?: string;
    wildcard: boolean;
  }>;
  object: Readonly<{ type: string; id: string; canonical: string }>;
  relation: string;
}

export type AuthorizationRelationExpression =
  | { kind: 'direct' }
  | { kind: 'computed'; relation: string }
  | { kind: 'tupleToUserset'; tupleset: string; computed: string }
  | { kind: 'union'; children: readonly AuthorizationRelationExpression[] }
  | {
      kind: 'intersection';
      children: readonly AuthorizationRelationExpression[];
    }
  | {
      kind: 'difference';
      base: AuthorizationRelationExpression;
      subtract: AuthorizationRelationExpression;
    }
  | {
      kind: 'predicate';
      evaluate(input: AuthorizationPredicateInput): boolean;
    };

export interface CompiledAuthorizationRelation {
  name: string;
  assignable: boolean;
  allowedSubjects: readonly SubjectTypeConstraint[];
  expression: AuthorizationRelationExpression;
  source: string;
}

export interface CompiledAuthorizationType {
  name: string;
  relations: ReadonlyMap<string, CompiledAuthorizationRelation>;
}

export interface CompiledAuthorizationGraph {
  schema: 'bxl-authorization-ir/1';
  types: ReadonlyMap<string, CompiledAuthorizationType>;
  conditions: ReadonlyMap<string, CompiledAuthorizationCondition>;
}

export interface CompiledAuthorizationCondition {
  name: string;
  source: string;
  parameters: Readonly<Record<string, string>>;
  evaluate(
    requestContext: Readonly<Record<string, unknown>>,
    tupleContext?: Readonly<Record<string, unknown>>,
  ): boolean;
}
