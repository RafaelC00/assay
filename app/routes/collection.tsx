import {Form, Link, useLoaderData} from 'react-router';
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
  return (
    <>
      <h1>All products</h1>
      <div className="layout">
        <aside aria-label="Filters">
          <Form method="get" className="filters">
            <fieldset>
              <legend>Brand</legend>
              {vendors.map((v) => (
                <label key={v.handle} className="check">
                  <input
                    type="checkbox"
                    name="vendor"
                    value={v.handle}
                    defaultChecked={selected.includes(v.handle)}
                  />
                  {v.name}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button">
              Apply
            </button>
            {selected.length > 0 ? (
              <Link to="/collections/all" className="clear">
                Clear filters
              </Link>
            ) : null}
          </Form>
        </aside>
        <section aria-live="polite">
          <p className="muted">
            {products.length} {products.length === 1 ? 'product' : 'products'}
          </p>
          <div className="grid">
            {products.map((p) => (
              <ProductCard
                key={p.handle}
                product={p}
                vendor={vendors.find((v) => v.handle === p.vendor)}
                sale={sale}
                currency={currency}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
