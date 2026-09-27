import { BookRow } from './book-row';
import type { BookRow as Book } from '../types';

/**
 * The paginated list body (FR-1). Renders the rows it is handed and nothing
 * else -- the page decides what to show when there are none (`EmptyState`), so
 * this needs no knowledge of the filters that produced them.
 *
 * Dividers carry an explicit colour: Tailwind v4 defaults `border-*` to
 * `currentColor`, so a bare `border-b` draws a black rule and turns the list
 * into a grid.
 */
export function BookList({
    books,
    signedIn,
}: {
    books: Book[];
    /** Whether the toggles track (FR-4) or offer sign-in (FR-2). */
    signedIn: boolean;
}) {
    return (
        <ul className="divide-y divide-frost-200 border-y border-frost-200">
            {books.map((book) => (
                <BookRow key={book.id} book={book} signedIn={signedIn} />
            ))}
        </ul>
    );
}
