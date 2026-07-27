/**
 * Cache Configuration — Single source of truth for the SW cache name.
 *
 * All files that read/write the Cache Storage API should import this
 * constant instead of hardcoding the string, so a version bump in the
 * future only requires changing it in one place.
 *
 * Note: `public/sw.js` is a plain JS file served statically (not processed
 * by Vite) and cannot import ES modules. Its `CACHE_NAME` must be kept in
 * sync manually — search for `CACHE_NAME` in `public/sw.js` to update it.
 */
export const CACHE_NAME = "portal-cliente-v2";
