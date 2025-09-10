const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

function calculateBoxelUIChecksum(baseDir) {
  const boxelUIDistPath = path.resolve(baseDir, '../boxel-ui/addon/dist');

  if (!fs.existsSync(boxelUIDistPath)) {
    console.warn(
      '⚠️  Boxel-UI dist directory not found. Run "pnpm build" in packages/boxel-ui/addon first.',
    );
    return null;
  }

  const getAllFiles = (dirPath, arrayOfFiles = []) => {
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      } else {
        // Skip source maps for cleaner checksum
        if (!file.endsWith('.map')) {
          arrayOfFiles.push(fullPath);
        }
      }
    });

    return arrayOfFiles;
  };

  const allFiles = getAllFiles(boxelUIDistPath);
  allFiles.sort();

  const hash = crypto.createHash('sha256');
  const includedFiles = [];

  allFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath);
    const relativePath = path.relative(boxelUIDistPath, filePath);
    hash.update(
      relativePath +
        ':' +
        crypto.createHash('sha256').update(content).digest('hex'),
    );
    includedFiles.push(relativePath);
  });

  return hash.digest('hex');
}

// Webpack plugin to write boxel-ui checksum after build
class BoxelUIChecksumPlugin {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  apply(compiler) {
    // Store the checksum data during compilation
    let checksum = null;

    compiler.hooks.compile.tap('BoxelUIChecksumPlugin', () => {
      checksum = calculateBoxelUIChecksum(this.baseDir);
    });

    // Write it as an asset so it gets included in the final output
    compiler.hooks.thisCompilation.tap(
      'BoxelUIChecksumPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BoxelUIChecksumPlugin',
            stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            if (checksum) {
              compilation.emitAsset(
                'boxel-ui-checksum.txt',
                new webpack.sources.RawSource(checksum),
              );
            }
          },
        );
      },
    );
  }
}

module.exports = {
  calculateBoxelUIChecksum,
  BoxelUIChecksumPlugin,
};
