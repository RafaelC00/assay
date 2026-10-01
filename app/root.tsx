import {
  isRouteErrorResponse,
  Links,
  Link,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
} from 'react-router';
import {useNonce} from '@shopify/hydrogen';
import appStyles from '~/styles/app.css?url';
import {catalog} from '~/lib/catalog/source';

export const links = () => [
  // The display face is the only webfont. Preloaded because the headline is in it.
  {
    rel: 'preload',
    href: '/fonts/instrument-serif-latin-400-normal.woff2',
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous' as const,
  },
  {rel: 'preconnect', href: 'https://cdn.shopify.com'},
  {rel: 'stylesheet', href: appStyles},
  {rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml'},
];

// No meta export here on purpose. React Router replaces an ancestor's meta
// with the leaf route's rather than merging them, so a description declared at
// the root is silently discarded by every page that sets a title. Each route
// declares its own.

export async function loader() {
  return {sale: await catalog.getSale()};
}

function Layout({children}: {children: React.ReactNode}) {
  // Undefined inside the error boundary, where the root loader may not have run.
  const sale = useRouteLoaderData<typeof loader>('root')?.sale;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {sale ? (
        <div className="announce">
          <div className="wrap">
            <p>
              <strong>{sale.name}</strong> · up to {sale.percent_off}% off, where each brand allows it.{' '}
              <Link to="/#sale">See how it applies</Link>
            </p>
          </div>
        </div>
      ) : null}
      <header className="site-header">
        <div className="wrap site-header__inner">
          <Link to="/" className="wordmark" aria-label="ASSAY home">
            <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M6.5 11.4l3 3 6-6.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            ASSAY
          </Link>
          <nav aria-label="Primary" className="nav">
            <NavLink to="/collections/all">Shop all</NavLink>
            <Link to="/#sale">The sale</Link>
            <NavLink to="/status">Status</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="wrap">
        {children}
      </main>
      <footer className="site-footer">
        <div className="wrap site-footer__inner">
          <div>
            <p className="wordmark wordmark--sm">ASSAY</p>
            <p className="muted">
              Every product we stock has a published third-party assay. Descriptions cover form, dosage, sourcing and
              testing only.
            </p>
          </div>
          <div>
            <p className="eyebrow">Shop</p>
            <p>
              <Link to="/collections/all">All products</Link>
            </p>
            <p>
              <Link to="/#sale">How the sale applies</Link>
            </p>
            <p>
              <Link to="/status">Live performance</Link>
            </p>
          </div>
          <p className="muted site-footer__note">
            ASSAY and all brands and products shown are fictional. This is a demonstration storefront.
          </p>
        </div>
      </footer>
    </>
  );
}

export default function App() {
  const nonce = useNonce();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f4f1ea" />
        <Meta />
        <Links />
      </head>
      <body>
        <Layout>
          <Outlet />
        </Layout>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const nonce = useNonce();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{notFound ? 'Not found | ASSAY' : 'Error | ASSAY'}</title>
        <Links />
      </head>
      <body>
        <Layout>
          <h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
          <p>
            <Link to="/collections/all">Browse all products</Link>
          </p>
        </Layout>
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}
