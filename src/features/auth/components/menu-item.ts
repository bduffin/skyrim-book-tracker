/**
 * One row of the account menu, link or button alike, so both look the same.
 *
 * A plain module rather than an export of `account-menu.tsx`: that file is a
 * Client Component, and a Server Component importing a value from it gets a
 * client reference rather than the string.
 */
export const MENU_ITEM_CLASS =
    'block w-full px-4 py-2 text-left text-sm text-iron-900 transition-colors hover:bg-frost-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800';
