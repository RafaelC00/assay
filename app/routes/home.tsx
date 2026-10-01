import {Link, useLoaderData} from 'react-router';
import {catalog} from '~/lib/catalog/source';
import {summariseSale} from '~/lib/pricing/sale';
import {ProductCard} from '~/components/ProductCard';
import {SaleLedger} from '~/components/MapPanels';
import {AssayReport} from '~/components/AssayReport';

export const meta = () => [
  {title: 'ASSAY | Premium supplements, third-party assayed'},
  {
    name: 'description',
    content:
      'Supplements from brands that publish third-party assay results. Magnesium, omega-3, creatine, protein and electrolytes,.',
  },
];

// The hero is the page's LCP. Both crops are preloaded under a media query so a
// phone fetches the small one and a desktop the large one, never both.
const HERO_DESKTOP = [800, 1200, 1600];
const HERO_MOBILE = [480, 720, 960];
const heroSet = (kind: 'lineup' | 'lineup-m', widths: number[], ext: string) =>
  widths.map((w) => `/hero/${kind}-${w}.${ext} ${w}w`).join(', ');

export const links = () => [
  {
    rel: 'preload',
    as: 'image',
    type: 'image/avif',
    media: '(max-width: 719px)',
    imageSrcSet: heroSet('lineup-m', HERO_MOBILE, 'avif'),
    imageSizes: '100vw',
    fetchPriority: 'high' as const,
  },
  {
    rel: 'preload',
    as: 'image',
    type: 'image/avif',
    media: '(min-width: 720px)',
    imageSrcSet: heroSet('lineup', HERO_DESKTOP, 'avif'),
    imageSizes: '(min-width: 1240px) 1200px, 100vw',
    fetchPriority: 'high' as const,
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
  // Two per brand, so the grid shows every pricing rule more than once.
  const featured = vendors
    .flatMap((v) => products.filter((p) => p.vendor === v.handle).slice(0, 2))
    .slice(0, 8);
  const reportProduct = products.find((p) => p.handle === 'kestrel-magnesium-glycinate') ?? products[0];
  return {sale, vendors, summary, featured, currency, products: products.length, reportProduct};
}

export default function Home() {
  const {sale, vendors, summary, featured, currency, products, reportProduct} = useLoaderData<typeof loader>();
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow">Third-party assayed supplements</p>
          <h1 id="hero-title">
            Every lot tested. <em>Every result published.</em>
          </h1>
        </div>
        <div className="hero__aside">
          <p className="lead">
            {products} products from {vendors.length} brands, each with an independent laboratory&apos;s panel
            published next to it. No claims, just what is in the tub and what was tested for.
          </p>
          <p className="hero__cta">
            <Link className="button" to="/collections/all">
              Shop all products
            </Link>
            <Link className="button button--ghost" to="/#sale">
              How the sale applies
            </Link>
          </p>
        </div>
        <picture className="hero__art">
          <source
            type="image/avif"
            media="(max-width: 719px)"
            srcSet={heroSet('lineup-m', HERO_MOBILE, 'avif')}
            sizes="100vw"
          />
          <source
            type="image/webp"
            media="(max-width: 719px)"
            srcSet={heroSet('lineup-m', HERO_MOBILE, 'webp')}
            sizes="100vw"
          />
          <source type="image/avif" srcSet={heroSet('lineup', HERO_DESKTOP, 'avif')} sizes="(min-width: 1240px) 1200px, 100vw" />
          <source type="image/webp" srcSet={heroSet('lineup', HERO_DESKTOP, 'webp')} sizes="(min-width: 1240px) 1200px, 100vw" />
          <img
            src="/hero/lineup-1200.jpg"
            width={1600}
            height={700}
            alt="Five supplement containers, one from each brand: a white bottle with a black cap, a blush-pink bottle, an amber glass bottle, a sage-green bottle and a navy tub."
            fetchPriority="high"
            decoding="sync"
          />
        </picture>
      </section>

      <section id="sale" className="section sale" aria-labelledby="sale-title">
        <div className="section__head">
          <p className="eyebrow">{sale.name}</p>
          <h2 id="sale-title">
            A {sale.percent_off}% sale that says who is in it.
          </h2>
          <p className="lead">
            Premium brands limit how far a retailer may advertise them below list. So the headline number does not
            land evenly, and this is exactly how it does, brand by brand. Checkout enforces the same rule, so the price
            you see is the price you pay.
          </p>
        </div>
        <SaleLedger summary={summary} sale={sale} />
      </section>

      <section className="section" aria-labelledby="featured-title">
        <div className="section__head section__head--row">
          <h2 id="featured-title">From every brand</h2>
          <Link to="/collections/all">View all {products} products</Link>
        </div>
        <div className="grid">
          {featured.map((p, i) => (
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

      <section className="section split" aria-labelledby="assay-title">
        <div>
          <p className="eyebrow">What assayed means</p>
          <h2 id="assay-title">The lab report is part of the product page.</h2>
          <p className="lead">
            An assay is a laboratory test of what is actually in a lot: potency against the label, and the things that
            should not be there. We stock only products with a published panel, and we list the tests on each one.
          </p>
        </div>
        {reportProduct ? <AssayReport product={reportProduct} /> : null}
      </section>
    </>
  );
}
