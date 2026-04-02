#!/usr/bin/env python3
"""Script to upgrade Boxel monorepo from Glint v1 to Glint v2."""

import json
import os
import sys

BASE = '/root/.openclaw/workspace/boxel'

def read_json(path):
    with open(path) as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

def update_package_json(path, ops):
    """Apply a series of operations to a package.json."""
    full_path = os.path.join(BASE, path)
    if not os.path.exists(full_path):
        print(f"  SKIP (not found): {path}")
        return
    data = read_json(full_path)
    changed = False

    for op, section, key, value in ops:
        if section not in data:
            if op == 'add':
                data[section] = {}
            else:
                continue

        if op == 'add':
            if data[section].get(key) != value:
                data[section][key] = value
                changed = True
                print(f"  + {section}.{key} = {value}")
        elif op == 'remove':
            if key in data[section]:
                del data[section][key]
                changed = True
                print(f"  - {section}.{key}")
        elif op == 'update':
            if key in data[section] and data[section][key] != value:
                old = data[section][key]
                data[section][key] = value
                changed = True
                print(f"  ~ {section}.{key}: {old} -> {value}")
        elif op == 'update_script':
            # value is (old_cmd, new_cmd)
            old_cmd, new_cmd = value
            if key in data[section] and data[section][key] == old_cmd:
                data[section][key] = new_cmd
                changed = True
                print(f"  ~ scripts.{key}: '{old_cmd}' -> '{new_cmd}'")

    if changed:
        write_json(full_path, data)
        print(f"  SAVED: {path}")
    else:
        print(f"  (no changes): {path}")

def remove_glint_from_tsconfig(path):
    """Remove the 'glint' key from a tsconfig.json."""
    full_path = os.path.join(BASE, path)
    if not os.path.exists(full_path):
        print(f"  SKIP (not found): {path}")
        return
    data = read_json(full_path)
    if 'glint' in data:
        del data['glint']
        write_json(full_path, data)
        print(f"  SAVED (removed glint): {path}")
    else:
        print(f"  (no glint key): {path}")


# ==================== PACKAGE.JSON CHANGES ====================

# Packages that have @glint/core (need @glint/ember-tsc added)
PACKAGES_WITH_GLINT_CORE = [
    'package.json',  # root
    'packages/boxel-ui/test-app/package.json',
    'packages/host/package.json',
    'packages/runtime-common/package.json',
    'packages/software-factory/package.json',
    'packages/vscode-boxel-tools/package.json',
]

# Also add @glint/ember-tsc to packages that have glint scripts but no @glint/core
# (they need the ember-tsc binary available locally)
PACKAGES_WITH_GLINT_SCRIPTS_ONLY = [
    'packages/boxel-icons/package.json',
    'packages/boxel-ui/addon/package.json',
    # ai-bot, billing, bot-runner, matrix, postgres, realm-server will get ember-tsc from root
]

ALL_PACKAGES_NEEDING_EMBER_TSC = PACKAGES_WITH_GLINT_CORE + PACKAGES_WITH_GLINT_SCRIPTS_ONLY

# All packages with @glint/template in any section
PACKAGES_WITH_TEMPLATE = [
    ('packages/boxel-ui/test-app/package.json', 'devDependencies'),
    ('packages/host/package.json', 'devDependencies'),
    ('packages/runtime-common/package.json', 'dependencies'),
    ('packages/software-factory/package.json', 'devDependencies'),
    ('packages/vscode-boxel-tools/package.json', 'devDependencies'),
    ('packages/boxel-icons/package.json', 'dependencies'),
    ('packages/boxel-ui/addon/package.json', 'dependencies'),
    ('packages/base/package.json', 'devDependencies'),
    ('packages/local-types/package.json', 'devDependencies'),
]

print("=== Step 1 & 4: Add @glint/ember-tsc and remove @glint/core in package.json files ===")
for pkg_path in PACKAGES_WITH_GLINT_CORE:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('add', 'devDependencies', '@glint/ember-tsc', '1.5.0'),
        ('remove', 'devDependencies', '@glint/core', None),
        ('remove', 'devDependencies', '@glint/environment-ember-loose', None),
        ('remove', 'devDependencies', '@glint/environment-ember-template-imports', None),
    ])

print("\n=== Add @glint/ember-tsc to packages with glint scripts ===")
for pkg_path in PACKAGES_WITH_GLINT_SCRIPTS_ONLY:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('add', 'devDependencies', '@glint/ember-tsc', '1.5.0'),
        # Also remove peerDependencies on environment-ember-loose
        ('remove', 'peerDependencies', '@glint/environment-ember-loose', None),
    ])

print("\n=== Step 2: Upgrade @glint/template to 1.7.7 ===")
for pkg_path, section in PACKAGES_WITH_TEMPLATE:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('update', section, '@glint/template', '1.7.7'),
    ])

print("\n=== Step 6: Update glint scripts to ember-tsc ===")

# lint:glint: glint → ember-tsc --noEmit
LINT_GLINT_PACKAGES = [
    'packages/ai-bot/package.json',
    'packages/billing/package.json',
    'packages/boxel-ui/test-app/package.json',
    'packages/host/package.json',
    'packages/postgres/package.json',
    'packages/realm-server/package.json',
    'packages/software-factory/package.json',
    'packages/vscode-boxel-tools/package.json',
    'packages/boxel-icons/package.json',
    'packages/boxel-ui/addon/package.json',
]

for pkg_path in LINT_GLINT_PACKAGES:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('update_script', 'scripts', 'lint:glint', ('glint', 'ember-tsc --noEmit')),
    ])

# lint: glint → ember-tsc --noEmit (bot-runner, matrix)
print(f"\npackages/bot-runner/package.json:")
update_package_json('packages/bot-runner/package.json', [
    ('update_script', 'scripts', 'lint', ('glint', 'ember-tsc --noEmit')),
])

print(f"\npackages/matrix/package.json:")
update_package_json('packages/matrix/package.json', [
    ('update_script', 'scripts', 'lint', ('glint', 'ember-tsc --noEmit')),
])

# lint:types: glint → ember-tsc --noEmit (runtime-common, boxel-icons, boxel-ui/addon)
for pkg_path in ['packages/runtime-common/package.json', 'packages/boxel-icons/package.json', 'packages/boxel-ui/addon/package.json']:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('update_script', 'scripts', 'lint:types', ('glint', 'ember-tsc --noEmit')),
    ])

# build:types and start:types (boxel-icons, boxel-ui/addon)
for pkg_path in ['packages/boxel-icons/package.json', 'packages/boxel-ui/addon/package.json']:
    print(f"\n{pkg_path}:")
    update_package_json(pkg_path, [
        ('update_script', 'scripts', 'build:types', ('glint --declaration', 'ember-tsc --declaration --emitDeclarationOnly')),
        ('update_script', 'scripts', 'start:types', ('glint --declaration --watch', 'ember-tsc --declaration --emitDeclarationOnly --watch')),
    ])

print("\n=== DONE: Package.json changes complete ===")
