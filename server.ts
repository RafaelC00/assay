// Oxygen worker entry.
//
// Phase 1 has no Storefront API client, so this uses React Router's request
// handler directly. Hydrogen's own handler (`@shopify/hydrogen/oxygen`)
// requires a Storefront client in the load context; it replaces this one,
// together with createHydrogenContext(), when the catalog source moves to the
// Storefront API (see app/lib/catalog/source.ts).
import {createRequestHandler} from 'react-router';
import * as build from 'virtual:react-router/server-build';

const handleRequest = createRequestHandler(build, process.env.NODE_ENV);

export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};
