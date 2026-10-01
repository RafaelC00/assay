/**
 * Responsive image URLs for the Shopify CDN.
 *
 * Product photographs live in Shopify and are served from cdn.shopify.com,
 * which resizes on the fly (`width`) and re-encodes (`format`). It offers
 * WebP and progressive JPEG but not AVIF, so a <picture> carries WebP first
 * and a progressive JPEG fallback. The masters are 1024px, so there is no
 * point asking for more: the CDN would not upscale.
 */
export const CARD_WIDTHS = [240, 360, 480, 640] as const;
export const PRODUCT_WIDTHS = [480, 640, 800, 1024] as const;

export type ImageFormat = 'webp' | 'pjpg';

const CDN_HOST = 'cdn.shopify.com';

/** The same image at a given width and encoding. Non-Shopify URLs pass through. */
export function cdnUrl(url: string, width: number, format: ImageFormat): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname !== CDN_HOST) return url;
  u.searchParams.set('width', String(width));
  u.searchParams.set('format', format);
  return u.toString();
}

export function srcSet(url: string, widths: readonly number[], format: ImageFormat): string {
  return widths.map((w) => `${cdnUrl(url, w, format)} ${w}w`).join(', ');
}

/** `sizes` for the catalogue grid: 2 columns on a phone, 3 on tablet, 4 on desktop. */
export const CARD_SIZES = '(min-width: 1100px) 262px, (min-width: 720px) 30vw, 46vw';
