import { CODE_LENGTH, LOGIN_PATH } from '../email-sign-in';

/**
 * The sign-in page's two email steps (Email FR-1, FR-2): plain HTML forms
 * posting to the Route Handlers under `/login/`, each answering with a
 * redirect back to the page, so both work without JavaScript.
 *
 * `errorId` names the page's error message, which describes the field when
 * there is one.
 */

const FIELD =
    'w-full rounded-md border border-frost-300 bg-white px-3 py-2 text-iron-900 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-steel-800';

const LABEL = 'block pb-1.5 text-sm font-medium text-iron-900';

const SECONDARY =
    'rounded text-sm text-iron-600 underline underline-offset-2 transition-colors hover:text-iron-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800';

const SUBMIT =
    'w-full rounded bg-iron-900 px-4 py-2 font-medium text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800';

type StepProps = {
    next: string;
    errorId: string;
    hasError: boolean;
};

export function EmailStep({ next, errorId, hasError }: StepProps) {
    return (
        <form
            method="post"
            action={`${LOGIN_PATH}/send-code`}
            className="w-full max-w-sm space-y-3 text-left"
        >
            <input type="hidden" name="next" value={next} />
            <div>
                <label htmlFor="email" className={LABEL}>
                    Email address
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    aria-invalid={hasError || undefined}
                    aria-describedby={hasError ? errorId : undefined}
                    className={FIELD}
                />
            </div>
            <button type="submit" className={SUBMIT}>
                Send code
            </button>
            <p className="text-sm text-iron-600">
                A different email address means a different account. If you sign
                in with GitHub, use the address on your GitHub account to reach
                the same collection.
            </p>
        </form>
    );
}

export function CodeStep({
    email,
    next,
    errorId,
    hasError,
}: StepProps & { email: string }) {
    return (
        <div className="w-full max-w-sm space-y-3 text-left">
            <form
                method="post"
                action={`${LOGIN_PATH}/verify-code`}
                className="space-y-3"
            >
                <p className="text-iron-600">
                    We sent an {CODE_LENGTH}-digit code to{' '}
                    <span className="font-medium break-all text-iron-900">
                        {email}
                    </span>
                    . It works for 10 minutes.
                </p>
                <input type="hidden" name="next" value={next} />
                <div>
                    <label htmlFor="code" className={LABEL}>
                        Code
                    </label>
                    <input
                        id="code"
                        name="code"
                        // Text, never `number`, which drops a leading zero.
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        // Room for the spaces a copied code can carry.
                        maxLength={CODE_LENGTH * 2}
                        required
                        aria-invalid={hasError || undefined}
                        aria-describedby={hasError ? errorId : undefined}
                        className={`${FIELD} tracking-[0.2em]`}
                    />
                </div>
                <button type="submit" className={SUBMIT}>
                    Sign in
                </button>
            </form>
            {/*
             * Forms of their own, not links: each posts to a handler, one to
             * send a new code to the pending address, one to clear the
             * pending-address cookie, which only a handler can do. Neither
             * posts the address: the handlers read it from the cookie.
             */}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-2">
                <form method="post" action={`${LOGIN_PATH}/send-code`}>
                    <input type="hidden" name="next" value={next} />
                    <input type="hidden" name="resend" value="1" />
                    <button type="submit" className={SECONDARY}>
                        Send a new code
                    </button>
                </form>
                <form method="post" action={`${LOGIN_PATH}/verify-code`}>
                    <input type="hidden" name="next" value={next} />
                    <input type="hidden" name="reset" value="1" />
                    <button type="submit" className={SECONDARY}>
                        Use a different address
                    </button>
                </form>
            </div>
        </div>
    );
}
