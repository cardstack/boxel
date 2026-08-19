import {
  dockerCreateNetwork,
  dockerRun,
  dockerStop,
  dockerRm,
} from '../support/docker.ts';

interface Options {
  mailClientPort?: number;
}

export async function smtpStart(opts?: Options) {
  try {
    await smtpStop();
  } catch (e: any) {
    if (!e.message.includes('No such container')) {
      throw e;
    }
  }
  let mailClientPort = opts?.mailClientPort ?? 5001;
  let portMapping = `${mailClientPort}:80`;
  await dockerCreateNetwork({ networkName: 'boxel' });
  const containerId = await dockerRun({
    // If you bump this version, also update the GHCR mirror so CI keeps caching
    // it (it must match the version pinned there):
    // .github/workflows/mirror-test-images.yml and
    // .github/actions/warm-test-images/action.yml.
    image: 'rnwood/smtp4dev:v3.1',
    containerName: 'boxel-smtp',
    dockerParams: ['-p', portMapping, '--network=boxel'],
  });

  console.log(
    `Started smtp4dev with id ${containerId} mapped to host port ${mailClientPort}.`,
  );
  return containerId;
}

export async function smtpStop() {
  await dockerStop({ containerId: 'boxel-smtp' });
  await dockerRm({ containerId: 'boxel-smtp' });
}
