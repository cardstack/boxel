import { strictEqual } from 'node:assert';
import {
  prepareAuthorizationGraphSafe,
  type AuthorizationGraphModel,
} from '../../src/authorization/index.js';
import { ipv4InCidr } from '../../src/bxl/bridge/authorization-native.js';

strictEqual(ipv4InCidr('192.168.0.1', '192.168.0.0/24'), true);
strictEqual(ipv4InCidr('192.168.1.1', '192.168.0.0/24'), false);
strictEqual(ipv4InCidr('10.0.0.1', '0.0.0.0/0'), true);
strictEqual(ipv4InCidr('not-an-ip', '192.168.0.0/24'), false);

const model: AuthorizationGraphModel = {
  schema: 'bxl-authorization-ir/1',
  conditions: {
    below_limit: {
      expression: '.context.x < .context.limit',
      parameters: { x: 'int', limit: 'int' },
    },
    on_network: {
      expression: 'ip_in_cidr(.context.address; .context.cidr)',
      parameters: { address: 'ipaddress', cidr: 'string' },
    },
  },
  types: {
    user: {},
    document: {
      relations: {
        viewer: {
          subjects: [{ type: 'user', condition: 'below_limit' }],
        },
        network_viewer: {
          subjects: [{ type: 'user', condition: 'on_network' }],
        },
      },
    },
  },
};

const prepared = prepareAuthorizationGraphSafe(model, [
  {
    subject: 'user:alice',
    relation: 'viewer',
    object: 'document:1',
    condition: { name: 'below_limit', context: { limit: 100 } },
  },
  {
    subject: 'user:alice',
    relation: 'network_viewer',
    object: 'document:1',
    condition: { name: 'on_network', context: { cidr: '192.168.0.0/24' } },
  },
]);
strictEqual(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.error.message);

const allowed = prepared.value.check({
  subject: 'user:alice',
  relation: 'viewer',
  object: 'document:1',
  context: { x: 10, limit: 5 },
});
strictEqual(allowed.ok, true);
if (allowed.ok) {
  strictEqual(
    allowed.value.allowed,
    true,
    'tuple-bound context overrides request context for overlapping keys',
  );
}

const denied = prepared.value.check({
  subject: 'user:alice',
  relation: 'viewer',
  object: 'document:1',
  context: { x: 101 },
});
strictEqual(denied.ok, true);
if (denied.ok) strictEqual(denied.value.allowed, false);

const missing = prepared.value.check({
  subject: 'user:alice',
  relation: 'viewer',
  object: 'document:1',
});
strictEqual(missing.ok, false);

const network = prepared.value.check({
  subject: 'user:alice',
  relation: 'network_viewer',
  object: 'document:1',
  context: { address: '192.168.0.42' },
});
strictEqual(network.ok, true);
if (network.ok) strictEqual(network.value.allowed, true);

const invalidFacet = prepareAuthorizationGraphSafe(model, [
  {
    subject: 'user:alice',
    relation: 'viewer',
    object: 'document:1',
  },
]);
strictEqual(invalidFacet.ok, false, 'conditioned type restrictions reject unconditioned tuples');

console.log('Authorization conditions: BXL predicates, typed context, facets, and IPv4 CIDR passed');
