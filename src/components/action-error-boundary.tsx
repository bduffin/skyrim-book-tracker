'use client';

import { unstable_rethrow } from 'next/navigation';
import { Component, createRef, Fragment, type ReactNode } from 'react';

/**
 * Catches a Server Action that threw instead of answering -- a dropped
 * connection, a server that did not respond -- which `useActionState`
 * rethrows to the nearest error boundary. Without one around the form, that
 * is the route's `error.tsx`, and a single failed submission would replace
 * the whole page.
 *
 * It cannot be avoided by wrapping the action in a client function that
 * catches: only a Server Action passed to `<form action>` directly still
 * submits with JavaScript disabled.
 *
 * On a catch it calls `onError` and remounts its children, which resets their
 * action state and shows server values again.
 *
 * Except for Next's own navigation errors, which it passes on. An action that
 * calls `redirect()` -- as `saveProfile` does on success -- reaches the client
 * as a thrown redirect error, which Next's router boundary above has to catch
 * to navigate. Caught here instead, a successful save read as a lost
 * connection, and Next keeps those errors out of the console, so nothing
 * said why.
 *
 * Remounting replaces the form's button, and a focused element that leaves
 * the page drops focus to the start of the document -- so a keyboard user who
 * pressed it would be sent back to the top. The boundary notes whether focus
 * was inside it just before the old button goes, and puts it on the first
 * button of the new children afterwards. Only then: restoring it
 * unconditionally would pull focus back from wherever the reader had moved
 * on to.
 */
export class ActionErrorBoundary extends Component<
    { onError: (error: unknown) => void; children: ReactNode },
    { failed: boolean; attempt: number; error: unknown }
> {
    state = { failed: false, attempt: 0, error: null as unknown };

    private readonly wrapper = createRef<HTMLDivElement>();
    private restoreFocus = false;

    static getDerivedStateFromError(error: unknown) {
        return { failed: true, error };
    }

    /**
     * Runs just before React commits the failed render that removes the
     * button -- the last moment the old button is still in the document.
     * `componentDidCatch` is too late: it runs after that commit, by which
     * time focus has already fallen to the body.
     */
    getSnapshotBeforeUpdate(
        _props: unknown,
        previous: { failed: boolean },
    ): boolean {
        if (previous.failed || !this.state.failed) return false;
        return this.wrapper.current?.contains(document.activeElement) ?? false;
    }

    componentDidUpdate(_props: unknown, _state: unknown, hadFocus: boolean) {
        if (hadFocus) this.restoreFocus = true;
        if (this.restoreFocus && !this.state.failed) {
            this.restoreFocus = false;
            this.wrapper.current?.querySelector('button')?.focus();
        }
    }

    componentDidCatch(error: unknown) {
        this.props.onError(error);
        this.setState(({ attempt }) => ({
            failed: false,
            attempt: attempt + 1,
        }));
    }

    render() {
        // Throws a redirect or not-found on to Next's own boundary, so this
        // one never commits for it and `componentDidCatch` never runs.
        if (this.state.failed) unstable_rethrow(this.state.error);

        // The wrapper outlives the remount, so it is still there to look for
        // focus in and to find the new button through.
        return (
            <div ref={this.wrapper}>
                {this.state.failed ? null : (
                    <Fragment key={this.state.attempt}>
                        {this.props.children}
                    </Fragment>
                )}
            </div>
        );
    }
}
