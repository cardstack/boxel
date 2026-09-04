import { expect, test } from '@playwright/test';
import {
  abandonedContainerIds,
  abandonedSynapseQuery,
  formatHostPortConflict,
  synapseDockerParams,
} from '../support/synapse/index.ts';

test.describe('Synapse container networking', () => {
  test('joins the shared network without requesting an address on it', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      ownerPid: 4242,
      hostPort: 8008,
    });

    expect(params).toContain('--network=boxel');
    // Docker allocates addresses on a network in the order containers join it,
    // so a container that asks for a specific one starts only while every
    // lower address happens to be free. Nothing reaches Synapse by address —
    // the host uses the published port, peers on the network use its container
    // name — so nothing may ask for one.
    expect(params.filter((p) => p.startsWith('--ip'))).toEqual([]);
  });

  test('publishes the requested host port', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      ownerPid: 4242,
      hostPort: 34567,
    });

    expect(params).toContain('34567:8008/tcp');
    expect(params[params.indexOf('34567:8008/tcp') - 1]).toBe('-p');
  });

  test('mounts the config dir and keeps the default container user', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      ownerPid: 4242,
      hostPort: 8008,
    });

    expect(params).toContain('/tmp/sf-test-synapse-abc123:/data');
    expect(params).not.toContain('UID=0');
  });

  test('stays root in the container when the host runs as root', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      ownerPid: 4242,
      hostPort: 8008,
      runAsRoot: true,
    });

    expect(params).toContain('UID=0');
    expect(params).toContain('GID=0');
  });

  test('labels each container with the process that started it', () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      ownerPid: 4242,
      hostPort: 8008,
    });

    // Debris and a live tenant are indistinguishable from the outside — both
    // are running, healthy, and named alike — so the owning process is what a
    // later run reads to tell them apart.
    expect(params).toContain('boxel.synapse-owner-pid=4242');
  });

  test('the sweep asks only about this harness own containers', () => {
    const query = abandonedSynapseQuery();

    expect(query).toContain('name=sf-test-synapse-');
    expect(query).toContain('label=boxel.synapse-owner-pid');
  });

  test('sweeps containers whose owner has exited', () => {
    const ids = abandonedContainerIds(
      'aaa111 4242\nbbb222 9999',
      (pid) => pid === 9999,
    );

    expect(ids).toEqual(['aaa111']);
  });

  test('spares a container whose owning run is still going', () => {
    // The case that matters most: a suite mid-run looks exactly like debris,
    // and removing it kills someone's test run rather than costing them a
    // legible error.
    const ids = abandonedContainerIds('aaa111 4242', () => true);

    expect(ids).toEqual([]);
  });

  test('spares a container whose owner cannot be read', () => {
    const ids = abandonedContainerIds(
      'aaa111 not-a-pid\nbbb222 -1\nccc333',
      () => false,
    );

    expect(ids).toEqual([]);
  });

  test('reads no containers out of an unavailable listing', () => {
    expect(abandonedContainerIds(undefined, () => false)).toEqual([]);
    expect(abandonedContainerIds('', () => false)).toEqual([]);
  });

  test('a bind conflict names the port and the containers holding it', () => {
    const message = formatHostPortConflict(
      8008,
      'boxel-synapse (matrixdotorg/synapse:v1.126.0)\nother (alpine:3)',
    );

    expect(message).toContain('8008');
    expect(message).toContain('boxel-synapse (matrixdotorg/synapse:v1.126.0)');
    expect(message).toContain('other (alpine:3)');
  });

  test('a bind conflict no container explains points at a host process', () => {
    const message = formatHostPortConflict(8008, '');

    expect(message).toContain('8008');
    expect(message).toContain('a process on this host');
  });

  test('a bind conflict Docker could not be asked about says so', () => {
    // An unavailable daemon and a port no container publishes are different
    // answers. Reporting the first as the second sends a reader looking for a
    // host process that does not exist.
    const message = formatHostPortConflict(8008, undefined);

    expect(message).toContain('8008');
    expect(message).toContain('Docker could not be asked');
    expect(message).not.toContain('a process on this host');
  });
});
