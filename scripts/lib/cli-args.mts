/**
 * Command-line options for the UESP import (FR-1, FR-18).
 *
 * Separate from `import-uesp.mts` so that tests can import argument parsing
 * without importing the entry point -- the entry point runs an import on
 * import, and nothing should have to guard against that.
 */

export type ImportOptions = {
    dumpPath: string;
    dryRun: boolean;
    allowRemote: boolean;
    dumpDate: string | null;
    /** Target database; falls back to NEXT_PUBLIC_SUPABASE_URL (FR-14, FR-16). */
    url: string | null;
    /** Prompt for the secret key even if one is in the environment (FR-16). */
    promptKey: boolean;
};

export const USAGE =
    'Usage: yarn import:uesp <dump-path> [--dry-run] [--url=<supabase-url>]\n' +
    '                        [--allow-remote] [--prompt-key]\n' +
    '                        [--dump-date=YYYY-MM-DD]';

/** Reads the date UESP encodes in `uespwiki-YYYY-MM-DD-current.xml.bz2` (FR-18). */
export function dumpDateFromFilename(path: string): string | null {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(path.split('/').pop() ?? '');
    return m ? m[1] : null;
}

export function parseArgs(argv: string[]): ImportOptions {
    const positional: string[] = [];
    let dryRun = false;
    let allowRemote = false;
    let promptKey = false;
    let dumpDate: string | null = null;
    let url: string | null = null;

    for (const arg of argv) {
        if (arg === '--dry-run') dryRun = true;
        else if (arg === '--allow-remote') allowRemote = true;
        else if (arg === '--prompt-key') promptKey = true;
        else if (arg.startsWith('--dump-date='))
            dumpDate = arg.slice('--dump-date='.length);
        else if (arg.startsWith('--url=')) url = arg.slice('--url='.length);
        else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
    }

    if (positional.length === 0) throw new Error(USAGE);
    if (positional.length > 1) {
        throw new Error(
            `Expected one dump path, got ${positional.length}: ${positional.join(', ')}`,
        );
    }

    return {
        dumpPath: positional[0],
        dryRun,
        allowRemote,
        dumpDate: dumpDate ?? dumpDateFromFilename(positional[0]),
        // Resolved here rather than in db.mts so that every source of the
        // target is visible in one place (FR-16).
        url: url ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? null,
        promptKey,
    };
}
