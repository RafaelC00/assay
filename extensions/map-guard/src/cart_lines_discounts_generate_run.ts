import {mapPriceCents, type RawMapTerms} from './map-rule';

/**
 * Minimal shapes for the parts of the generated input/result types this
 * function uses. They mirror the Discount Function API schema for
 * `cart.lines.discounts.generate.run`; the generated `../generated/api` types
 * are produced by the CLI inside a deployed app, so they are not imported here.
 */
export interface RunInput {
  cart: {
    lines: Array<{
      id: string;
      cost: {amountPerQuantity: {amount: string}};
      merchandise:
        | {
            __typename: 'ProductVariant';
            mapProtected?: {value: string} | null;
            product: {mapTerms?: {jsonValue: unknown} | null};
          }
        | {__typename: string};
    }>;
  };
  discount: {
    discountClasses: string[];
    metafield?: {jsonValue: unknown} | null;
  };
}

export interface RunResult {
  operations: Array<{
    productDiscountsAdd: {
      selectionStrategy: 'ALL';
      candidates: Array<{
        message: string;
        targets: Array<{cartLine: {id: string}}>;
        value: {fixedAmount: {amount: string; appliesToEachItem: true}};
      }>;
    };
  }>;
}

const NONE: RunResult = {operations: []};

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Mirrors `custom.map_terms` ({policy, floor_pct}) plus the variant flag. */
function readTerms(line: RunInput['cart']['lines'][number]): RawMapTerms {
  const m = line.merchandise;
  if (m.__typename !== 'ProductVariant' || !('product' in m)) return {};
  const t = asRecord(m.product.mapTerms?.jsonValue);
  const flag = m.mapProtected?.value;
  return {
    policy: t.policy,
    floorPct: t.floor_pct,
    // Only an explicit "false" unprotects a SKU; absent or unreadable is protected.
    protected: flag === 'false' ? false : flag === 'true' ? true : undefined,
  };
}

export function cartLinesDiscountsGenerateRun(input: RunInput): RunResult {
  if (!input.discount.discountClasses.includes('PRODUCT')) return NONE;

  const config = asRecord(input.discount.metafield?.jsonValue);
  const percentOff = config.percentOff;
  if (typeof percentOff !== 'number' || !(percentOff > 0)) return NONE;
  const message = typeof config.name === 'string' && config.name ? config.name : 'Sale';

  const candidates: RunResult['operations'][number]['productDiscountsAdd']['candidates'] = [];
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== 'ProductVariant') continue;
    const list = Math.round(Number(line.cost.amountPerQuantity.amount) * 100);
    if (!Number.isInteger(list) || list <= 0) continue;
    const off = list - mapPriceCents(list, percentOff, readTerms(line));
    if (off <= 0) continue;
    candidates.push({
      message,
      targets: [{cartLine: {id: line.id}}],
      value: {fixedAmount: {amount: (off / 100).toFixed(2), appliesToEachItem: true}},
    });
  }

  if (candidates.length === 0) return NONE;
  return {operations: [{productDiscountsAdd: {selectionStrategy: 'ALL', candidates}}]};
}
