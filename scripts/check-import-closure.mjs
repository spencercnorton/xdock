import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] ?? '.');
const modules = [];

async function collect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        if (entry.name === '.git' || entry.name === '_build' || entry.name === 'debian' ||
            entry.name === 'node_modules' || entry.name === '.npm')
            continue;

        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory())
            await collect(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.js'))
            modules.push(entryPath);
    }
}

await collect(root);

const errors = [];
const relativeImport = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/g;

for (const modulePath of modules) {
    const source = await readFile(modulePath, 'utf8');
    for (const match of source.matchAll(relativeImport)) {
        const specifier = match[2];
        const target = path.resolve(path.dirname(modulePath), specifier);
        const relativeTarget = path.relative(root, target);

        if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeTarget)) {
            errors.push(`${path.relative(root, modulePath)} imports outside the package: ${specifier}`);
            continue;
        }

        try {
            const targetStat = await stat(target);
            if (!targetStat.isFile())
                errors.push(`${path.relative(root, modulePath)} imports a non-file: ${specifier}`);
        } catch {
            errors.push(`${path.relative(root, modulePath)} has missing import: ${specifier}`);
        }
    }
}

if (errors.length) {
    for (const error of errors)
        console.error(error);
    process.exitCode = 1;
}
