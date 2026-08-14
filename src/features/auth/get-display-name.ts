const METADATA_NAME_KEYS = [
    'user_name',
    'preferred_username',
    'full_name',
    'name',
];

function firstNonEmptyString(
    metadata: Record<string, unknown> | undefined,
    keys: readonly string[],
): string | undefined {
    if (!metadata) {
        return undefined;
    }

    for (const key of keys) {
        const value = metadata[key];
        if (typeof value === 'string' && value.trim() !== '') {
            return value;
        }
    }

    return undefined;
}

// Providers differ in what they populate: GitHub/Discord/X-style providers
// give a handle (user_name/preferred_username), Google/Apple/Facebook only
// give a display name (full_name/name), and some give neither.
export function getDisplayName(claims: {
    email?: string;
    user_metadata?: Record<string, unknown>;
}): string {
    const fromMetadata = firstNonEmptyString(
        claims.user_metadata,
        METADATA_NAME_KEYS,
    );
    if (fromMetadata) {
        return fromMetadata;
    }

    const [localPart] = claims.email?.split('@') ?? [];
    if (localPart) {
        return localPart;
    }

    return 'Signed in';
}
