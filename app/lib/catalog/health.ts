import type {CatalogSource} from './source';

/**
 * Build the health response from a real catalog read.
 *
 * 200 healthy : fresh snapshot.
 * 200 stale   : the upstream refresh is failing and an older snapshot is
 *               being served. Visitors are fine, the owner needs to know, so
 *               the state is in the body and in X-Catalog-State.
 * 503 broken  : the catalog cannot be served. Also returned if the probe
 *               itself throws: a health route must never answer 200 by
 *               accident.
 */
export async function catalogHealthResponse(source: CatalogSource): Promise<Response> {
  const headers = {'content-type': 'application/json', 'cache-control': 'no-store'};
  try {
    const health = await source.getHealth();
    return new Response(JSON.stringify(health), {
      status: health.state === 'broken' ? 503 : 200,
      headers: {...headers, 'x-catalog-state': health.state},
    });
  } catch {
    return new Response(JSON.stringify({state: 'broken', lastError: 'health probe failed'}), {
      status: 503,
      headers: {...headers, 'x-catalog-state': 'broken'},
    });
  }
}
