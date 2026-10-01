import type {RoutePattern} from './schema';

/**
 * Collapses a pathname to a known route pattern. The query string and hash are
 * never looked at, and an unrecognised path becomes "other" rather than being
 * passed through, so a resolved URL cannot end up in the data.
 */
export function routePattern(pathname: string): RoutePattern {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/') return '/';
  if (path === '/collections/all') return '/collections/all';
  if (path === '/status') return '/status';
  if (/^\/products\/[^/]+$/.test(path)) return '/products/:handle';
  return 'other';
}
