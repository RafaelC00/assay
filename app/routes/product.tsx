import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/product';
import {catalog} from '~/lib/catalog/source';
import {priceVariant} from '~/lib/pricing/sale';
import {PriceBlock} from '~/components/ProductCard';

export const meta = ({data}: Route.MetaArgs) =>
  data
    ? [
        {title: `${data.product.title} | ASSAY`},
        // Built from the product's own description, which is already written
        // to the no-claims constraint, so the meta tag cannot drift into
        // making a claim the page itself does not make.
        {name: 'description', content: data.product.description.slice(0, 155)},
      ]
    : [{title: 'Product not found | ASSAY'}];

export async function loader({params, request}: Route.LoaderArgs) {
  const product = await catalog.getProduct(params.handle);
  if (!product) throw new Response('Product not found', {status: 404});
  const [vendor, sale, currency] = await Promise.all([
    catalog.getVendor(product.vendor),
    catalog.getSale(),
    catalog.getCurrency(),
  ]);
  const sku = new URL(request.url).searchParams.get('variant');
  const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];
  const decision = priceVariant(product, variant, sale);
  return {product, vendor, sale, currency, variant, decision};
}

export default function ProductPage() {
  const {product, vendor, sale, currency, variant, decision} = useLoaderData<typeof loader>();
  const discounted = decision.priceCents < decision.listPriceCents;
  return (
    <article className="product">
      <p className="crumbs">
        <Link to="/collections/all">All products</Link>
        {vendor ? (
          <>
            {' / '}
            <Link to={`/collections/all?vendor=${vendor.handle}`}>{vendor.name}</Link>
          </>
        ) : null}
      </p>
      <p className="card__vendor">{vendor?.name ?? product.vendor}</p>
      <h1>{product.title}</h1>
      <p className="muted">{product.category}</p>

      <PriceBlock
        listCents={decision.listPriceCents}
        priceCents={decision.priceCents}
        currency={currency}
      />

      <div className={`pricing-note pricing-note--${decision.status}`} role="note">
        <strong>
          {discounted
            ? `${sale.name}: ${decision.appliedPct}% off`
            : `Not discounted in the ${sale.name}`}
        </strong>
        <p>{decision.reason}</p>
      </div>

      {product.variants.length > 1 ? (
        <nav aria-label="Size" className="variants">
          {product.variants.map((v) => (
            <Link
              key={v.sku}
              to={`?variant=${encodeURIComponent(v.sku)}`}
              className={v.sku === variant.sku ? 'variant variant--active' : 'variant'}
              aria-current={v.sku === variant.sku ? 'true' : undefined}
              preventScrollReset
            >
              {v.title}
            </Link>
          ))}
        </nav>
      ) : (
        <p className="muted">{variant.title}</p>
      )}

      <p>{product.description}</p>

      <section aria-labelledby="assay-title" className="assay">
        <h2 id="assay-title">Third-party assay</h2>
        <p>Every lot is tested by an independent laboratory. The published panel covers:</p>
        <ul>
          {product.assay_panel.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
