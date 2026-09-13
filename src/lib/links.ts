/**
 * Outward links, in one place.
 *
 * The extension is published, so its store listing is the default and every build links to it
 * with nothing to configure. A fork that publishes its own copy overrides it at build time, and
 * sets its own public origin the same way:
 *
 *     VITE_EXTENSION_URL=https://chromewebstore.google.com/detail/<your-id>
 *     VITE_SITE_URL=https://bioplot.example
 */
const STORE_LISTING_URL =
  'https://chromewebstore.google.com/detail/bioplot-farm-reader/acjgafpghcopmjnplglomadieaodjcha'

export const EXTENSION_URL: string = import.meta.env.VITE_EXTENSION_URL?.trim() || STORE_LISTING_URL

/** The app's own public origin. Only needed where a link must be absolute. */
export const SITE_URL: string = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, '') ?? ''

/**
 * The privacy policy and terms ship WITH the app, at its own origin.
 *
 * They are a condition of listing the extension, so they have to be reachable by anyone, from
 * anywhere, forever. A relative path is reachable wherever the app is deployed, with no
 * dependency on a code host staying up or a repository staying where it is.
 */
export const PRIVACY_URL = 'privacy.html'
export const TERMS_URL = 'terms.html'

/** The public source, and where to report something wrong. */
export const REPO_URL = 'https://github.com/develoverli/bioplot'
export const CONTACT_URL = `${REPO_URL}/issues`
