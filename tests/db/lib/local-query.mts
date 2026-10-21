/**
 * SQL against the local stack's database, through `supabase db query
 * --local`, for what PostgREST cannot reach: the `auth` schema, `cron.job`,
 * privileges, and fixtures that must roll back.
 *
 * One copy, because how the CLI must be called has already changed once for
 * every test that used it:
 *
 * - `--agent no`, because the CLI formats its output for whoever it thinks is
 *   running it: wrapped in its own JSON, with the message's quotes escaped,
 *   when it detects an agent, and plain text for a person. Pinned, the tests
 *   read the same output whoever runs them.
 * - Results are read from between two markers of their own, never "to the end
 *   of the line": the CLI decorates the line it prints, and colors it when
 *   FORCE_COLOR is set -- as some terminals set it -- which puts an escape
 *   code straight after the result.
 *
 * `--local` is the guard: these never reach a hosted project. Callers still
 * call `localStack()` first, which refuses anything but a local API.
 */

import { execFileSync } from 'node:child_process';

const START = 'local-query-result:';
const END = ':end-local-query-result';

/** The CLI's output, whether the statement succeeded or raised. */
function run(sql: string): string {
    try {
        return execFileSync(
            'supabase',
            ['db', 'query', '--local', '--agent', 'no', sql],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
    } catch (error) {
        const { stdout = '', stderr = '' } = error as {
            stdout?: string;
            stderr?: string;
        };
        return `${stdout}${stderr}`;
    }
}

function between(output: string): string {
    const start = output.indexOf(START);
    const end = output.indexOf(END, start);
    if (start === -1 || end === -1) {
        throw new Error(`The query did not reach its result:\n${output}`);
    }
    return output.slice(start + START.length, end);
}

/**
 * Runs `body` inside a `do` block whose last statement raises `result` -- a
 * jsonb expression the body can reach -- and returns it parsed. Raising rolls
 * back everything the body wrote. Anything else the block raises is a genuine
 * failure, and throws.
 */
export function probe(body: string, result: string): Record<string, unknown> {
    return JSON.parse(
        between(
            run(
                `do $$ begin ${body} raise exception '${START}%${END}', (${result}); end $$`,
            ),
        ),
    );
}

/** One SQL value, as text; SQL `null` reads as `'null'`. */
export function queryValue(expression: string): string {
    return between(
        run(
            `select '${START}' || coalesce((${expression})::text, 'null') || '${END}'`,
        ),
    );
}
