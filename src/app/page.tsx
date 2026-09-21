import { redirect } from 'next/navigation';

/**
 * FR-8: `/` sends the visitor to whichever page is theirs.
 *
 * Unconditionally `/books` until Browse M3 adds `/collection/[user]`, at which
 * point this reads the session and picks. `redirect()` issues a **307**; a
 * permanent 308 would be cached by the browser indefinitely, so anyone who
 * first landed here signed out would never reach their collection afterwards.
 */
export default function Home() {
    redirect('/books');
}
