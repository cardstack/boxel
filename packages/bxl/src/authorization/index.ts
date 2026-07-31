import { compileAuthorizationGraph } from './compiler.js';
import {
  toAuthorizationErrorRecord,
  type AuthorizationSafeResult,
} from './errors.js';
import type { CompiledAuthorizationGraph } from './ir.js';
import type { AuthorizationGraphModel, RelationshipTuple } from './graph-model.js';
import {
  checkAuthorization,
  type AuthorizationCheckRequest,
  type AuthorizationCheckResult,
} from './resolver.js';
import {
  listAuthorizationObjects,
  listAuthorizationUsers,
  type AuthorizationListObjectsRequest,
  type AuthorizationListObjectsResult,
  type AuthorizationListUsersRequest,
  type AuthorizationListUsersResult,
} from './enumerate.js';
import {
  buildAuthorizationTupleIndex,
  type AuthorizationTupleIndexOptions,
  type AuthorizationTupleIndex,
} from './tuple-index.js';

export interface PreparedAuthorizationGraph {
  model: CompiledAuthorizationGraph;
  tupleIndex: AuthorizationTupleIndex;
  check(request: AuthorizationCheckRequest): AuthorizationSafeResult<AuthorizationCheckResult>;
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

export interface PrepareAuthorizationGraphOptions
  extends AuthorizationTupleIndexOptions {}

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
          return requests.map((request) => checkAuthorization(compiled, tupleIndex, request));
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

export { compileAuthorizationGraph } from './compiler.js';
export * from './bxl-authorization.js';
export * from './errors.js';
export * from './enumerate.js';
export * from './identifiers.js';
export * from './ir.js';
export * from './graph-model.js';
export * from './openfga-recursive.js';
export * from './resolver.js';
export * from './tuple-index.js';
