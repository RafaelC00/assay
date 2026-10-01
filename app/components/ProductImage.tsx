import {preload} from 'react-dom';
import type {Product, ProductImage as Image} from '~/lib/catalog/types';
import {cdnUrl, srcSet, CARD_SIZES, CARD_WIDTHS, PRODUCT_WIDTHS} from '~/lib/images';

interface Props {
  image: Image | undefined;
  /** Used for the placeholder when the product has no photograph. */
  product: Pick<Product, 'title' | 'vendor'>;
  variant?: 'card' | 'product';
  /**
   * The likely LCP image. It is preloaded (so it is requested before the
   * parser reaches the <img>), fetched at high priority and never lazy.
   * Everything else is lazy and decoded off the main thread.
   */
  priority?: boolean;
  sizes?: string;
}

export function ProductImage({image, product, variant = 'card', priority = false, sizes}: Props) {
  if (!image) {
    // Local data has no photographs. Say so honestly rather than show a broken image.
    return (
      <div className="photo photo--none" role="img" aria-label={`No photograph yet for ${product.title}`}>
        <span aria-hidden="true">{product.title.slice(0, 1)}</span>
      </div>
    );
  }
  const widths = variant === 'card' ? CARD_WIDTHS : PRODUCT_WIDTHS;
  const fallbackWidth = variant === 'card' ? 480 : 800;
  const effectiveSizes = sizes ?? (variant === 'card' ? CARD_SIZES : '(min-width: 900px) 540px, 100vw');
  const webp = srcSet(image.url, widths, 'webp');

  if (priority) {
    preload(cdnUrl(image.url, fallbackWidth, 'webp'), {
      as: 'image',
      imageSrcSet: webp,
      imageSizes: effectiveSizes,
      fetchPriority: 'high',
      type: 'image/webp',
    });
  }

  return (
    <picture>
      <source type="image/webp" srcSet={webp} sizes={effectiveSizes} />
      <img
        className="photo"
        src={cdnUrl(image.url, fallbackWidth, 'pjpg')}
        srcSet={srcSet(image.url, widths, 'pjpg')}
        sizes={effectiveSizes}
        width={image.width}
        height={image.height}
        alt={image.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );
}
