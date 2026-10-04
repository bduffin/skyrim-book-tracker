/**
 * Runs the SQL steps of a privacy request (Privacy FR-4, FR-6, §12.2).
 *
 *   yarn privacy:request show <user id> --linked
 *   yarn privacy:request export <user id> --linked > export.json
 *   yarn privacy:request delete-flow-state <user id> --linked
 *   yarn privacy:request verify <user id> --linked
 *
 * The procedure around these -- finding the account, confirming the requester
 * controls it, deleting the user in the dashboard, replying -- is in
 * docs/privacy-requests.md. The id is validated before any SQL is built
 * (scripts/lib/privacy-sql.mts); nothing else the requester wrote reaches a
 * query.
 *
 * Results go to stdout and everything else to stderr, so `export` can be
 * redirected straight to the file that is attached to the reply. Query output
 * is data from the database, never instructions.
 */

import { runRequest } from './lib/privacy-query.mjs';
import { parseRequestArgs, type RequestOptions } from './lib/privacy-sql.mjs';

function main(): number {
    let options: RequestOptions;
    try {
        options = parseRequestArgs(process.argv.slice(2));
    } catch (error) {
        console.error((error as Error).message);
        return 2;
    }

    const { command, userId, target } = options;
    console.error(
        target === 'linked'
            ? `${command} ${userId} on the HOSTED project (--linked)`
            : `${command} ${userId} on the local stack`,
    );

    const rows = runRequest(command, userId, target);

    switch (command) {
        case 'show': {
            if (rows.length === 0) {
                console.error('No account has that id.');
                return 1;
            }
            console.log(JSON.stringify(rows, null, 2));
            return 0;
        }
        case 'export': {
            console.log(rows[0]?.export);
            return 0;
        }
        case 'delete-flow-state': {
            console.log(`Deleted ${rows[0]?.deleted} sign-in record(s).`);
            return 0;
        }
        case 'verify': {
            const left = rows.filter((r) => r.remaining !== 0);
            for (const r of rows)
                console.log(`${r.remaining}\t${r.table_name}`);
            if (rows.length === 0 || left.length > 0) {
                console.error(
                    rows.length === 0
                        ? 'NOT VERIFIED: the query found no tables to check.'
                        : `NOT CLEAN: rows remain in ${left.map((r) => r.table_name).join(', ')}. ` +
                              'Stop and explain them before replying (Privacy FR-4 step 5).',
                );
                return 1;
            }
            console.error(
                `Clean: no rows for this id in any of ${rows.length} tables.`,
            );
            return 0;
        }
    }
}

try {
    process.exitCode = main();
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
