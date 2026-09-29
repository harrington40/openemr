#!/usr/bin/env node
/**
 * Minimal SQL runner for the test database.
 *
 * Jenkins agents cannot be assumed to have a `mysql` client installed, but they
 * always have Node (the pipeline builds a NestJS app), and the backend already
 * depends on `mysql2`. Resolving mysql2 from backend/node_modules means this
 * script needs no extra installation step and no host client at all.
 *
 * Usage:
 *   node run-sql.mjs (--host H --port P | --socket S) --user U [--password PW] \
 *        [--database DB] (--file FILE... | --execute SQL...) [--print] [--quiet]
 *
 * --socket matters for a distribution-packaged MariaDB: its `root` account is
 * often restricted to the local unix socket, so an administrative connection
 * over TCP fails with "Access denied" even though the server is running.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Resolve mysql2 relative to the backend, not relative to this file.
const requireFromBackend = createRequire(
    new URL('../backend/package.json', import.meta.url),
);
const mysql = requireFromBackend('mysql2/promise');

function parseArguments(argv) {
    const options = { files: [], statements: [], print: false, quiet: false };

    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        switch (flag) {
            case '--host':
                options.host = argv[++index];
                break;
            case '--socket':
                options.socketPath = argv[++index];
                break;
            case '--port':
                options.port = Number(argv[++index]);
                break;
            case '--user':
                options.user = argv[++index];
                break;
            case '--password':
                options.password = argv[++index];
                break;
            case '--database':
                options.database = argv[++index];
                break;
            case '--file':
                options.files.push(argv[++index]);
                break;
            case '--execute':
                options.statements.push(argv[++index]);
                break;
            case '--print':
                options.print = true;
                break;
            case '--quiet':
                options.quiet = true;
                break;
            default:
                throw new Error(`unknown argument: ${flag}`);
        }
    }

    if (!options.user) {
        throw new Error('--user is required');
    }

    if (!options.host && !options.socketPath) {
        throw new Error('either --host or --socket is required');
    }

    return options;
}

function printResult(rows) {
    if (!Array.isArray(rows)) {
        return;
    }

    for (const row of rows) {
        if (row && typeof row === 'object') {
            process.stdout.write(Object.values(row).join('\t') + '\n');
        } else {
            process.stdout.write(`${row}\n`);
        }
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));

    const connection = await mysql.createConnection({
        // socketPath and host are mutually exclusive in mysql2.
        ...(options.socketPath
            ? { socketPath: options.socketPath }
            : { host: options.host, port: options.port || 3306 }),
        user: options.user,
        password: options.password,
        database: options.database,
        charset: 'utf8mb4',
        // sql/database.sql is a whole schema in one file; it contains only
        // plain DROP/CREATE/INSERT statements, so no DELIMITER handling is
        // needed.
        multipleStatements: true,
    });

    try {
        for (const file of options.files) {
            const sql = readFileSync(file, 'utf8');
            const [rows] = await connection.query(sql);
            if (options.print) {
                printResult(rows);
            }
            if (!options.quiet) {
                console.log(`[run-sql] applied ${file}`);
            }
        }

        for (const sql of options.statements) {
            const [rows] = await connection.query(sql);
            if (options.print) {
                printResult(rows);
            }
        }
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error(`[run-sql] ${error.code ? error.code + ': ' : ''}${error.message}`);
    process.exit(1);
});
