import * as path from 'path';
import { loadConfig, saveConfig, initConfig, addRealm, removeRealm, getConfigPath, formatRealmSummary, generateLLMGuidance, } from '../lib/realm-config.js';
export async function realmsCommand(options) {
    // Initialize config if requested
    if (options.init) {
        const configPath = getConfigPath();
        initConfig();
        console.log(`Created ${configPath}`);
        return;
    }
    // Load existing config
    let config = loadConfig();
    // Add realm
    if (options.add) {
        if (!config) {
            config = initConfig();
            console.log('Created .boxel-workspaces.json');
        }
        const realmPath = options.add;
        const realm = {
            path: realmPath,
            name: path.basename(realmPath),
        };
        if (options.purpose) {
            realm.purpose = options.purpose;
        }
        if (options.patterns) {
            realm.patterns = options.patterns.split(',').map(p => p.trim());
        }
        if (options.cardTypes) {
            realm.cardTypes = options.cardTypes.split(',').map(t => t.trim());
        }
        if (options.notes) {
            realm.notes = options.notes;
        }
        config = addRealm(config, realm);
        if (options.default) {
            config.defaultRealm = realmPath;
        }
        saveConfig(config);
        console.log(`Added realm: ${realm.name} (${realmPath})`);
        return;
    }
    // Remove realm
    if (options.remove) {
        if (!config) {
            console.error('No .boxel-workspaces.json found');
            process.exit(1);
        }
        config = removeRealm(config, options.remove);
        if (config.defaultRealm === options.remove) {
            config.defaultRealm = undefined;
        }
        saveConfig(config);
        console.log(`Removed realm: ${options.remove}`);
        return;
    }
    // Show config
    if (!config) {
        console.log('No .boxel-workspaces.json found.');
        console.log('Run `boxel realms --init` to create one, or `boxel realms --add <path>` to add a realm.');
        return;
    }
    // LLM guidance output
    if (options.llm) {
        console.log(generateLLMGuidance(config));
        return;
    }
    // Default: show summary
    console.log('Configured Realms:');
    console.log(formatRealmSummary(config));
}
export async function updateRealmConfig(realmPath, updates) {
    let config = loadConfig();
    if (!config) {
        config = initConfig();
    }
    const existingIndex = config.realms.findIndex(r => r.path === realmPath);
    if (existingIndex >= 0) {
        config.realms[existingIndex] = {
            ...config.realms[existingIndex],
            ...updates,
        };
    }
    else {
        config.realms.push({
            path: realmPath,
            name: path.basename(realmPath),
            ...updates,
        });
    }
    saveConfig(config);
}
//# sourceMappingURL=realms.js.map