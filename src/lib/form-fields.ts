/**
 * The subset of `FormData` a Server Action's parser reads. `getAll` rather
 * than `get` so that a repeated field is visible and can be rejected: `get`
 * silently returns the first, and there is no non-arbitrary way to choose
 * between two submitted values.
 */
export type FormFields = {
    getAll(name: string): unknown[];
};

/** A field's single string value, or `null` if absent, repeated or a file. */
export function singleField(form: FormFields, name: string): string | null {
    const values = form.getAll(name);
    if (values.length !== 1) return null;
    const [value] = values;
    return typeof value === 'string' ? value : null;
}
