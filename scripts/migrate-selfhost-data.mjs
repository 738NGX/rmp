#!/usr/bin/env node
/** Explicitly migrate legacy self-hosted save indexes to the grouped-save format. */
import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const configPath = resolve(rootDir, 'rmp-selfhost.config.json');
const apply = process.argv.includes('--apply');

let config;
try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
    console.error(`Unable to read ${configPath}.`);
    console.error(error);
    process.exit(1);
}

const dataDir = resolve(rootDir, config.dataDir ?? 'rmp-data');
if (dataDir === rootDir || dataDir === resolve(dataDir, '..')) {
    console.error('The configured data directory must not be the project directory or a filesystem root.');
    process.exit(1);
}
const indexPath = resolve(dataDir, 'index.json');
const isValidId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);

let index;
try {
    index = JSON.parse(await readFile(indexPath, 'utf8'));
} catch (error) {
    console.error(`Unable to read ${indexPath}.`);
    console.error(error);
    process.exit(1);
}

if (!Array.isArray(index.saves)) {
    console.error('Legacy index is invalid: "saves" must be an array. No changes were made.');
    process.exit(1);
}

const problems = [];
for (const save of index.saves) {
    if (!isValidId(save?.id)) {
        problems.push(`Invalid save id: ${String(save?.id)}`);
        continue;
    }
    try {
        await access(resolve(dataDir, `${save.id}.json`));
    } catch {
        problems.push(`Missing save content file: ${save.id}.json`);
    }
}

if (problems.length) {
    console.error('Migration was not started because validation failed:');
    problems.forEach(problem => console.error(`- ${problem}`));
    process.exit(1);
}

if (index.version === 2 && Array.isArray(index.groups)) {
    console.log('The save index is already in the grouped-save format. No changes were made.');
    process.exit(0);
}

const migrated = {
    version: 2,
    saves: index.saves.map(save => ({ ...save, ...(save.groupId ? { groupId: save.groupId } : {}) })),
    groups: [],
};
console.log(`Validated ${migrated.saves.length} legacy save(s). All will be placed in “Ungrouped”.`);
if (!apply) {
    console.log('Dry run only. Stop the server, then run: npm run selfhost:migrate -- --apply');
    process.exit(0);
}

const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
const backupPath = resolve(dataDir, `index.legacy-${timestamp}.json`);
const temporaryPath = `${indexPath}.${timestamp}.tmp`;
await copyFile(indexPath, backupPath);
await writeFile(temporaryPath, JSON.stringify(migrated), 'utf8');
await rename(temporaryPath, indexPath);
console.log(`Migration complete. Backup written to ${backupPath}.`);
