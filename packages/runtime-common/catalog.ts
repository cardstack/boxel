import { deburr } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { Spec } from 'https://cardstack.com/base/spec';
import { RealmPaths, join } from './paths';
import { ResolvedCodeRef } from './code-ref';
import { realmURL } from './constants';

export function guessSourceRealm(specs: Spec[]): string | undefined {
  let firstSpec = specs[0];
  if (!firstSpec) {
    throw new Error('There are no specs');
  }
  let url = firstSpec[realmURL];
  return url?.href ?? undefined;
}

export function toKebabCase(name: string) {
  return deburr(name.toLocaleLowerCase()).replace(/ /g, '-').replace(/'/g, '');
}
export function listingNameWithUuid(listingName?: string): string {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const name = toKebabCase(listingName);

  return `${name}-${uuidv4()}`;
}

interface InstallOpts {
  targetDirName?: string; //install into a directory with a name
  sourceDir?: string;
}

export interface CopyMeta {
  sourceCodeRef: ResolvedCodeRef;
  targetCodeRef: ResolvedCodeRef;
}

function checkModuleInSameDir(specs: Spec[], sourceDir: RealmPaths) {
  const allSpecsFromSameRealm = specs.every((spec: Spec) => {
    let url = new URL(spec.moduleHref);
    return sourceDir.inRealm(url);
  });
  if (!allSpecsFromSameRealm) {
    return false;
  }
  return true;
}

export function planInstall(
  targetRealm: string,
  specs: Spec[],
  opts: InstallOpts = {},
): CopyMeta[] {
  if (specs.length == 0) {
    throw new Error('There are no specs to install');
  }
  let sourceRealm = guessSourceRealm(specs);
  if (!sourceRealm) {
    throw new Error('Cannot derive realm from list of specs');
  }
  let sourceDirPath = new RealmPaths(new URL(sourceRealm));
  let moduleInSameRealm = checkModuleInSameDir(specs, sourceDirPath);
  if (!moduleInSameRealm) {
    throw new Error('Modules are not in the same realm');
  }
  if (opts.sourceDir) {
    let optsSourceDirPath = new RealmPaths(new URL(opts.sourceDir));
    let moduleInSameDir = checkModuleInSameDir(specs, optsSourceDirPath);
    if (moduleInSameDir) {
      sourceDirPath = optsSourceDirPath;
    }
  }

  let targetRealmPath = new RealmPaths(new URL(targetRealm));
  return specs.map((spec) => {
    let localPath = sourceDirPath.local(new URL(spec.moduleHref));
    let targetModule =
      targetRealmPath.url + join(opts.targetDirName ?? '', localPath + '.gts'); //we assume .gts extension for now

    return {
      sourceCodeRef: {
        name: spec.ref.name,
        module: spec.moduleHref, //its annoying that this doesn't have an extension
      },
      targetCodeRef: {
        name: spec.ref.name,
        module: targetModule,
      },
    };
  });
}
