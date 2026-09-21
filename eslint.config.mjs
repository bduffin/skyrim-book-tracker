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
