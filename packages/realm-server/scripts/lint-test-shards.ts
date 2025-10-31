import { readFileSync } from 'fs-extra';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { join } from 'path';

const YAML_FILE = join(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'ci.yaml',
);
const TEST_DIR = join(__dirname, '..', 'tests');

function getCiTestModules(yamlFilePath: string) {
  try {
    const yamlContent = readFileSync(yamlFilePath, 'utf8');
    const yamlData = yaml.load(yamlContent) as Record<string, any>;

    const shardIndexes: string[] =
      yamlData?.jobs?.['realm-server-test']?.strategy?.matrix?.testModule;

    if (!Array.isArray(shardIndexes)) {
      throw new Error(
        `Invalid 'jobs.realm-server-test.strategy.matrix.testModule' format in the YAML file.`,
      );
    }

    return shardIndexes;
  } catch (error: any) {
    console.error(`Error reading shardIndex from YAML file: ${error.message}`);
    process.exit(1);
  }
}

function getFilesystemTestModules(testDir: string) {
  try {
    const files = glob.sync(`${testDir}/**/*-test.ts`, { nodir: true });
    return files.map((file: string) => file.replace(`${testDir}/`, ''));
  } catch (error: any) {
    console.error(
      `Error reading test files from dir ${testDir}: ${error.message}`,
    );
    process.exit(1);
  }
}

function validateTestFiles(yamlFilePath: string, testDir: string) {
  const ciTestModules = getCiTestModules(yamlFilePath);
  const filesystemTestModules = getFilesystemTestModules(testDir);

  let errorFound = false;

  for (let filename of filesystemTestModules) {
    if (!ciTestModules.includes(filename)) {
      console.error(
        `Error: Test file '${filename}' exists in the filesystem but not in the ${yamlFilePath} file.`,
      );
      errorFound = true;
    }
  }
  for (let filename of ciTestModules) {
    if (!filesystemTestModules.includes(filename)) {
      console.error(
        `Error: Test file '${filename}' exists in the YAML file but not in the filesystem.`,
      );
      errorFound = true;
    }
  }

  if (errorFound) {
    process.exit(1);
  } else {
    console.log(
      `All test files are accounted for in the ${yamlFilePath} file for the realm-server matrix strategy.`,
    );
  }
}

validateTestFiles(YAML_FILE, TEST_DIR);
