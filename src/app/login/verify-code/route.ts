import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
    parseCode,
    PENDING_EMAIL_COOKIE,
    pendingEmailCookieOptions,
} from '@/features/auth/email-sign-in';
import { logStepFailure, openEmailStep } from '@/features/auth/email-step';
import {
    CODE_INVALID_CODE,
    verifyFailure,
} from '@/features/auth/login-error-message';
import { pathAfterSignIn } from '@/features/profile/data';
import { createClient } from '@/lib/supabase/server';

/**
 * Checks a sign-in code and signs the reader in (Email FR-5), posted by the
 * sign-in page's plain code form. Also takes `reset=1`, from **Use a
 * different address**, which leaves the code step for the email step.
 *
 * The address comes from the pending-address cookie `send-code` set, never
 * from the form, so a posted address can't point a code at another account.
 */
export async function POST(request: Request) {
    const step = await openEmailStep(request);
    if (step instanceof Response) return step;

    const cookieStore = await cookies();
    const clearPending = () =>
        cookieStore.delete({
            name: PENDING_EMAIL_COOKIE,
            path: pendingEmailCookieOptions().path,
        });

    if (step.form.get('reset') === '1') {
        clearPending();
        return step.back();
    }

    const email = cookieStore.get(PENDING_EMAIL_COOKIE)?.value;
    // The code step has expired, or was never reached: back to the address.
    if (!email) return step.back();

    const token = parseCode(step.form.get('code'));
    if (token === null) return step.back(CODE_INVALID_CODE);

    const supabase = await createClient();
    // `email` accepts both a first sign-in's confirmation code and a later
    // sign-in's code. The cookie stays on failure, so the code step does too.
    const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
    });
    if (error || !data.user) {
        const failure = verifyFailure(error?.code);
        logStepFailure(
            'Failed to verify a sign-in code',
            error,
            failure.expected,
        );
        return step.back(failure.error);
    }

    clearPending();
    // A first sign-in goes through setup on its way to `next` (Profiles
    // FR-4). It reads the profile as the new session: `cookies()` is one
    // store here, already holding the cookies `verifyOtp` just set.
    return NextResponse.redirect(
        `${step.origin}${await pathAfterSignIn(data.user.id, step.next)}`,
        303,
    );
}
