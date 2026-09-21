/**
 * UESP attribution (FR-7, architecture.md section 2.2).
 *
 * Rendered from the root layout rather than from the book list, so it cannot
 * be lost when another route starts showing the same data -- `/collection/[user]`
 * will. CC BY-SA is a condition of using the data at all, not a footnote on one
 * page, and the README carries the matching notice.
 */
export function UespAttribution() {
    return (
        <footer className="mx-auto max-w-3xl px-4 py-8 text-xs leading-relaxed text-gray-500">
            <p>
                Book data from the{' '}
                <a
                    href="https://en.uesp.net"
                    className="underline hover:text-gray-700"
                >
                    Unofficial Elder Scrolls Pages
                </a>{' '}
                (UESP), licensed{' '}
                <a
                    href="https://en.uesp.net/wiki/UESPWiki:Copyright_and_Ownership"
                    className="underline hover:text-gray-700"
                >
                    CC BY-SA 2.5
                </a>
                . UESP is an independent community project and is not affiliated
                with Bethesda Softworks.
            </p>
            <p className="pt-2">
                <em>The Elder Scrolls</em> and <em>Skyrim</em> are trademarks of
                Bethesda Softworks LLC. This project is unofficial and
                unaffiliated.
            </p>
        </footer>
    );
}
