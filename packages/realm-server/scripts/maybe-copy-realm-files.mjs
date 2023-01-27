
import fs from 'fs';
import { execSync } from 'child_process';

function execute(command, options = {}) {
  return execSync(command, options).toString().trim();
}

function main() {
  const [fromDir, toDir] = process.argv.slice(2);

  if (!fs.existsSync(toDir)) {
    console.log(`-> Creating ${toDir}…`);
    fs.mkdirSync(toDir);
  } else {
    console.log(`-> Checking if ${toDir} is empty…`);
  }

  if (fs.readdirSync(toDir).length === 0) {
    console.log(`-> Copying contents of ${fromDir}…`);
    execute(`cp -R ${fromDir} ${toDir}`);
  } else {
    console.log(`-> Not empty, doing nothing`);
  }
}

try {
  main();
} catch (err) {
  console.error(err);
}
