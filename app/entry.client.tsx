import {startTransition, StrictMode} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {HydratedRouter} from 'react-router/dom';
import {NonceProvider} from '@shopify/hydrogen';

import {startVitalsBeacon} from '~/lib/vitals/beacon.client';

startVitalsBeacon();

startTransition(() => {
  const existingNonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
  hydrateRoot(
    document,
    <StrictMode>
      <NonceProvider value={existingNonce}>
        <HydratedRouter />
      </NonceProvider>
    </StrictMode>,
  );
});
