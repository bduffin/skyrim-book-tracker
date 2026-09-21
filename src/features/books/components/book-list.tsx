import { BookRow } from './book-row';
import type { BookRow as Book } from '../types';

/**
 * The paginated list body (FR-1). Pagination controls arrive in the next step.
 *
 * Dividers carry an explicit colour: Tailwind v4 defaults `border-*` to
 * `currentColor`, so a bare `border-b` draws a black rule and turns the list
 * into a grid.
 */
export function BookList({ books }: { books: Book[] }) {
    if (books.length === 0) {
        return <p className="px-4 py-8 text-gray-600">No books to show.</p>;
    }

    return (
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
            {books.map((book) => (
                <BookRow key={book.id} book={book} />
            ))}
        </ul>
    );
}
