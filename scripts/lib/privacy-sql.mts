/**
 * SQL for answering privacy requests (Privacy FR-4, FR-6, §12.2).
 *
 * These statements run with full privileges, against the hosted project when
 * `--linked`, so the only value that ever reaches them is a user id that has
 * passed `parseUserId`. The account is found by email in the Supabase
 * dashboard, never here: an email address is a stranger's input, and RFC 5321
 * lets it carry quotes and `$`. A canonical UUID is hex digits and hyphens
 * only, so the id goes in as a plain literal -- validation, not encoding:
 * nothing is transformed, and anything else is refused before SQL is built.
 *
 * Pure, so the gate and the statements it produces are tested without a
 * database (Privacy AC-9). `privacy-request.mts` is the I/O around it.
 */

export const COMMANDS = [
    'show',
    'export',
    'delete-flow-state',
    'verify',
] as const;
export type Command = (typeof COMMANDS)[number];

export type Target = 'local' | 'linked';

export type RequestOptions = {
    command: Command;
    userId: string;
    target: Target;
};

export const USAGE =
    'Usage: yarn privacy:request <command> <user id> --local|--linked\n' +
    `  commands: ${COMMANDS.join(', ')}\n` +
    '  The user id comes from the Supabase dashboard (Authentication -> Users);\n' +
    '  see docs/privacy-requests.md.';

const CANONICAL_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PLACEHOLDER = '{{user_id}}';

/**
 * Returns the id lowercased if it is a canonical UUID, and throws otherwise.
 * Whitespace is refused rather than trimmed: an id that needs cleaning up was
 * not copied from the dashboard, and the procedure should stop and ask why.
 */
export function parseUserId(input: string): string {
    const id = input.toLowerCase();
    if (!CANONICAL_UUID.test(id)) {
        throw new Error(
            `Not a user id: ${JSON.stringify(input)}. Copy the id from the ` +
                'Supabase dashboard (Authentication -> Users); it looks like ' +
                '1b4e28ba-2fa1-11d2-883f-0016d3cca427.',
        );
    }
    return id;
}

export function parseRequestArgs(argv: string[]): RequestOptions {
    const positional: string[] = [];
    const targets: Target[] = [];

    for (const arg of argv) {
        if (arg === '--local') targets.push('local');
        else if (arg === '--linked') targets.push('linked');
        else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
    }

    if (positional.length !== 2) throw new Error(USAGE);
    // The target is never defaulted: `--linked` is production (architecture.md
    // §13.1), and a request should never land there by omission.
    if (targets.length !== 1) {
        throw new Error(`Give exactly one of --local or --linked.\n${USAGE}`);
    }

    const [command, rawId] = positional;
    if (!(COMMANDS as readonly string[]).includes(command)) {
        throw new Error(`Unknown command: ${command}\n${USAGE}`);
    }

    return {
        command: command as Command,
        userId: parseUserId(rawId),
        target: targets[0],
    };
}

export const TEMPLATES: Readonly<Record<Command, string>> = {
    // FR-4 step 1: the stored email and GitHub id that confirmation needs.
    show: `
select u.id, u.email, u.created_at, u.last_sign_in_at,
       i.identity_data ->> 'provider_id' as github_id,
       i.identity_data ->> 'user_name'   as github_username
  from auth.users u
  left join auth.identities i on i.user_id = u.id and i.provider = 'github'
 where u.id = {{user_id}}`,

    // FR-6: every stored item about the user. Sign-in records give dates and
    // method only, never the GitHub tokens, which are credentials rather than
    // information about the user.
    export: `
select jsonb_pretty(jsonb_build_object(
  'account', (select jsonb_build_object(
      'id', u.id, 'email', u.email, 'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at, 'github_profile', u.raw_user_meta_data)
    from auth.users u where u.id = {{user_id}}),
  'identities', (select coalesce(jsonb_agg(jsonb_build_object(
      'provider', i.provider, 'identity_data', i.identity_data,
      'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at)), '[]'::jsonb)
    from auth.identities i where i.user_id = {{user_id}}),
  'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', s.created_at, 'updated_at', s.updated_at,
      'ip', host(s.ip), 'user_agent', s.user_agent) order by s.created_at), '[]'::jsonb)
    from auth.sessions s where s.user_id = {{user_id}}),
  'sign_in_records', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', f.created_at, 'provider', f.provider_type,
      'method', f.authentication_method) order by f.created_at), '[]'::jsonb)
    from auth.flow_state f where f.user_id = {{user_id}}),
  'profile', (select jsonb_build_object(
      'is_public', p.is_public, 'username', p.username)
    from public.profile p where p.user_id = {{user_id}}),
  'books', (select coalesce(jsonb_agg(jsonb_build_object(
      'title', b.title, 'is_read', ub.is_read, 'is_collected', ub.is_collected,
      'updated_at', ub.updated_at) order by b.title), '[]'::jsonb)
    from public.user_book ub join public.book b on b.id = ub.book_id
   where ub.user_id = {{user_id}}),
  'notes', (select coalesce(jsonb_agg(jsonb_build_object(
      'title', b.title, 'notes', n.notes, 'updated_at', n.updated_at) order by b.title), '[]'::jsonb)
    from public.user_book_note n join public.book b on b.id = n.book_id
   where n.user_id = {{user_id}})
)) as export`,

    // FR-4 step 4: the sign-in records that do not cascade from auth.users.
    // Counted, so the procedure can record how many went.
    'delete-flow-state': `
with deleted as (
  delete from auth.flow_state where user_id = {{user_id}} returning 1
)
select count(*) as deleted from deleted`,

    // FR-4 step 5: every table in auth and public with a user_id column, and
    // auth.users itself, found rather than listed -- the set differs between
    // Supabase versions and grows with the app.
    verify: `
select c.table_schema || '.' || c.table_name as table_name,
       (xpath('/row/n/text()', query_to_xml(
         format('select count(*) as n from %I.%I where %I::text = %L',
                c.table_schema, c.table_name, c.column_name, {{user_id}}::text),
         false, true, '')))[1]::text::int as remaining
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
 where c.table_schema in ('auth', 'public')
   and (c.column_name = 'user_id'
        or (c.table_schema = 'auth' and c.table_name = 'users' and c.column_name = 'id'))
 order by 1`,
};

/**
 * The statement for `command`, with every placeholder replaced by the
 * validated id as `'<uuid>'::uuid`. Validates again rather than trusting the
 * caller, so no path reaches SQL without the gate.
 */
export function buildStatement(command: Command, rawId: string): string {
    const literal = `'${parseUserId(rawId)}'::uuid`;
    const sql = TEMPLATES[command].replaceAll(PLACEHOLDER, literal).trim();
    if (sql.includes('{{')) {
        throw new Error(`Unfilled placeholder in the ${command} statement.`);
    }
    return sql;
}

export type Row = Record<string, unknown>;

/**
 * The rows from `supabase db query --output-format json`. The CLI prints a
 * bare array to a person, and wraps it as `{ rows, boundary, warning }` when
 * it detects an agent -- a marker that the rows are untrusted data, which is
 * left to the CLI's own detection rather than switched off here.
 */
export function rowsFrom(output: string): Row[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        throw new Error(`Could not read the query's output:\n${output}`);
    }
    if (Array.isArray(parsed)) return parsed as Row[];
    if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { rows?: unknown }).rows)
    ) {
        return (parsed as { rows: Row[] }).rows;
    }
    throw new Error(`Unexpected query output:\n${output}`);
}
