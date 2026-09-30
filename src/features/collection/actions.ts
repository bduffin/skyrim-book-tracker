'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getViewerId } from '@/features/auth/get-viewer-id';
import { BOOKS_PATH } from '@/features/books/scope';
import { isNativeFormPost } from '@/lib/server-action';
import { createClient } from '@/lib/supabase/server';

import { collectionPath } from './route';
import {
    parseSetFlagInput,
    rpcArgsFor,
    writeReturnTarget,
    type SetFlagResult,
} from './flag-input';

/**
 * Sets one read/collected flag on one book for the signed-in user (FR-4).
 *
 * Shaped for `useActionState` -- previous state first, then the form -- and
 * meant to be passed to a `<form action>` directly rather than wrapped in a
 * client function, because only a Server Action handed straight to the form
 * still submits with JavaScript disabled.
 *
 * The write itself is `set_book_flags`, which decides between upsert and
 * delete inside one transaction; see its migration for why that cannot be a
 * sequence of client calls. RLS and the function's own `auth.uid()` both
 * enforce ownership. The session check here does not add security on top of
 * them. It exists so a signed-out submission gets its own `unauthenticated`
 * answer, which the toggle can turn into a sign-in prompt, instead of a
 * permission error indistinguishable from a failed write.
 */
export async function setBookFlags(
    _previous: SetFlagResult,
    form: FormData,
): Promise<SetFlagResult> {
    const input = parseSetFlagInput(form);
    if (input === null) {
        return { status: 'error', bookId: null, error: 'invalid_input' };
    }

    // From the session, never from the form (R5).
    const viewerId = await getViewerId();
    if (viewerId === null) {
        return {
            status: 'error',
            bookId: input.bookId,
            error: 'unauthenticated',
        };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
        .rpc('set_book_flags', rpcArgsFor(input))
        .single<{ is_read: boolean; is_collected: boolean }>();
    if (error) {
        console.error('Failed to set book flag:', error);
        return {
            status: 'error',
            bookId: input.bookId,
            error: 'write_failed',
        };
    }

    // Re-renders both routes that show this flag from the database, which is
    // what lets the toggle's optimistic state give way to server truth and
    // keeps the progress meters honest (NFR-6, R2). The collection path is
    // built from the session's own id: a toggle only ever changes the
    // viewer's own collection, so every other user's page stays cached.
    revalidatePath(BOOKS_PATH);
    revalidatePath(collectionPath(viewerId));

    // Without JavaScript the form posted natively, and answering with the
    // re-rendered page would leave that POST in the history: refreshing or
    // going back to it asks to resubmit the form. So a successful native
    // write redirects to a GET of the same page, at the toggle. A call from
    // Next's client never redirects, and keeps its optimistic update.
    //
    // Only on success. A failure is re-rendered in place, because the
    // result *is* what the page shows -- for `unauthenticated`, the sign-in
    // prompt -- and a redirect would discard it.
    const requestHeaders = await headers();
    const origin = requestHeaders.get('origin');
    // No `Origin`, no way to build the redirect target: render in place.
    if (isNativeFormPost(requestHeaders) && origin !== null) {
        // Outside any try/catch: redirect() works by throwing.
        redirect(
            writeReturnTarget(requestHeaders.get('referer'), origin, input),
        );
    }

    return {
        status: 'ok',
        bookId: input.bookId,
        isRead: data.is_read,
        isCollected: data.is_collected,
    };
}
