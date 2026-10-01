import type { ReactNode } from 'react';

import { PageTitle } from '@/components/page-title';

/**
 * The class for a message page's action, whether it is a link (`Back to
 * home`) or a button (`Try again`), so both look the same.
 */
export const MESSAGE_ACTION_CLASS =
    'rounded border border-frost-300 bg-white px-4 py-2 text-iron-900 transition-colors hover:bg-frost-100';

/**
 * A page that is only a title, a sentence and one action: the 404, the auth
 * error page and both error boundaries.
 *
 * No hooks and no server-only imports, so the error boundaries -- which must
 * be Client Components -- can render it as well as Server Components can.
 */
export function MessagePage({
    title,
    message,
    action,
}: {
    title: ReactNode;
    message: ReactNode;
    action: ReactNode;
}) {
    return (
        // The same max-w-3xl frame as /books, so the title plate sits where
        // it does on every other page. It also has to: PageTitle's divider
        // lines are flex-1, and inside an items-center column they would
        // shrink to the width of the title and vanish.
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>{title}</PageTitle>
            {/*
             * pt-1 on top of PageTitle's own pb-5 puts 24px above the message,
             * matching gap-6 below it, so it sits centered between the rule
             * and the action.
             */}
            <div className="flex flex-col items-center gap-6 px-4 pt-1 pb-6 text-center">
                {/*
                 * The column's width rather than a cap of its own, so a
                 * message fits on one line where there is room. Balanced
                 * where there is not, so the lines come out even rather than
                 * one long line over a stub. text-wrap: balance is newer than
                 * the browser floor (architecture.md section 9); older
                 * browsers ignore it and wrap normally.
                 */}
                <p className="text-balance text-iron-500">{message}</p>
                {action}
            </div>
        </main>
    );
}
