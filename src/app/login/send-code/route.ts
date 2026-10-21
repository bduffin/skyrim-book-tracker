import { cookies } from 'next/headers';

import {
    parseEmail,
    PENDING_EMAIL_COOKIE,
    pendingEmailCookieOptions,
} from '@/features/auth/email-sign-in';
import { logStepFailure, openEmailStep } from '@/features/auth/email-step';
import {
    EMAIL_INVALID_CODE,
    sendFailure,
} from '@/features/auth/login-error-message';
import { createClient } from '@/lib/supabase/server';

/**
 * Emails a sign-in code (Email FR-4), posted by the sign-in page's plain
 * email form, so it works without JavaScript. Every answer is a redirect
 * back to the page (`openEmailStep`).
 */
export async function POST(request: Request) {
    const step = await openEmailStep(request);
    if (step instanceof Response) return step;

    const email = parseEmail(step.form.get('email'));
    if (email === null) return step.back(EMAIL_INVALID_CODE);

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
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

    // Set through `cookies()`, which Next writes onto the response returned
    // below, as it does the session cookies in /auth/callback.
    if (!failure || failure.codeStep) {
        (await cookies()).set(
            PENDING_EMAIL_COOKIE,
            email,
            pendingEmailCookieOptions(),
        );
    }
    return step.back(failure?.error);
}
