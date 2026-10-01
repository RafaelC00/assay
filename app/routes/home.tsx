import {Link, useLoaderData} from 'react-router';
import {catalog} from '~/lib/catalog/source';
import {summariseSale, type VendorSaleSummary} from '~/lib/pricing/sale';
import {ProductCard} from '~/components/ProductCard';

export const meta = () => [
  {title: 'ASSAY | Premium supplements, third-party assayed'},
  {
    name: 'description',
    content:
      'Supplements from brands that publish third-party assay results. Magnesium, omega-3, creatine, protein and electrolytes, shipped worldwide.',
  },
];

export async function loader() {
  const [sale, vendors, products, currency] = await Promise.all([
    catalog.getSale(),
    catalog.listVendors(),
    catalog.listProducts(),
    catalog.getCurrency(),
  ]);
  const summary = summariseSale(vendors, products, sale);
  // One featured product per vendor, so the page shows each pricing rule.
  const featured = vendors
    .map((v) => products.find((p) => p.vendor === v.handle))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  return {sale, vendors, summary, featured, currency};
}

function treatmentText(s: VendorSaleSummary, salePct: number): string {
  switch (s.treatment) {
    case 'full':
      return `${salePct}% off`;
    case 'capped':
      return `Up to ${s.maxPct}% off (the most this vendor allows)`;
    case 'partial':
      return `${salePct}% off on ${s.discountedSkus} of ${s.totalSkus} items; the rest are excluded`;
    case 'excluded':
      return 'Not included. This vendor does not permit discounting.';
  }
}

export default function Home() {
  const {sale, vendors, summary, featured, currency} = useLoaderData<typeof loader>();
  return (
    <>
      <section className="hero">
        <h1>Supplements with the lab results attached.</h1>
        <p className="lead">
          We stock five premium brands and ship worldwide. Each product has a third-party assay,
          and we publish it.
        </p>
        <p>
          <Link className="button" to="/collections/all">
            Shop all products
          </Link>
        </p>
      </section>

      <section className="sale" aria-labelledby="sale-title">
        <h2 id="sale-title">
          {sale.name}: up to {sale.percent_off}% off selected brands
        </h2>
        <p>
          Premium brands set limits on how far their products can be discounted, so the sale does
          not apply evenly. This is exactly how it applies to each brand:
        </p>
        <table className="sale__table">
          <thead>
            <tr>
              <th scope="col">Brand</th>
              <th scope="col">During the sale</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.vendor.handle}>
                <th scope="row">
                  <Link to={`/collections/all?vendor=${s.vendor.handle}`}>{s.vendor.name}</Link>
                </th>
                <td className={s.treatment === 'excluded' ? 'muted' : undefined}>
                  {treatmentText(s, sale.percent_off)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="featured-title">
        <h2 id="featured-title">One from each brand</h2>
        <div className="grid">
          {featured.map((p) => (
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
    </>
  );
}
