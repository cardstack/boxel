import { compileAuthorizationGraph } from './compiler.ts';
import {
  toAuthorizationErrorRecord,
  type AuthorizationSafeResult,
} from './errors.ts';
import type { CompiledAuthorizationGraph } from './ir.ts';
import type {
  AuthorizationGraphModel,
  RelationshipTuple,
} from './graph-model.ts';
import {
  checkAuthorization,
  type AuthorizationCheckRequest,
  type AuthorizationCheckResult,
} from './resolver.ts';
import {
  listAuthorizationObjects,
  listAuthorizationUsers,
  type AuthorizationListObjectsRequest,
  type AuthorizationListObjectsResult,
  type AuthorizationListUsersRequest,
  type AuthorizationListUsersResult,
} from './enumerate.ts';
import {
  buildAuthorizationTupleIndex,
  type AuthorizationTupleIndexOptions,
  type AuthorizationTupleIndex,
} from './tuple-index.ts';

export interface PreparedAuthorizationGraph {
  model: CompiledAuthorizationGraph;
  tupleIndex: AuthorizationTupleIndex;
  check(
    request: AuthorizationCheckRequest,
  ): AuthorizationSafeResult<AuthorizationCheckResult>;
  checkMany(
    requests: readonly AuthorizationCheckRequest[],
  ): readonly AuthorizationSafeResult<AuthorizationCheckResult>[];
  listObjects(
    request: AuthorizationListObjectsRequest,
  ): AuthorizationSafeResult<AuthorizationListObjectsResult>;
  listUsers(
    request: AuthorizationListUsersRequest,
  ): AuthorizationSafeResult<AuthorizationListUsersResult>;
}

export interface PrepareAuthorizationGraphOptions extends AuthorizationTupleIndexOptions {}

export function prepareAuthorizationGraphSafe(
  model: AuthorizationGraphModel,
  tuples: readonly RelationshipTuple[] = [],
  options: PrepareAuthorizationGraphOptions = {},
): AuthorizationSafeResult<PreparedAuthorizationGraph> {
  try {
    const compiled = compileAuthorizationGraph(model);
    const tupleIndex = buildAuthorizationTupleIndex(compiled, tuples, options);
    return {
      ok: true,
      value: {
        model: compiled,
        tupleIndex,
        check(request) {
          return checkAuthorization(compiled, tupleIndex, request);
        },
        checkMany(requests) {
          return requests.map((request) =>
            checkAuthorization(compiled, tupleIndex, request),
          );
        },
        listObjects(request) {
          return listAuthorizationObjects(compiled, tupleIndex, request);
        },
        listUsers(request) {
          return listAuthorizationUsers(compiled, tupleIndex, request);
        },
      },
    };
  } catch (error) {
    return { ok: false, error: toAuthorizationErrorRecord(error) };
  }
}

export { compileAuthorizationGraph } from './compiler.ts';
export * from './bxl-authorization.ts';
export * from './errors.ts';
export * from './enumerate.ts';
export * from './identifiers.ts';
export * from './ir.ts';
export * from './graph-model.ts';
export * from './openfga-recursive.ts';
export * from './resolver.ts';
export * from './tuple-index.ts';
