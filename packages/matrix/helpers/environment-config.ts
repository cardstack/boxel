import { execSync } from 'child_process';
import { writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'yaml';

const DOMAIN = 'localhost';

let _traefikDir: string | undefined;
function traefikDynamicDir(): string {
  if (_traefikDir) {
    return _traefikDir;
  }
  try {
    let mounted = execSync(
      `docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}'`,
      { encoding: 'utf-8' },
    ).trim();
    if (mounted) {
      _traefikDir = mounted;
      return _traefikDir;
    }
  } catch {
    // Traefik not running — fall back to repo-relative path
  }
  _traefikDir = resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
  return _traefikDir;
}

export function isEnvironmentMode(): boolean {
  return !!process.env.BOXEL_ENVIRONMENT;
}

export function getEnvironmentSlug(): string {
  if (process.env.BOXEL_ENVIRONMENT) {
    return sanitizeSlug(process.env.BOXEL_ENVIRONMENT);
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
  if (isEnvironmentMode()) {
    return `boxel-synapse-${getEnvironmentSlug()}`;
  }
  return 'boxel-synapse';
}

export function getSynapseURL(synapse?: {
  baseUrl?: string;
  port?: number;
}): string {
  if (synapse?.baseUrl) {
    return synapse.baseUrl;
  }
  if (synapse?.port != null) {
    return `http://localhost:${synapse.port}`;
  }
  if (!isEnvironmentMode()) {
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
  let slug = getEnvironmentSlug();
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
  console.log(`Registered Synapse at ${hostname} -> localhost:${hostPort}`);
}

export function deregisterSynapseFromTraefik(): void {
  if (!isEnvironmentMode()) {
    return;
  }
  let slug = getEnvironmentSlug();
  let configPath = join(traefikDynamicDir(), `${slug}-matrix.yml`);
  try {
    unlinkSync(configPath);
    console.log(`Deregistered Synapse for environment ${slug} from Traefik`);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.error(
        `Failed to deregister Synapse for environment ${slug}: ${e.message}`,
      );
    }
  }
}

function atomicWrite(filePath: string, content: string): void {
  let tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}
