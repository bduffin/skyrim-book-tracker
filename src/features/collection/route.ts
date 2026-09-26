/**
 * The collection page's address and who may see it (FR-8, FR-10).
 *
 * Pure, and kept apart from the page so both rules are unit-tested.
 */

/**
 * A user's collection page. The segment is the Supabase user id, and that
 * form is permanent: FR-11's usernames will be an alternative to it, never a
 * replacement, so links built from this keep working.
 */
export function collectionPath(userId: string): string {
    return `/collection/${userId}`;
}

/**
 * Whether the `[user]` segment names the signed-in viewer's own collection.
 *
 * Until FR-10's visibility setting exists, only the owner may see a collection
 * (FR-8's sequencing constraint), so anything else -- signed out, another
 * user's id, or a segment that is not an id at all -- is not theirs.
 *
 * Case-insensitive, since a UUID is: Postgres accepts `ABC...` and `abc...` as
 * the same id, so an upper-cased link to your own page is still yours.
 */
export function isOwnCollection(
    segment: string,
    viewerId: string | null,
): boolean {
    return (
        viewerId !== null && segment.toLowerCase() === viewerId.toLowerCase()
    );
}
