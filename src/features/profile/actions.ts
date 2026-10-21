'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
    authErrorPath,
    SIGNED_OUT_CODE,
} from '@/features/auth/auth-error-message';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { isNativeFormPost } from '@/lib/server-action';
import { createClient } from '@/lib/supabase/server';

import {
    parseProfileInput,
    saveDestination,
    type SaveProfileResult,
} from './profile-input';

/**
 * Saves the signed-in user's profile from `/settings` (Profiles FR-5), which
 * is how a profile row first comes to exist (Profiles FR-2).
 *
 * Shaped for `useActionState` and passed to a `<form action>` directly, so it
 * still submits with JavaScript disabled.
 *
 * Writes `user_id` and `is_public` only. The upsert's update half then leaves
 * every other column as it is, so changing visibility never clears a username
 * set later (Profiles M2).
 *
 * Success always redirects, whether or not JavaScript ran: back to `next`
 * when sign-in sent the user here, otherwise to `/settings?saved=1`, whose
 * confirmation has to live in the URL because a redirect discards the action
 * state. Failures return instead, so the form re-renders in place with the
 * submitted choice and the reason.
 */
export async function saveProfile(
    _previous: SaveProfileResult,
    form: FormData,
): Promise<SaveProfileResult> {
    const input = parseProfileInput(form);
    if (input === null) {
        return { status: 'error', error: 'invalid_input', isPublic: null };
    }

    // From the session, never from the form (Profiles FR-2).
    const viewerId = await getViewerId();
    if (viewerId === null) {
        // Without JavaScript the response is a render of /settings itself,
        // which sends a signed-out reader to /books -- so the returned
        // reason would never be seen. Say it on a page that can.
        if (isNativeFormPost(await headers())) {
            redirect(authErrorPath({ errorCode: SIGNED_OUT_CODE }));
        }
        return {
            status: 'error',
            error: 'unauthenticated',
            isPublic: input.isPublic,
        };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from('profile')
        .upsert(
            { user_id: viewerId, is_public: input.isPublic },
            { onConflict: 'user_id' },
        );
    if (error) {
        console.error('Failed to save profile:', error);
        return {
            status: 'error',
            error: 'write_failed',
            isPublic: input.isPublic,
        };
    }

    // The whole layout, not one path (Profiles Decision 9): the viewer's
    // collection page under any of its URLs, and every page's header.
    revalidatePath('/', 'layout');

    // Outside any try/catch: redirect() works by throwing.
    redirect(saveDestination(input));
}
