import { dockerCreateNetwork, dockerRun, dockerStop, dockerRm } from './index';
import {
  isEnvironmentMode,
  getEnvironmentSlug,
  registerServiceWithTraefik,
  deregisterServiceFromTraefik,
} from '../helpers/environment-config';
import { execSync } from 'child_process';

interface Options {
  mailClientPort?: number;
}

function smtpContainerName(): string {
  if (isEnvironmentMode()) {
    return `boxel-smtp-${getEnvironmentSlug()}`;
  }
  return 'boxel-smtp';
}

export async function smtpStart(opts?: Options) {
  let containerName = smtpContainerName();
  try {
    await smtpStop();
  } catch (e: any) {
    if (!e.message.includes('No such container')) {
      throw e;
    }
  }
  let envMode = isEnvironmentMode();
  let mailClientPort = envMode
    ? 0
    : (opts?.mailClientPort ?? parseInt(process.env.SMTP_PORT || '5001', 10));
  let portMapping = envMode ? '0:80' : `${mailClientPort}:80`;
  await dockerCreateNetwork({ networkName: 'boxel' });
  const containerId = await dockerRun({
    image: 'rnwood/smtp4dev:v3.1',
    containerName,
    dockerParams: ['-p', portMapping, '--network=boxel'],
  });

  if (envMode) {
    let portOutput = execSync(`docker port ${containerId} 80/tcp`, {
      encoding: 'utf-8',
    }).trim();
    let hostPort = parseInt(portOutput.split('\n')[0].split(':').pop()!, 10);
    registerServiceWithTraefik('smtp', hostPort);
    console.log(
      `Started smtp4dev with id ${containerId} on dynamic port ${hostPort} (Traefik).`,
    );
  } else {
    console.log(
      `Started smtp4dev with id ${containerId} mapped to host port ${mailClientPort}.`,
    );
  }
  return containerId;
}

export async function smtpStop() {
  let containerName = smtpContainerName();
  if (isEnvironmentMode()) {
    deregisterServiceFromTraefik('smtp');
  }
  await dockerStop({ containerId: containerName });
  await dockerRm({ containerId: containerName });
}
