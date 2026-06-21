import { execSync, spawn } from 'child_process';
import { writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import yaml from 'yaml';

import { sanitizeSlug } from '../../../scripts/env-slug.js';

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
  _traefikDir = resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'traefik',
    'dynamic',
  );
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

  // Mirror dev-service-registry.ts: two routers per service. `websecure`
  // (port 443) terminates TLS at Traefik using the mkcert leaf in
  // traefik/dynamic/tls.yml; the sibling `-http` router on :80
  // 308-redirects to https. The browser hits the host bundle over https,
  // so matrix login fetches (`https://matrix.<slug>.localhost/`) need
  // the websecure router or every CORS preflight 404s.
  let redirectMiddleware = `${routerKey}-https-redirect`;
  let config: any = {
    http: {
      routers: {
        [routerKey]: {
          rule: `Host(\`${hostname}\`)`,
          service: routerKey,
          entryPoints: ['websecure'],
          tls: {},
        },
        [`${routerKey}-http`]: {
          rule: `Host(\`${hostname}\`)`,
          entryPoints: ['web'],
          middlewares: [redirectMiddleware],
          service: routerKey,
        },
      },
      middlewares: {
        [redirectMiddleware]: {
          redirectScheme: {
            scheme: 'https',
            permanent: true,
          },
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
  kickTraefikIfNeeded();
}

// Bounce Traefik on macOS after a config write — Docker Desktop's bind
// mounts don't propagate inotify, and Traefik v3 file provider has no
// polling option. See dev-service-registry.ts for the full rationale.
function kickTraefikIfNeeded(): void {
  if (process.platform !== 'darwin') return;
  let child = spawn('docker', ['restart', 'boxel-traefik'], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => {
    // Docker not running or container missing — readiness probes
    // through Traefik will surface the underlying problem.
  });
  child.unref();
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
