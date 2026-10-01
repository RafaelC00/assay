import type {Config} from '@react-router/dev/config';

/**
 * Two build targets, one codebase.
 *
 * Oxygen (the default) is where a Hydrogen storefront normally runs, and
 * `server.ts` is written as a worker entry for it. Vercel needs its own
 * preset, which sets `serverBundles` and `buildEnd` and writes to
 * `.vercel/output` rather than a build directory we choose — so the two
 * configurations are mutually exclusive rather than additive.
 *
 * The import is dynamic and top-level-awaited so the Oxygen build never
 * loads the Vercel package at all. React Router's config loader does not
 * await a promise default export, so the export itself must stay a plain
 * object.
 */
const isVercel = process.env.TARGET === 'vercel' || Boolean(process.env.VERCEL);

let config: Config;

if (isVercel) {
  const {vercelPreset} = await import('@vercel/react-router/vite');
  config = {
    appDirectory: 'app',
    ssr: true,
    // These normally arrive from a framework preset. Vercel's preset does not
    // set them, and its server handler reads future.v8_middleware directly, so
    // omitting the block makes every request throw
    // "Cannot read properties of undefined (reading 'v8_middleware')" at
    // runtime while the build itself succeeds.
    future: {
      v8_middleware: true,
      v8_splitRouteModules: true,
      unstable_optimizeDeps: true,
    },
    presets: [vercelPreset()],
  };
} else {
  config = {
    appDirectory: 'app',
    buildDirectory: 'dist',
    ssr: true,
  };
}

export default config;
