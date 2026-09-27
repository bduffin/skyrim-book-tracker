import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        rules: {
            // prd-browse-and-track.md AC-11 / NFR-8: book text comes from UESP
            // wikitext, and the import's cleanWikitext is a best-effort pass
            // rather than a hardened sanitizer -- so nothing UESP-sourced may
            // reach a raw-HTML sink. Banned outright rather than scoped to
            // those fields, because a lint rule cannot tell where a string came
            // from; a genuine need takes an inline disable with a reason.
            'react/no-danger': 'error',
        },
    },
    {
        // Supabase clients are created per request, never at module scope:
        // Vercel's Fluid compute can share one running instance across
        // concurrent requests from different users, so a module-level client
        // can carry one user's session into another's request. Scoped to
        // src/, which serves requests; scripts/ and tests/ are one process
        // per run and legitimately build a client once.
        //
        // Matches any create*Client call -- `createClient`,
        // `createServerClient`, `createBrowserClient`, bare or as a namespace
        // member -- that is not inside a function. A client made inside a
        // function defined at the top level is fine: it runs per call.
        //
        // Any further no-restricted-syntax selector for src/ has to go in this
        // same list: flat config merges rules by name, so a second entry that
        // also sets no-restricted-syntax replaces this one rather than adding
        // to it, and this check would silently stop running.
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        'CallExpression:matches([callee.name=/^create(Server|Browser)?Client$/], [callee.property.name=/^create(Server|Browser)?Client$/]):not(:function *)',
                    message:
                        'Create Supabase clients inside the function that uses them, per request. At module scope, Fluid compute can share one client across concurrent requests from different users and leak a session between them.',
                },
            ],
        },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
    ]),
]);

export default eslintConfig;
