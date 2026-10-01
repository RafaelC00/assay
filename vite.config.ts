import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {oxygen} from '@shopify/mini-oxygen/vite';
import {reactRouter} from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Two targets, and they need different plugin sets.
 *
 * The Oxygen path (default) uses hydrogen() and oxygen(). Those plugins force
 * a `webworker` SSR target and wire server.ts in as the worker entry, which is
 * correct for Oxygen and wrong for Vercel: Vercel's integration expects a Node
 * SSR bundle exporting a fetch handler, and given a worker bundle it fails at
 * runtime rather than at build time.
 *
 * So the Vercel build drops both plugins and points rollup at
 * server/vercel.ts instead, using React Router's documented custom-server
 * pattern.
 *
 * react-dom/server is aliased to its .browser build for Vercel. Under Node's
 * default condition react-dom resolves that specifier to the Node build, which
 * only has renderToPipeableStream, while entry.server.tsx renders with
 * renderToReadableStream. The .browser build runs on Node's global Web Streams
 * and is the same module Oxygen already gets through the `worker` condition.
 */
const isVercel = process.env.TARGET === 'vercel' || Boolean(process.env.VERCEL);

export default defineConfig(({isSsrBuild}) => ({
  plugins: isVercel
    ? [reactRouter(), tsconfigPaths()]
    : [hydrogen(), oxygen(), reactRouter(), tsconfigPaths()],
  ...(isVercel
    ? {
        resolve: {
          alias: [
            {find: /^react-dom\/server$/, replacement: 'react-dom/server.browser'},
          ],
        },
      }
    : {}),
  build: {
    // Keep a strict CSP possible by never inlining assets as base64.
    assetsInlineLimit: 0,
    ...(isVercel && isSsrBuild
      ? {rollupOptions: {input: './server/vercel.ts'}}
      : {}),
  },
  ssr: {
    optimizeDeps: {
      include: ['set-cookie-parser', 'cookie', 'react-router'],
    },
  },
}));
