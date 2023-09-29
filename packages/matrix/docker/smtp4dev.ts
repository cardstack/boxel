import { dockerCreateNetwork, dockerRun, dockerStop, dockerRm } from './index';

interface Options {
  mailClientPort?: number;
}

export async function smtpStart(opts?: Options) {
  let mailClientPort = opts?.mailClientPort ?? 5001;
  let portMapping = `${mailClientPort}:80`;
  await dockerCreateNetwork({ networkName: 'boxel' });
  const containerId = await dockerRun({
    image: 'rnwood/smtp4dev',
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
