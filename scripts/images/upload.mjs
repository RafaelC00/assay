#!/usr/bin/env node
/**
 * Upload the product masters from scripts/images/out/ to Shopify and attach
 * each to its product, so the images reach the storefront through the
 * Storefront API like the rest of the catalog.
 *
 *   node scripts/images/upload.mjs
 *
 * Idempotent. The file name carries a hash of the content
 * (assay-<handle>-<sha>.jpg), so a re-run finds the image already attached and
 * does nothing, an edited image uploads once and the superseded one is removed
 * from that product, and a product never ends up with duplicates.
 *
 * Needs SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION and SHOPIFY_ADMIN_TOKEN
 * (write_products, write_files) from .env. The token is never printed.
 */
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const {SHOPIFY_STORE_DOMAIN: domain, SHOPIFY_API_VERSION: version, SHOPIFY_ADMIN_TOKEN: token} = process.env;
if (!domain || !version || !token) {
  console.error('Missing SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION or SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(here, 'out', 'manifest.json'), 'utf8'));

async function admin(query, variables = {}) {
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-shopify-access-token': token},
    body: JSON.stringify({query, variables}),
  });
  if (!res.ok) throw new Error(`Admin API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Admin API: ${JSON.stringify(json.errors.map((e) => e.message))}`);
  return json.data;
}
const fail = (label, errs) => {
  if (errs?.length) {
    throw new Error(`${label}: ${errs.map((e) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileOf = (url) => decodeURIComponent((url ?? '').split('?')[0].split('/').pop() ?? '');

const data = await admin(`{
  products(first: 100) {
    nodes { id handle media(first: 20) { nodes { id alt status ... on MediaImage { image { url } } } } }
  }
}`);
const byHandle = new Map(data.products.nodes.map((p) => [p.handle, p]));

let uploaded = 0;
let existing = 0;
let removed = 0;
for (const [handle, m] of Object.entries(manifest)) {
  const product = byHandle.get(handle);
  if (!product) {
    console.log(`missing   ${handle} (no such product)`);
    continue;
  }
  const stem = `assay-${handle}-${m.sha}`;
  const name = `${stem}.jpg`;
  const mine = product.media.nodes.filter((n) => fileOf(n.image?.url).startsWith(`assay-${handle}-`));
  const current = mine.find((n) => fileOf(n.image?.url).startsWith(stem));

  if (!current) {
    const bytes = readFileSync(join(here, 'out', m.file));
    const staged = (
      await admin(
        `mutation($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }`,
        {
          input: [
            {resource: 'PRODUCT_IMAGE', filename: name, mimeType: 'image/jpeg', httpMethod: 'POST', fileSize: String(bytes.length)},
          ],
        },
      )
    ).stagedUploadsCreate;
    fail('stagedUploadsCreate', staged.userErrors);
    const target = staged.stagedTargets[0];
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append('file', new Blob([bytes], {type: 'image/jpeg'}), name);
    const up = await fetch(target.url, {method: 'POST', body: form});
    if (!up.ok) throw new Error(`upload ${name}: HTTP ${up.status}`);

    const created = (
      await admin(
        `mutation($id: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $id, media: $media) {
            media { id status }
            mediaUserErrors { field message }
          }
        }`,
        {id: product.id, media: [{originalSource: target.resourceUrl, alt: m.alt, mediaContentType: 'IMAGE'}]},
      )
    ).productCreateMedia;
    fail('productCreateMedia', created.mediaUserErrors);
    const mediaId = created.media[0].id;

    // Wait until Shopify has processed it, so the storefront never serves a half-made image.
    for (let i = 0; i < 40; i++) {
      const s = (await admin(`query($id: ID!) { node(id: $id) { ... on MediaImage { status } } }`, {id: mediaId})).node
        ?.status;
      if (s === 'READY') break;
      if (s === 'FAILED') throw new Error(`media processing failed for ${name}`);
      await sleep(1500);
    }
    // First position makes it the product's featured image.
    const moved = (
      await admin(
        `mutation($id: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $id, moves: $moves) { userErrors { field message } }
        }`,
        {id: product.id, moves: [{id: mediaId, newPosition: '0'}]},
      )
    ).productReorderMedia;
    fail('productReorderMedia', moved.userErrors);
    console.log(`uploaded  ${handle}  ${name}`);
    uploaded += 1;
  } else {
    existing += 1;
    console.log(`existing  ${handle}`);
    if (current.alt !== m.alt) {
      const r = (
        await admin(
          `mutation($id: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $id, media: $media) { mediaUserErrors { field message } }
          }`,
          {id: product.id, media: [{id: current.id, alt: m.alt}]},
        )
      ).productUpdateMedia;
      fail('productUpdateMedia', r.mediaUserErrors);
      console.log('          alt text updated');
    }
  }

  // Remove superseded masters for this product (same prefix, different hash).
  const stale = mine.filter((n) => n !== current && !fileOf(n.image?.url).startsWith(stem));
  if (stale.length) {
    const r = (
      await admin(
        `mutation($id: ID!, $ids: [ID!]!) {
          productDeleteMedia(productId: $id, mediaIds: $ids) { mediaUserErrors { field message } }
        }`,
        {id: product.id, ids: stale.map((n) => n.id)},
      )
    ).productDeleteMedia;
    fail('productDeleteMedia', r.mediaUserErrors);
    removed += stale.length;
    console.log(`removed   ${stale.length} superseded image(s) from ${handle}`);
  }
}
console.log(`\n${uploaded} uploaded, ${existing} already present, ${removed} superseded removed`);
