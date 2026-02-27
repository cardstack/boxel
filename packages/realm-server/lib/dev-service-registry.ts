import { execSync } from 'child_process';
import {
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { logger } from '@cardstack/runtime-common';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import yaml from 'yaml';

const log = logger('dev-service-registry');

const DOMAIN = 'lvh.me';

// Resolve traefik/dynamic dir relative to repo root
function traefikDynamicDir(): string {
  // Walk up from packages/realm-server to repo root
  return resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
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

export function serviceHostname(
  serviceName: string,
  branch?: string,
): string {
  let slug = branch ?? getBranchSlug();
  return `${serviceName}.${slug}.${DOMAIN}`;
}

export function serviceURL(serviceName: string, branch?: string): string {
  return `http://${serviceHostname(serviceName, branch)}`;
}

export function isBranchMode(): boolean {
  return !!process.env.BOXEL_BRANCH;
}

/**
 * Register a running HTTP server with Traefik by writing a per-service
 * dynamic YAML config file: `traefik/dynamic/<slug>-<service>.yml`.
 *
 * Each service gets its own file so services can register/deregister
 * independently without interfering with each other.
 */
export function registerService(
  server: Server,
  serviceName: string,
  branch?: string,
): void {
  let slug = branch ?? getBranchSlug();
  let addr = server.address() as AddressInfo;
  if (!addr || typeof addr === 'string') {
    log.error(
      `Cannot register service ${serviceName}: server not bound to a port`,
    );
    return;
  }
  let actualPort = addr.port;
  log.info(
    `Registering service ${serviceName} (port ${actualPort}) for branch ${slug}`,
  );

  let configPath = join(traefikDynamicDir(), `${slug}-${serviceName}.yml`);
  let routerKey = `${serviceName}-${slug}`;
  let hostname = serviceHostname(serviceName, slug);

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
            servers: [{ url: `http://host.docker.internal:${actualPort}` }],
          },
        },
      },
    },
  };

  atomicWrite(configPath, yaml.stringify(config));
  log.info(
    `Registered ${serviceName} at ${hostname} -> localhost:${actualPort}`,
  );
}

/**
 * Remove a single service's Traefik config file on shutdown.
 */
export function deregisterService(
  serviceName: string,
  branch?: string,
): void {
  let slug = branch ?? getBranchSlug();
  let configPath = join(traefikDynamicDir(), `${slug}-${serviceName}.yml`);
  try {
    unlinkSync(configPath);
    log.info(`Deregistered ${serviceName} for branch ${slug} from Traefik`);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      log.error(
        `Failed to deregister ${serviceName} for branch ${slug}: ${e.message}`,
      );
    }
  }
}

/**
 * Remove all Traefik dynamic config files for a branch on full shutdown.
 */
export function deregisterBranch(branch?: string): void {
  let slug = branch ?? getBranchSlug();
  let dir = traefikDynamicDir();
  let prefix = `${slug}-`;
  try {
    let files = readdirSync(dir);
    let removed = 0;
    for (let file of files) {
      if (file.startsWith(prefix) && file.endsWith('.yml')) {
        try {
          unlinkSync(join(dir, file));
          removed++;
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
            log.error(`Failed to remove ${file}: ${e.message}`);
          }
        }
      }
    }
    if (removed > 0) {
      log.info(
        `Deregistered branch ${slug} from Traefik (${removed} service(s))`,
      );
    }
  } catch (e: any) {
    log.error(`Failed to deregister branch ${slug}: ${e.message}`);
  }
}

function atomicWrite(filePath: string, content: string): void {
  let tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}
