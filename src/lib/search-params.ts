/**
 * Resolved `searchParams` for a page. Matches what Next's generated
 * `PageProps` hands over, once awaited.
 */
export type SearchParams = Record<string, string | string[] | undefined>;
