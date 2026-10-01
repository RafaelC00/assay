import {index, route, type RouteConfig} from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('collections/all', 'routes/collection.tsx'),
  route('products/:handle', 'routes/product.tsx'),
  route('status', 'routes/status.tsx'),
  route('api/vitals', 'routes/api.vitals.ts'),
] satisfies RouteConfig;
