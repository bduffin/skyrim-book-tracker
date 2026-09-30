/**
 * Whether a Server Action request is a native form POST -- the form submitted
 * with JavaScript off -- rather than a call from Next's client.
 *
 * The difference matters to an action that should redirect after a native
 * write, so the POST does not stay in the history and ask to be resubmitted
 * on refresh or back, while a client call keeps its in-place update.
 *
 * Read from Fetch Metadata, a web standard rather than anything of Next's: the
 * browser itself sets `Sec-Fetch-Mode`, and scripts cannot set or change it. A
 * form submission is a document navigation (`navigate`); Next's client calls
 * an action with `fetch()` (`cors`). Supported from Chrome 76, Firefox 90 and
 * Safari 16.4, all inside the browser floor (architecture.md section 9).
 *
 * A request without the header -- an older browser, or a client that is not a
 * browser -- reads as not native, so it gets no redirect: the page re-renders
 * in place, which is what a native POST got before this check existed.
 */
export function isNativeFormPost(headers: Pick<Headers, 'get'>): boolean {
    return headers.get('sec-fetch-mode') === 'navigate';
}
