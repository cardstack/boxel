import {
  type BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.js';
import {
  prepareAuthorizationGraphSafe,
  type AuthorizationCheckRequest,
  type AuthorizationListObjectsRequest,
  type AuthorizationListUsersRequest,
  type AuthorizationSafeResult,
  type AuthorizationGraphModel,
  type RelationshipTuple,
} from '../../authorization/index.js';
import type { AuthorizationErrorRecord } from '../../authorization/errors.js';

function ipv4ToInteger(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return undefined;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

export function ipv4InCidr(address: unknown, cidr: unknown): boolean {
  if (typeof cidr !== 'string') return false;
  const separator = cidr.lastIndexOf('/');
  if (separator <= 0 || separator === cidr.length - 1) return false;
  const network = ipv4ToInteger(cidr.slice(0, separator));
  const addressValue = ipv4ToInteger(address);
  const prefix = Number(cidr.slice(separator + 1));
  if (
    network === undefined ||
    addressValue === undefined ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressValue & mask) >>> 0 === (network & mask) >>> 0;
}

function invalidNativeInput(message: string): {
  ok: false;
  error: AuthorizationErrorRecord;
} {
  return {
    ok: false,
    error: { kind: 'invalid-model', message },
  };
}

function authorizationInput(
  model: unknown,
  tuples: unknown,
):
  | {
      ok: true;
      model: AuthorizationGraphModel;
      tuples: RelationshipTuple[];
    }
  | { ok: false; error: AuthorizationErrorRecord } {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return invalidNativeInput('auth_* model must be an object.');
  }
  if (!Array.isArray(tuples)) {
    return invalidNativeInput('auth_* tuples must be an array.');
  }
  return {
    ok: true,
    model: model as AuthorizationGraphModel,
    tuples: tuples as RelationshipTuple[],
  };
}

function authorizationOperation<T>(
  model: unknown,
  tuples: unknown,
  operation: (
    prepared: NonNullable<
      Extract<
        ReturnType<typeof prepareAuthorizationGraphSafe>,
        { ok: true }
      >['value']
    >,
  ) => AuthorizationSafeResult<T>,
): AuthorizationSafeResult<T> {
  const input = authorizationInput(model, tuples);
  if (!input.ok) return input;
  const prepared = prepareAuthorizationGraphSafe(input.model, input.tuples);
  if (!prepared.ok) return prepared;
  return operation(prepared.value);
}

const bareNativeFilters: Record<string, BareNativeFilter> = {
  'auth_check/3': function* (_input, model, tuples, request) {
    const result = authorizationOperation(model, tuples, (prepared) =>
      prepared.check(request as AuthorizationCheckRequest),
    );
    yield result.ok ? result.value.allowed : false;
  },
  'auth_check_result/3': function* (_input, model, tuples, request) {
    yield authorizationOperation(model, tuples, (prepared) =>
      prepared.check(request as AuthorizationCheckRequest),
    );
  },
  'auth_list_objects/3': function* (_input, model, tuples, request) {
    yield authorizationOperation(model, tuples, (prepared) =>
      prepared.listObjects(request as AuthorizationListObjectsRequest),
    );
  },
  'auth_list_users/3': function* (_input, model, tuples, request) {
    yield authorizationOperation(model, tuples, (prepared) =>
      prepared.listUsers(request as AuthorizationListUsersRequest),
    );
  },
  'ip_in_cidr/2': function* (_input, address, cidr) {
    yield ipv4InCidr(address, cidr);
  },
};

export const authorizationNativeFilters = wrapBareNativeFilters(bareNativeFilters);
