import {catalog} from '~/lib/catalog/source';
import {catalogHealthResponse} from '~/lib/catalog/health';

/** GET /healthz: reads the catalog for real. See lib/catalog/health.ts. */
export async function loader() {
  return catalogHealthResponse(catalog);
}
