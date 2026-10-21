import Image from 'next/image';

/**
 * Who is signed in: their GitHub avatar and name, in the header. Everything
 * shown is decided by the header (`headerNameFor`, `avatarUrlFor`,
 * `initialFor`), so the badge's text is the same `label` that starts the
 * account menu's accessible name.
 *
 * The avatar goes through `next/image`, which fetches it via this app's own
 * server rather than the reader's browser, so viewing a page makes no request
 * to GitHub. Without one, a circle of the same size stands in, lettered with
 * `initial`, or without one holding a generic person icon, so it still reads
 * as "your account" rather than as something that failed to load.
 *
 * A picture that fails to load is deliberately *not* covered by a fallback:
 * the browser's broken-image icon makes the failure visible, so it gets
 * reported and fixed rather than silently papered over.
 *
 * The picture, letter and icon are decorative (`alt=""`, `aria-hidden`): the
 * text beside them already says who is signed in.
 */
export function UserBadge({
    label,
    initial,
    avatarUrl,
}: {
    label: string;
    initial: string | null;
    avatarUrl: string | null;
}) {
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
                    // frost-50 on iron-600: 8.33:1, well clear of AA for the
                    // letter (4.5:1) and the icon (3:1 for graphics).
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-frost-300 bg-iron-600 text-xs font-medium text-frost-50"
                >
                    {initial ?? (
                        <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="size-4"
                        >
                            <path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 7a6 6 0 0 1 12 0 1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
                        </svg>
                    )}
                </span>
            )}
            <span>{label}</span>
        </span>
    );
}
