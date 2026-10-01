import {Form, Link, useLoaderData, useSubmit} from 'react-router';
import type {Route} from './+types/collection';
import {catalog} from '~/lib/catalog/source';
import {ProductCard} from '~/components/ProductCard';

export const meta = () => [
  {title: 'All products | ASSAY'},
  {
    name: 'description',
    content:
      'Every product ASSAY stocks, filterable by brand. Each one carries a published third-party assay.',
  },
];

export async function loader({request}: Route.LoaderArgs) {
  const url = new URL(request.url);
  const vendors = await catalog.listVendors();
  const known = new Set(vendors.map((v) => v.handle));
  // Ignore unknown handles rather than returning an empty page for a typo.
  const selected = [...new Set(url.searchParams.getAll('vendor'))].filter((h) => known.has(h));
  const [products, sale, currency] = await Promise.all([
    catalog.listProducts({vendors: selected}),
    catalog.getSale(),
    catalog.getCurrency(),
  ]);
  return {vendors, selected, products, sale, currency};
}

export default function Collection() {
  const {vendors, selected, products, sale, currency} = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const names = selected.map((h) => vendors.find((v) => v.handle === h)?.name).filter(Boolean);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Shop</p>
        <h1>{names.length ? names.join(', ') : 'All products'}</h1>
        <p className="muted" aria-live="polite">
          {products.length} {products.length === 1 ? 'product' : 'products'}
          {names.length ? ' · filtered by brand' : ' from every brand'}
        </p>
      </header>

      <Form method="get" className="filters" aria-label="Filter by brand" onChange={(e) => submit(e.currentTarget)}>
        <fieldset>
          <legend className="sr-only">Brand</legend>
          {vendors.map((v) => (
            <label key={v.handle} className="pill" data-brand={v.handle}>
              <input type="checkbox" name="vendor" value={v.handle} defaultChecked={selected.includes(v.handle)} />
              <span>{v.name}</span>
            </label>
          ))}
        </fieldset>
        <noscript>
          <button type="submit" className="button">
            Apply
          </button>
        </noscript>
        {selected.length > 0 ? (
          <Link to="/collections/all" className="clear">
            Clear filters
          </Link>
        ) : null}
      </Form>

      <section className="grid" aria-label="Products">
        {products.map((p, i) => (
          <ProductCard
            key={p.handle}
            product={p}
            vendor={vendors.find((v) => v.handle === p.vendor)}
            sale={sale}
            currency={currency}
            priority={i < 4}
          />
        ))}
      </section>
    </>
  );
}
