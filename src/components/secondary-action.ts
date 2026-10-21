/**
 * A secondary action, link or button alike: white with a frost border, beside
 * or below the page's primary iron button. One string, so a change to how
 * secondary actions look -- the focus ring included -- reaches every one.
 *
 * A plain module rather than a component export, so Server and Client
 * Components can both import the string itself.
 */
export const SECONDARY_ACTION_CLASS =
    'rounded border border-frost-300 bg-white px-4 py-2 text-iron-900 transition-colors hover:bg-frost-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800';
