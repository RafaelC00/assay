import {Link} from 'react-router';
import type {Product, Sale, Variant, Vendor} from '~/lib/catalog/types';
import {formatMoney} from '~/lib/money';
import type {MapDecision} from '~/lib/pricing/map';
import {meterGeometry, policySentence, POLICY_LABEL} from '~/lib/pricing/explain';
import {priceVariant, type VendorSaleSummary} from '~/lib/pricing/sale';

const STATUS_LABEL: Record<MapDecision['status'], string> = {
  applied: 'Full discount',
  clamped: 'Capped by MAP',
  excluded: 'Excluded by MAP',
  none_requested: 'No sale running',
};

function treatmentText(s: VendorSaleSummary, pct: number): string {
  switch (s.treatment) {
    case 'full':
      return `${pct}% off, the full sale.`;
    case 'capped':
      return `Capped at ${s.maxPct}%. Its agreement allows no deeper.`;
    case 'partial':
      return `${s.discountedSkus} of ${s.totalSkus} items take ${pct}%. The rest are protected and stay at list.`;
    case 'excluded':
      return 'Not discounted. Its agreement sets the advertised price at list.';
  }
}

/**
 * The home page's account of how the sale lands on each brand. A bar per brand
 * shows the discount a shopper actually gets against the advertised headline,
 * so the exclusions are the content of the page rather than a footnote.
 */
export function SaleLedger({summary, sale}: {summary: VendorSaleSummary[]; sale: Sale}) {
  return (
    <ol className="ledger">
      {summary.map((s) => {
        const share =
          s.treatment === 'partial' ? (s.discountedSkus / s.totalSkus) * 100 : (s.maxPct / sale.percent_off) * 100;
        return (
          <li key={s.vendor.handle} className="ledger__row" data-brand={s.vendor.handle} data-treatment={s.treatment}>
            <div className="ledger__who">
              <Link to={`/collections/all?vendor=${s.vendor.handle}`} className="ledger__name">
                {s.vendor.name}
              </Link>
              <span className="tag">{POLICY_LABEL[s.vendor.map_policy]}</span>
            </div>
            <div className="ledger__meter" aria-hidden="true">
              <span className="ledger__bar">
                <span className="ledger__fill" style={{width: `${Math.max(share, s.treatment === 'excluded' ? 0 : 4)}%`}} />
              </span>
              <span className="ledger__value">{s.treatment === 'excluded' ? '0%' : `${s.maxPct}%`}</span>
            </div>
            <p className="ledger__why">{treatmentText(s, sale.percent_off)}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The product page's answer to "why is this not on sale?". The meter puts the
 * price the sale asked for and the price that may be advertised on one track,
 * and hatches the gap between them: the part of the discount MAP refused.
 */
export function MapExplainer({
  product,
  vendor,
  sale,
  currency,
  decision,
  selected,
}: {
  product: Product;
  vendor: Vendor | null;
  sale: Sale;
  currency: string;
  decision: MapDecision;
  selected: Variant;
}) {
  const g = meterGeometry(decision);
  const asked = Math.round((decision.listPriceCents * (100 - decision.requestedPct)) / 100);
  const m = (c: number) => formatMoney(c, currency);
  const heading =
    decision.status === 'excluded'
      ? `Not in the ${sale.name}`
      : decision.status === 'clamped'
        ? `${sale.name}: ${decision.appliedPct}% off, not ${decision.requestedPct}%`
        : `${sale.name}: ${decision.appliedPct}% off`;
  const summary =
    decision.status === 'excluded'
      ? `The sale asks for ${m(asked)}. This product may only be advertised at ${m(decision.priceCents)}.`
      : decision.status === 'clamped'
        ? `The sale asks for ${m(asked)}. The lowest price this brand allows is ${m(decision.priceCents)}.`
        : `${m(decision.priceCents)} is within what this brand allows.`;

  return (
    <section className={`map map--${decision.status}`} aria-labelledby="map-title" data-map-code={decision.code}>
      <p className="eyebrow">Pricing</p>
      <h2 id="map-title" className="map__title">
        {heading}
      </h2>
      <p className="map__lede">{summary}</p>

      <div
        className="meter"
        role="img"
        aria-label={`Price scale from ${m(g.lowCents)} to ${m(decision.listPriceCents)}. The sale asked for ${m(asked)}; the advertised price is ${m(decision.priceCents)}.`}
      >
        <div className="meter__track">
          {g.blocked ? (
            <span
              className="meter__blocked"
              style={{left: `${g.requestedAt}%`, width: `${g.advertisedAt - g.requestedAt}%`}}
            />
          ) : null}
          <span className="meter__tick meter__tick--asked" style={{left: `${g.requestedAt}%`}} />
          <span className="meter__tick meter__tick--price" style={{left: `${g.advertisedAt}%`}} />
        </div>
        <div className="meter__labels" aria-hidden="true">
          <span className="meter__label" style={{left: `${g.requestedAt}%`}}>
            <small>{g.blocked ? 'Sale asked' : 'Sale price'}</small>
            {m(asked)}
          </span>
          {g.blocked ? (
            <span className="meter__label meter__label--price" style={{left: `${g.advertisedAt}%`}}>
              <small>May advertise</small>
              {m(decision.priceCents)}
            </span>
          ) : null}
        </div>
      </div>

      <p className="map__reason">{decision.reason}</p>
      {vendor ? (
        <p className="map__policy">
          <span className="tag">{POLICY_LABEL[vendor.map_policy]}</span> {policySentence(vendor)}
        </p>
      ) : null}

      {product.variants.length > 1 ? (
        <table className="sizes">
          <caption className="sr-only">How the sale applies to each size</caption>
          <thead>
            <tr>
              <th scope="col">Size</th>
              <th scope="col">Price</th>
              <th scope="col">Sale</th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v) => {
              const d = priceVariant(product, v, sale);
              return (
                <tr key={v.sku} aria-current={v.sku === selected.sku ? 'true' : undefined}>
                  <th scope="row">{v.title}</th>
                  <td>{m(d.priceCents)}</td>
                  <td>
                    <span className={`chip chip--${d.status}`}>{STATUS_LABEL[d.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
