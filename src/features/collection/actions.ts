'use server';

import { revalidatePath } from 'next/cache';

import { getViewerId } from '@/features/auth/get-viewer-id';
import { BOOKS_PATH } from '@/features/books/scope';
import { createClient } from '@/lib/supabase/server';

import {
    parseSetFlagInput,
    rpcArgsFor,
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

    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
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

    // Re-renders the list from the database, which is what lets the toggle's
    // optimistic state give way to server truth (NFR-6, R2). The collection
    // page will need the same once it exists.
    revalidatePath(BOOKS_PATH);

    return {
        status: 'ok',
        bookId: input.bookId,
        isRead: data.is_read,
        isCollected: data.is_collected,
    };
}
