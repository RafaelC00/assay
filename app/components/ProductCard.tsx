import {Link} from 'react-router';
import type {Product, Sale, Vendor} from '~/lib/catalog/types';
import {formatMoney} from '~/lib/money';
import {priceVariant} from '~/lib/pricing/sale';
import {ProductImage} from './ProductImage';

export function PriceBlock({
  listCents,
  priceCents,
  currency,
  from = false,
}: {
  listCents: number;
  priceCents: number;
  currency: string;
  from?: boolean;
}) {
  const discounted = priceCents < listCents;
  return (
    <p className="price">
      {from ? <span className="price__from">From </span> : null}
      <span className={discounted ? 'price__now price__now--sale' : 'price__now'}>
        {formatMoney(priceCents, currency)}
      </span>
      {discounted ? (
        <s className="price__was" aria-label={`List price ${formatMoney(listCents, currency)}`}>
          {formatMoney(listCents, currency)}
        </s>
      ) : null}
    </p>
  );
}

export function ProductCard({
  product,
  vendor,
  sale,
  currency,
  priority = false,
}: {
  product: Product;
  vendor: Vendor | undefined;
  sale: Sale;
  currency: string;
  /** Above-the-fold card: its image is fetched eagerly. */
  priority?: boolean;
}) {
  const variant = product.variants[0];
  const d = priceVariant(product, variant, sale);
  const discounted = d.priceCents < d.listPriceCents;
  const href = `/products/${product.handle}`;
  return (
    <article className="card" data-brand={product.vendor} data-map-policy={product.map_policy} data-map-status={d.status}>
      <div className="card__media">
        <ProductImage image={product.images?.[0]} product={product} priority={priority} />
      </div>
      <div className="card__body">
        <p className="eyebrow">{vendor?.name ?? product.vendor}</p>
        <h3 className="card__title">
          <Link to={href}>{product.title}</Link>
        </h3>
        <p className="card__meta">{product.category}</p>
        <PriceBlock
          listCents={d.listPriceCents}
          priceCents={d.priceCents}
          currency={currency}
          from={product.variants.length > 1}
        />
        {discounted ? (
          <p className="chip chip--sale">{d.appliedPct}% off</p>
        ) : (
          <p className="chip">Not in the sale</p>
        )}
      </div>
    </article>
  );
}
