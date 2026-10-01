import type {Product} from '~/lib/catalog/types';

/**
 * The test panel as a lab-report card. It lists which tests are published for
 * the product; it does not invent results, because the data holds none.
 */
export function AssayReport({product, compact = false}: {product: Product; compact?: boolean}) {
  return (
    <aside className={compact ? 'report report--compact' : 'report'} aria-label={`Assay panel for ${product.title}`}>
      <header className="report__head">
        <span className="report__kicker">Independent laboratory assay</span>
        <span className="report__ref" aria-hidden="true">
          {product.handle.toUpperCase().slice(0, 18)}
        </span>
      </header>
      <p className="report__product">{product.title}</p>
      <ul className="report__list">
        {product.assay_panel.map((t) => (
          <li key={t}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4.7 8.2l2.2 2.2 4.4-4.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t}
          </li>
        ))}
      </ul>
      <p className="report__foot">{product.assay_panel.length} tests published for every lot</p>
    </aside>
  );
}
