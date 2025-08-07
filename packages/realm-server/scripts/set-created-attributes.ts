#!/usr/bin/env ts-node

import { readdirSync, statSync } from 'fs-extra';
import { join } from 'path';
import { getAttributeSync, setAttributeSync } from 'fs-xattr';

function setCreatedAttributesRecursive(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      setCreatedAttributesRecursive(fullPath);
    } else if (entry.isFile()) {
      try {
        // Check if the file already has the user.created attribute
        getAttributeSync(fullPath, 'user.created');
        // If we get here, attribute exists, skip
      } catch (e) {
        // Attribute doesn't exist, set it to current time
        const currentTime = Math.floor(Date.now() / 1000);
        try {
          setAttributeSync(fullPath, 'user.created', currentTime.toString());
          console.log(`Set created attribute on: ${fullPath}`);
        } catch (err) {
          console.warn(`Warning: Could not set extended attribute on ${fullPath}:`, err);
        }
      }
    }
  }
}

// Get destination directory from command line argument
const destDir = process.argv[2];

if (!destDir) {
  console.error('Usage: ts-node set-created-attributes.ts <destination-directory>');
  process.exit(1);
}

console.log('Setting created attributes on new files...');
setCreatedAttributesRecursive(destDir);
console.log('Finished setting created attributes');