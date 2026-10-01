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
} from 'react-router';
import {useNonce} from '@shopify/hydrogen';
import appStyles from '~/styles/app.css?url';

export const links = () => [
  {rel: 'stylesheet', href: appStyles},
  {rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml'},
];

// No meta export here on purpose. React Router replaces an ancestor's meta
// with the leaf route's rather than merging them, so a description declared at
// the root is silently discarded by every page that sets a title. Each route
// declares its own.

function Layout({children}: {children: React.ReactNode}) {
  return (
    <>
      <header className="site-header">
        <div className="wrap site-header__inner">
          <Link to="/" className="wordmark" aria-label="ASSAY home">
            ASSAY
          </Link>
          <nav aria-label="Primary" className="nav">
            <NavLink to="/collections/all">Shop all</NavLink>
            <NavLink to="/status">Status</NavLink>
          </nav>
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <p>
            Every product we stock has a published third-party assay. Descriptions cover form,
            dosage, sourcing and testing only.
          </p>
          <p className="muted">
            ASSAY and all brands and products shown are fictional. This is a demonstration
            storefront.
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
