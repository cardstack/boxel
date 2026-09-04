import { expect, test } from '@playwright/test';
import {
  describeHostPortConflict,
  synapseDockerParams,
} from '../support/synapse/index.ts';

test.describe('Synapse container networking', () => {
  test('joins the shared network without requesting an address on it', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
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
      hostPort: 34567,
    });

    expect(params).toContain('34567:8008/tcp');
    expect(params[params.indexOf('34567:8008/tcp') - 1]).toBe('-p');
  });

  test('mounts the config dir and keeps the default container user', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      hostPort: 8008,
    });

    expect(params).toContain('/tmp/sf-test-synapse-abc123:/data');
    expect(params).not.toContain('UID=0');
  });

  test('stays root in the container when the host runs as root', async () => {
    const params = synapseDockerParams({
      configDir: '/tmp/sf-test-synapse-abc123',
      hostPort: 8008,
      runAsRoot: true,
    });

    expect(params).toContain('UID=0');
    expect(params).toContain('GID=0');
  });

  test('names the port in a bind conflict rather than leaving it unstated', async () => {
    // The port no container publishes is the case a reader is most likely to
    // misread as a Docker-internal problem, so the message has to be explicit
    // that a host process holds it.
    const message = await describeHostPortConflict(8008);

    expect(message).toContain('8008');
  });
});
