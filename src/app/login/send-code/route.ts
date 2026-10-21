import { cookies } from 'next/headers';

import {
    parseEmail,
    PENDING_EMAIL_COOKIE,
    pendingEmailCookieOptions,
} from '@/features/auth/email-sign-in';
import { logStepFailure, openEmailStep } from '@/features/auth/email-step';
import {
    CODE_STEP_EXPIRED_CODE,
    EMAIL_INVALID_CODE,
    sendFailure,
} from '@/features/auth/login-error-message';
import { createStatelessClient } from '@/lib/supabase/stateless';

/**
 * Emails a sign-in code (Email FR-4), posted by the sign-in page's plain
 * email form, so it works without JavaScript, and by the code step's **Send a
 * new code** with `resend=1`. Every answer is a redirect back to the page
 * (`openEmailStep`).
 *
 * A resend takes its address from the pending-address cookie, as
 * `verify-code` does, never from the form: the code step has one address, and
 * nothing posted can change which account it is for.
 */
export async function POST(request: Request) {
    const step = await openEmailStep(request);
    if (step instanceof Response) return step;

    const cookieStore = await cookies();
    const resend = step.form.get('resend') === '1';
    const email = parseEmail(
        resend
            ? cookieStore.get(PENDING_EMAIL_COOKIE)?.value
            : step.form.get('email'),
    );
    if (email === null) {
        return step.back({
            error: resend ? CODE_STEP_EXPIRED_CODE : EMAIL_INVALID_CODE,
        });
    }

    // No session and no cookies: sending a code needs neither, and the
    // server client's PKCE flow would leave verifier cookies behind
    // (`createStatelessClient`).
    const { error } = await createStatelessClient().auth.signInWithOtp({
        email,
        // Sign-up is open (Email Decision 2): a first code creates the
        // account, confirmed when the code is entered.
        options: { shouldCreateUser: true },
    });

    const failure = error ? sendFailure(error.code) : null;
    if (failure) {
        logStepFailure(
            'Failed to send a sign-in code',
            error,
            failure.expected,
        );
    }

    // Through `cookies()`, which Next writes onto the response returned
    // below, as it does the session cookies in /auth/callback.
    const options = pendingEmailCookieOptions();
    switch (failure?.pending ?? 'set') {
        case 'set':
            cookieStore.set(PENDING_EMAIL_COOKIE, email, options);
            break;
        case 'clear':
            cookieStore.delete({
                name: PENDING_EMAIL_COOKIE,
                path: options.path,
            });
            break;
    }

    if (failure) return step.back({ error: failure.error });
    // From **Send a new code**: say that one went out, since the page looks
    // the same either way.
    return step.back({ sent: resend });
}
