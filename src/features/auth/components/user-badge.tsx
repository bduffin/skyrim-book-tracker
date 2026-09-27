import Image from 'next/image';

import { avatarUrlFor, initialFor } from '../avatar';

/**
 * Who is signed in: their GitHub avatar and display name, in the header.
 *
 * The avatar goes through `next/image`, which fetches it via this app's own
 * server rather than the reader's browser, so viewing a page makes no request
 * to GitHub. When there is no trustworthy avatar URL, a lettered circle of the
 * same size stands in.
 *
 * A picture that fails to load is deliberately *not* covered by a fallback:
 * the browser's broken-image icon makes the failure visible, so it gets
 * reported and fixed rather than silently papered over.
 *
 * The picture and the letter are decorative (`alt=""`, `aria-hidden`): the
 * name beside them already says who is signed in.
 */
export function UserBadge({
    displayName,
    metadata,
}: {
    displayName: string;
    metadata: Record<string, unknown> | undefined;
}) {
    const avatarUrl = avatarUrlFor(metadata);

    return (
        <span className="flex items-center gap-2">
            {avatarUrl !== null ? (
                <Image
                    src={avatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    // In the header on every page, so never below the fold.
                    loading="eager"
                    className="size-7 shrink-0 rounded-full border border-frost-300"
                />
            ) : (
                <span
                    aria-hidden="true"
                    // frost-50 text on iron-600: 8.33:1, well clear of AA.
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-frost-300 bg-iron-600 text-xs font-medium text-frost-50"
                >
                    {initialFor(displayName)}
                </span>
            )}
            <span>{displayName}</span>
        </span>
    );
}
