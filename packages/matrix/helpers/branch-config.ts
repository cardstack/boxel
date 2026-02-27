import { execSync } from 'child_process';
import {
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { join, resolve } from 'path';
import yaml from 'yaml';

const DOMAIN = 'localhost';

function traefikDynamicDir(): string {
  return resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
}

export function isBranchMode(): boolean {
  return !!process.env.BOXEL_BRANCH;
}

export function getBranchSlug(): string {
  if (process.env.BOXEL_BRANCH) {
    return sanitizeSlug(process.env.BOXEL_BRANCH);
  }
  try {
    let branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
    }).trim();
    return sanitizeSlug(branch);
  } catch {
    return 'default';
  }
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getSynapseContainerName(): string {
  if (isBranchMode()) {
    return `boxel-synapse-${getBranchSlug()}`;
  }
  return 'boxel-synapse';
}

export function getSynapseURL(): string {
  if (!isBranchMode()) {
    return 'http://localhost:8008';
  }
  let containerName = getSynapseContainerName();
  try {
    let output = execSync(`docker port ${containerName} 8008/tcp`, {
      encoding: 'utf-8',
    }).trim();
    // Output is like "0.0.0.0:55123" or "[::]:55123" — take the first line
    let firstLine = output.split('\n')[0];
    let port = firstLine.split(':').pop();
    return `http://localhost:${port}`;
  } catch {
    // Fallback if container isn't running yet
    return 'http://localhost:8008';
  }
}

export function registerSynapseWithTraefik(hostPort: number): void {
  let slug = getBranchSlug();
  let serviceName = 'matrix';
  let configPath = join(traefikDynamicDir(), `${slug}-${serviceName}.yml`);
  let routerKey = `${serviceName}-${slug}`;
  let hostname = `${serviceName}.${slug}.${DOMAIN}`;

  let config: any = {
    http: {
      routers: {
        [routerKey]: {
          rule: `Host(\`${hostname}\`)`,
          service: routerKey,
          entryPoints: ['web'],
        },
      },
      services: {
        [routerKey]: {
          loadBalancer: {
            servers: [{ url: `http://host.docker.internal:${hostPort}` }],
          },
        },
      },
    },
  };

  atomicWrite(configPath, yaml.stringify(config));
  console.log(
    `Registered Synapse at ${hostname} -> localhost:${hostPort}`,
  );
}

export function deregisterSynapseFromTraefik(): void {
  if (!isBranchMode()) {
    return;
  }
  let slug = getBranchSlug();
  let configPath = join(traefikDynamicDir(), `${slug}-matrix.yml`);
  try {
    unlinkSync(configPath);
    console.log(`Deregistered Synapse for branch ${slug} from Traefik`);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.error(
        `Failed to deregister Synapse for branch ${slug}: ${e.message}`,
      );
    }
  }
}

function atomicWrite(filePath: string, content: string): void {
  let tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}
