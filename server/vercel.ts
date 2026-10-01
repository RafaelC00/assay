import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler} from 'react-router';

/**
 * Vercel (Node runtime) SSR entry.
 *
 * React Router's "custom server" entry, selected in vite.config.ts through
 * build.rollupOptions.input when TARGET=vercel. It mirrors the Oxygen worker
 * in ../server.ts but exports a plain Web-API fetch handler, which is what the
 * Vercel integration expects.
 *
 * Phase 1 has no Storefront client, so there is no load context to build. When
 * the catalog source moves to the Storefront API this gains a getLoadContext,
 * the way the Oxygen entry will.
 */
const handleRequest = createRequestHandler(serverBuild, process.env.NODE_ENV);

export default async function handler(request: Request): Promise<Response> {
  return handleRequest(request);
}
