'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isLoginPath } from '../return-path';

/**
 * A "Sign in" link to the sign-in page (Email FR-3), styled as a button.
 *
 * It carries no `next`: the sign-in page reads the page the reader came from
 * out of its own `Referer` (`loginPageNext`), which this component could not
 * supply anyway -- the header renders from the root layout, which is never
 * told the current URL.
 *
 * Nothing is rendered on the sign-in page itself. Following the link there
 * would only reload it with itself as the `Referer`, replacing the `next` it
 * already carries with `/`. A Client Component for `usePathname`, which the
 * server render has too, so the link is absent there with JavaScript off.
 */
export function SignInLink({
    tone = 'header',
}: {
    /**
     * `header` is frost on the iron header; `inline` inverts it for the light
     * page, where the frost fill would all but vanish.
     */
    tone?: 'header' | 'inline';
}) {
    if (isLoginPath(usePathname())) return null;

    return (
        <Link
            href="/login"
            className={
                tone === 'header'
                    ? 'rounded bg-frost-50 px-4 py-2 font-medium text-iron-900 transition-colors hover:bg-frost-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-frost-50'
                    : 'rounded bg-iron-900 px-3 py-1.5 text-sm font-medium text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800'
            }
        >
            Sign in
        </Link>
    );
}
