/**
 * Runs a privacy-request statement through `supabase db query` (Privacy
 * §12.2). Separate from the entry point so the database test drives the same
 * path the procedure does, without importing a script that runs on import.
 */

import { execFileSync } from 'node:child_process';

import {
    buildStatement,
    rowsFrom,
    type Command,
    type Row,
    type Target,
} from './privacy-sql.mjs';

export function runRequest(
    command: Command,
    userId: string,
    target: Target,
): Row[] {
    const sql = buildStatement(command, userId);

    // execFileSync, not a shell: the statement is one argv entry, so nothing
    // in it is ever interpreted by a shell.
    let output: string;
    try {
        output = execFileSync(
            'supabase',
            ['db', 'query', `--${target}`, '--output-format', 'json', sql],
            {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 64 * 1024 * 1024,
            },
        );
    } catch (error) {
        const { stdout = '', stderr = '' } = error as {
            stdout?: string;
            stderr?: string;
        };
        throw new Error(`supabase db query failed:\n${stdout}${stderr}`.trim());
    }

    return rowsFrom(output);
}
