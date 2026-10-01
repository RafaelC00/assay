import {Link} from 'react-router';
import type {Product, Sale, Vendor} from '~/lib/catalog/types';
import {formatMoney} from '~/lib/money';
import {priceVariant} from '~/lib/pricing/sale';

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
      {from ? <span className="muted">From </span> : null}
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
}: {
  product: Product;
  vendor: Vendor | undefined;
  sale: Sale;
  currency: string;
}) {
  const variant = product.variants[0];
  const d = priceVariant(product, variant, sale);
  return (
    <article className="card">
      <p className="card__vendor">{vendor?.name ?? product.vendor}</p>
      <h3 className="card__title">
        <Link to={`/products/${product.handle}`}>{product.title}</Link>
      </h3>
      <p className="muted">{product.category}</p>
      <PriceBlock
        listCents={d.listPriceCents}
        priceCents={d.priceCents}
        currency={currency}
        from={product.variants.length > 1}
      />
      {d.priceCents < d.listPriceCents ? (
        <p className="badge badge--sale">{d.appliedPct}% off</p>
      ) : (
        <p className="badge">Not included in sale</p>
      )}
    </article>
  );
}
