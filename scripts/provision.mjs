#!/usr/bin/env node
/**
 * Provision the ASSAY catalog into its Shopify store.
 *
 *   node scripts/provision.mjs
 *
 * Idempotent: every step asks Shopify what already exists and reports
 * "created" or "existing". Re-running creates nothing new.
 *
 * Modelling:
 *   - Vendor MAP policy is a metaobject (`assay_vendor`, handle = the vendor handle): shared by every
 *     product of the vendor and edited once.
 *   - Per-variant MAP protection is a variant metafield `custom.map_protected`.
 *   - Products point at their vendor through the product metafield
 *     `custom.vendor_profile` (metaobject_reference).
 *   - The same terms are mirrored onto each product as `custom.map_terms` (json,
 *     {"policy","floor_pct"}). The checkout Function cannot follow a metaobject
 *     reference (its input schema has no `reference` on Metafield, and the
 *     `metaobject` root field only serves app-owned `$app` metaobjects), so it
 *     reads this mirror. The mirror is derived from the catalog on every run and
 *     corrected when it differs.
 *
 * Every definition is created with `access.storefront = PUBLIC_READ`. A
 * definition left at its default looks identical in the admin and is invisible
 * to the Storefront API, so existing definitions are checked and repaired too.
 *
 * Needs SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION and SHOPIFY_ADMIN_TOKEN
 * (read from .env when present). Tokens are never printed.
 */
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const {SHOPIFY_STORE_DOMAIN: domain, SHOPIFY_API_VERSION: version, SHOPIFY_ADMIN_TOKEN: token} =
  process.env;
for (const [k, v] of Object.entries({
  SHOPIFY_STORE_DOMAIN: domain,
  SHOPIFY_API_VERSION: version,
  SHOPIFY_ADMIN_TOKEN: token,
})) {
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
}

const catalog = JSON.parse(readFileSync(join(root, 'data/catalog.json'), 'utf8'));
const VENDOR_TYPE = 'assay_vendor';
const PUBLIC_READ = {storefront: 'PUBLIC_READ'};

async function admin(query, variables = {}) {
  const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-shopify-access-token': token},
    body: JSON.stringify({query, variables}),
  });
  if (!res.ok) throw new Error(`Admin API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Admin API: ${JSON.stringify(json.errors.map((e) => e.message))}`);
  }
  return json.data;
}

function check(label, userErrors) {
  if (userErrors?.length) {
    const detail = userErrors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ');
    throw new Error(`${label}: ${detail}`);
  }
}

const tally = {created: 0, existing: 0};
function report(kind, name, state, note = '') {
  tally[state === 'created' ? 'created' : 'existing'] += 1;
  console.log(`${state.padEnd(9)} ${kind.padEnd(22)} ${name}${note ? `  (${note})` : ''}`);
}

// ---------------------------------------------------------------- metaobject definition
async function ensureVendorDefinition() {
  const data = await admin(
    `query($type: String!) {
      metaobjectDefinitionByType(type: $type) { id access { storefront } }
    }`,
    {type: VENDOR_TYPE},
  );
  const found = data.metaobjectDefinitionByType;
  if (found) {
    if (found.access?.storefront !== 'PUBLIC_READ') {
      const r = await admin(
        `mutation($id: ID!, $def: MetaobjectDefinitionUpdateInput!) {
          metaobjectDefinitionUpdate(id: $id, definition: $def) { userErrors { field message } }
        }`,
        {id: found.id, def: {access: PUBLIC_READ}},
      );
      check('metaobjectDefinitionUpdate', r.metaobjectDefinitionUpdate.userErrors);
      report('metaobject definition', VENDOR_TYPE, 'existing', 'storefront access repaired');
    } else {
      report('metaobject definition', VENDOR_TYPE, 'existing');
    }
    return found.id;
  }
  const r = await admin(
    `mutation($def: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $def) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }`,
    {
      def: {
        type: VENDOR_TYPE,
        name: 'ASSAY vendor',
        displayNameKey: 'name',
        access: PUBLIC_READ,
        fieldDefinitions: [
          {key: 'name', name: 'Name', type: 'single_line_text_field', required: true},
          {key: 'positioning', name: 'Positioning', type: 'multi_line_text_field'},
          {
            key: 'map_policy',
            name: 'MAP policy',
            type: 'single_line_text_field',
            required: true,
            validations: [
              {name: 'choices', value: JSON.stringify(['none', 'floor', 'partial', 'open'])},
            ],
          },
          {
            key: 'map_floor_pct',
            name: 'MAP floor (max discount, % off list)',
            type: 'number_integer',
            validations: [
              {name: 'min', value: '0'},
              {name: 'max', value: '100'},
            ],
          },
        ],
      },
    },
  );
  check('metaobjectDefinitionCreate', r.metaobjectDefinitionCreate.userErrors);
  report('metaobject definition', VENDOR_TYPE, 'created');
  return r.metaobjectDefinitionCreate.metaobjectDefinition.id;
}

// ---------------------------------------------------------------- metafield definitions
async function ensureMetafieldDefinition(spec) {
  const {ownerType, namespace, key} = spec;
  const data = await admin(
    `query($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
      metafieldDefinitions(ownerType: $ownerType, namespace: $namespace, key: $key, first: 1) {
        nodes { id access { storefront } }
      }
    }`,
    {ownerType, namespace, key},
  );
  const name = `${ownerType.toLowerCase()} ${namespace}.${key}`;
  const found = data.metafieldDefinitions.nodes[0];
  if (found) {
    if (found.access?.storefront !== 'PUBLIC_READ') {
      const r = await admin(
        `mutation($def: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(definition: $def) { userErrors { field message } }
        }`,
        {def: {ownerType, namespace, key, access: PUBLIC_READ}},
      );
      check('metafieldDefinitionUpdate', r.metafieldDefinitionUpdate.userErrors);
      report('metafield definition', name, 'existing', 'storefront access repaired');
    } else {
      report('metafield definition', name, 'existing');
    }
    return;
  }
  const r = await admin(
    `mutation($def: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $def) {
        createdDefinition { id }
        userErrors { field message }
      }
    }`,
    {def: {...spec, access: PUBLIC_READ}},
  );
  check('metafieldDefinitionCreate', r.metafieldDefinitionCreate.userErrors);
  report('metafield definition', name, 'created');
}

// ---------------------------------------------------------------- vendor entries
async function ensureVendors() {
  const data = await admin(
    `query($type: String!) { metaobjects(type: $type, first: 50) { nodes { id handle } } }`,
    {type: VENDOR_TYPE},
  );
  const byHandle = new Map(data.metaobjects.nodes.map((n) => [n.handle, n.id]));
  for (const v of catalog.vendors) {
    if (byHandle.has(v.handle)) {
      report('vendor entry', v.handle, 'existing');
      continue;
    }
    const fields = [
      {key: 'name', value: v.name},
      {key: 'positioning', value: v.positioning},
      {key: 'map_policy', value: v.map_policy},
    ];
    if (v.map_floor_pct != null) fields.push({key: 'map_floor_pct', value: String(v.map_floor_pct)});
    const r = await admin(
      `mutation($mo: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $mo) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`,
      {mo: {type: VENDOR_TYPE, handle: v.handle, fields}},
    );
    check('metaobjectCreate', r.metaobjectCreate.userErrors);
    byHandle.set(v.handle, r.metaobjectCreate.metaobject.id);
    report('vendor entry', v.handle, 'created');
  }
  return byHandle;
}

// ---------------------------------------------------------------- publications
async function findPublications() {
  const data = await admin(`{ publications(first: 25) { nodes { id name } } }`);
  const all = data.publications.nodes;
  const wanted = [];
  for (const name of ['Online Store', 'Headless']) {
    const p = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (p) wanted.push(p);
    else console.log(`note      publication "${name}" does not exist in this store; skipped`);
  }
  return wanted;
}

// ---------------------------------------------------------------- products
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (cents) => (cents / 100).toFixed(2);

async function listExistingProducts(publications) {
  const pubFields = publications
    .map((p, i) => `p${i}: publishedOnPublication(publicationId: "${p.id}")`)
    .join('\n');
  const found = new Map();
  let after = null;
  for (;;) {
    const data = await admin(
      `query($after: String) {
        products(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle ${pubFields} }
        }
      }`,
      {after},
    );
    for (const n of data.products.nodes) found.set(n.handle, n);
    if (!data.products.pageInfo.hasNextPage) return found;
    after = data.products.pageInfo.endCursor;
  }
}

function productInput(p, vendorIds) {
  const vendor = catalog.vendors.find((v) => v.handle === p.vendor);
  return {
    handle: p.handle,
    title: p.title,
    vendor: vendor.name,
    productType: p.category,
    descriptionHtml: `<p>${esc(p.description)}</p>`,
    status: 'ACTIVE',
    productOptions: [{name: 'Size', values: p.variants.map((v) => ({name: v.title}))}],
    metafields: [
      {
        namespace: 'custom',
        key: 'vendor_profile',
        type: 'metaobject_reference',
        value: vendorIds.get(p.vendor),
      },
      {
        namespace: 'custom',
        key: 'assay_panel',
        type: 'list.single_line_text_field',
        value: JSON.stringify(p.assay_panel),
      },
    ],
    variants: p.variants.map((v) => {
      const variant = {
        optionValues: [{optionName: 'Size', name: v.title}],
        price: money(v.price_cents),
        inventoryItem: {sku: v.sku, tracked: false},
      };
      if (typeof v.map_protected === 'boolean') {
        variant.metafields = [
          {namespace: 'custom', key: 'map_protected', type: 'boolean', value: String(v.map_protected)},
        ];
      }
      return variant;
    }),
  };
}

async function ensureProducts(vendorIds, publications) {
  const existing = await listExistingProducts(publications);
  for (const p of catalog.products) {
    let node = existing.get(p.handle);
    if (node) {
      report('product', p.handle, 'existing');
    } else {
      const r = await admin(
        `mutation($input: ProductSetInput!) {
          productSet(input: $input, synchronous: true) {
            product { id handle }
            userErrors { field message code }
          }
        }`,
        {input: productInput(p, vendorIds)},
      );
      check(`productSet ${p.handle}`, r.productSet.userErrors);
      node = {id: r.productSet.product.id};
      report('product', p.handle, 'created', `${p.variants.length} variants`);
    }
    // Publish to each channel the product is not yet on.
    for (const [i, pub] of publications.entries()) {
      if (node[`p${i}`] === true) continue;
      const r = await admin(
        `mutation($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
        {id: node.id, input: [{publicationId: pub.id}]},
      );
      check(`publishablePublish ${p.handle}`, r.publishablePublish.userErrors);
      report('publication', `${p.handle} -> ${pub.name}`, 'created');
    }
  }
}

// ---------------------------------------------------------------- MAP terms mirror
/** The value the checkout Function reads from `custom.map_terms`. */
function mapTermsFor(p) {
  const terms = {policy: p.map_policy};
  if (p.map_policy === 'floor') terms.floor_pct = p.map_floor_pct;
  return terms;
}

async function syncMapTerms() {
  const current = new Map();
  let after = null;
  for (;;) {
    const data = await admin(
      `query($after: String) {
        products(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle mapTerms: metafield(namespace: "custom", key: "map_terms") { value } }
        }
      }`,
      {after},
    );
    for (const n of data.products.nodes) current.set(n.handle, n);
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
  const stale = [];
  for (const p of catalog.products) {
    const node = current.get(p.handle);
    if (!node) continue;
    const want = JSON.stringify(mapTermsFor(p));
    let have = null;
    try {
      have = node.mapTerms ? JSON.stringify(JSON.parse(node.mapTerms.value)) : null;
    } catch {
      have = null;
    }
    if (have === want) {
      report('map terms mirror', p.handle, 'existing');
    } else {
      stale.push({
        ownerId: node.id,
        namespace: 'custom',
        key: 'map_terms',
        type: 'json',
        value: want,
      });
      report('map terms mirror', p.handle, 'created', have ? 'corrected' : '');
    }
  }
  // metafieldsSet accepts at most 25 metafields per call.
  for (let i = 0; i < stale.length; i += 25) {
    const r = await admin(
      `mutation($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) { userErrors { field message } }
      }`,
      {m: stale.slice(i, i + 25)},
    );
    check('metafieldsSet map_terms', r.metafieldsSet.userErrors);
  }
}

// ---------------------------------------------------------------- main
const definitionId = await ensureVendorDefinition();
await ensureMetafieldDefinition({
  ownerType: 'PRODUCT',
  namespace: 'custom',
  key: 'vendor_profile',
  name: 'Vendor profile',
  type: 'metaobject_reference',
  validations: [{name: 'metaobject_definition_id', value: definitionId}],
});
await ensureMetafieldDefinition({
  ownerType: 'PRODUCT',
  namespace: 'custom',
  key: 'assay_panel',
  name: 'Assay panel',
  type: 'list.single_line_text_field',
});
await ensureMetafieldDefinition({
  ownerType: 'PRODUCTVARIANT',
  namespace: 'custom',
  key: 'map_protected',
  name: 'MAP protected',
  type: 'boolean',
});
await ensureMetafieldDefinition({
  ownerType: 'PRODUCT',
  namespace: 'custom',
  key: 'map_terms',
  name: 'MAP terms (mirror for checkout)',
  type: 'json',
});
const vendorIds = await ensureVendors();
const publications = await findPublications();
await ensureProducts(vendorIds, publications);
await syncMapTerms();
console.log(`\nDone: ${tally.created} created, ${tally.existing} existing.`);
