import 'server-only';

import { NextResponse } from 'next/server';

import {
    emailStepGate,
    isEmailSignInEnabled,
    loginPath,
} from './email-sign-in';
import { getViewerId } from './get-viewer-id';
import { publicOrigin } from './public-origin';
import { loginNext } from './return-path';

/**
 * The opening both email sign-in Route Handlers share (Email FR-4, FR-5):
 * the checks Next would make for a Server Action, done by hand, then the
 * posted form and `next`.
 *
 * Route Handlers rather than Server Actions so the firewall's one rate-limit
 * rule can match a fixed path (Email Decision 9).
 */
export type EmailStep = {
    origin: string;
    form: FormData;
    next: string;
    /**
     * Back to `/login`, with `error` when there is one. Always a 303, which
     * the browser follows with a GET: the 307 `NextResponse.redirect` sends by
     * default would make it repeat the POST, and a repeated `send-code` sends
     * a second code that replaces the one on its way.
     */
    back: (error?: string) => NextResponse;
};

/** The request's step, or the response that ends it here. */
export async function openEmailStep(
    request: Request,
): Promise<EmailStep | Response> {
    // With no origin of its own to compare with, refuse rather than guess.
    const origin = publicOrigin(request.headers);
    if (origin === null) return new Response(null, { status: 403 });

    const gate = emailStepGate({
        originHeader: request.headers.get('origin'),
        origin,
        enabled: isEmailSignInEnabled(),
        signedIn: (await getViewerId()) !== null,
    });
    if (gate === 'forbidden') return new Response(null, { status: 403 });
    if (gate === 'disabled') return new Response(null, { status: 404 });

    // A body that is not a form reads as an empty one, which then fails the
    // caller's checks like any other bad input.
    const form = await request.formData().catch(() => new FormData());
    const next = loginNext(form.get('next'));

    if (gate === 'signed-in') {
        return NextResponse.redirect(`${origin}${next}`, 303);
    }

    return {
        origin,
        form,
        next,
        back: (error) =>
            NextResponse.redirect(
                `${origin}${loginPath({ next, error })}`,
                303,
            ),
    };
}

/**
 * Logs a failed Auth call: only Supabase's `code` and `status`, never the
 * error itself, whose message for a refused address quotes the address. A
 * failure that is the reader's own is a warning, so a mistyped code never
 * looks like an outage.
 */
export function logStepFailure(
    message: string,
    error: { code?: string; status?: number } | null,
    expected: boolean,
): void {
    const log = expected ? console.warn : console.error;
    log(message, { code: error?.code, status: error?.status });
}
