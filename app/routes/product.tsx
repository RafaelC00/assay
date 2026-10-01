import {Link, useLoaderData} from 'react-router';
import type {Route} from './+types/product';
import {catalog} from '~/lib/catalog/source';
import {priceVariant} from '~/lib/pricing/sale';
import {PriceBlock} from '~/components/ProductCard';
import {ProductImage} from '~/components/ProductImage';
import {MapExplainer} from '~/components/MapPanels';
import {AssayReport} from '~/components/AssayReport';

export const meta = ({data}: Route.MetaArgs) =>
  data
    ? [
        {title: `${data.product.title} | ASSAY`},
        // Built from the product's own description, which is already written
        // to the no-claims constraint, so the meta tag cannot drift into
        // making a claim the page itself does not make.
        {name: 'description', content: data.product.description.slice(0, 155)},
        ...(data.product.images?.[0] ? [{property: 'og:image', content: data.product.images[0].url}] : []),
        {'script:ld+json': data.jsonLd},
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
  const url = new URL(request.url);
  const sku = url.searchParams.get('variant');
  const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];
  const decision = priceVariant(product, variant, sale);

  // Structured data carries the price a shopper is actually offered, which is
  // the MAP-resolved one, so search results cannot advertise a price the page
  // would then refuse to honour.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description,
    category: product.category,
    brand: {'@type': 'Brand', name: vendor?.name ?? product.vendor},
    sku: variant.sku,
    ...(product.images?.length ? {image: product.images.map((i) => i.url)} : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: currency,
      price: (decision.priceCents / 100).toFixed(2),
      url: `${url.origin}${url.pathname}`,
    },
  };
  return {product, vendor, sale, currency, variant, decision, jsonLd};
}

export default function ProductPage() {
  const {product, vendor, sale, currency, variant, decision} = useLoaderData<typeof loader>();
  return (
    <article className="product" data-brand={product.vendor} data-map-status={decision.status}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/collections/all">All products</Link>
        {vendor ? (
          <>
            <span aria-hidden="true"> / </span>
            <Link to={`/collections/all?vendor=${vendor.handle}`}>{vendor.name}</Link>
          </>
        ) : null}
      </nav>

      <div className="product__grid">
        <div className="product__media">
          <ProductImage image={product.images?.[0]} product={product} variant="product" priority />
        </div>

        <div className="product__info">
          <p className="eyebrow">{vendor?.name ?? product.vendor}</p>
          <h1>{product.title}</h1>
          <p className="muted">{product.category}</p>

          <PriceBlock listCents={decision.listPriceCents} priceCents={decision.priceCents} currency={currency} />

          {product.variants.length > 1 ? (
            <nav aria-label="Size" className="variants">
              {product.variants.map((v) => (
                <Link
                  key={v.sku}
                  to={`?variant=${encodeURIComponent(v.sku)}`}
                  className={v.sku === variant.sku ? 'variant variant--active' : 'variant'}
                  aria-current={v.sku === variant.sku ? 'true' : undefined}
                  preventScrollReset
                  replace
                >
                  {v.title}
                </Link>
              ))}
            </nav>
          ) : (
            <p className="muted">{variant.title}</p>
          )}

          <p className="product__desc">{product.description}</p>

          <MapExplainer
            product={product}
            vendor={vendor}
            sale={sale}
            currency={currency}
            decision={decision}
            selected={variant}
          />
        </div>
      </div>

      <section className="product__assay" aria-labelledby="assay-title">
        <h2 id="assay-title">Third-party assay</h2>
        <p className="lead">Every lot is tested by an independent laboratory. The published panel covers:</p>
        <AssayReport product={product} compact />
      </section>
    </article>
  );
}
