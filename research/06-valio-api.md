# Valio Aimo challenge: mock API and data files

Read from the resource portal (`https://junction26.valioaimo.fi/`, behind the event password) on Fri 13 Nov 2026. The four data files are downloaded to `data/valio/`, which is deliberately kept out of git: the portal says the data "must not be used for anything outside of this challenge", and our repo becomes public at submission. Ask Valio before publishing any of it.

## What exists and what does not

- There are exactly two live endpoints: **price** and **availability**. Both are read-only.
- **There is no order endpoint.** Committing an order at a fixed price, permissions and approval are ours to design. That is the challenge.
- Product search is also ours: the product file is static data we index ourselves.

## Rules stated in the API description

- Do **not** build on frequently retrieving prices or availability for all products. Narrow down from the static product data first, then query only those products.
- Undisclosed rate limits apply.
- At most 1,000 product codes per request (more returns HTTP 422).
- `customer` is required but ignored in this challenge; any string works. In reality prices and availability are customer-specific.
- The data files do not change during the event unless announced.

## Authentication

Every path under `/api` needs the header `X-API-Key`. The key is published on the Junction Platform. Keep it in `.env.local` as `VALIO_API_KEY`; base URL `https://junction26.valioaimo.fi`.

`GET /api/ping` checks the key.

## POST /api/availability

Request body (same shape for price):

```json
{ "customer": "123", "requestedDate": "2026-11-16", "products": ["460013", "460063"] }
```

Response: `timeNow` (Helsinki time), `requestedDate`, and `products[]` in request order, each with:

| Field | Meaning |
|---|---|
| `productId` | Product code |
| `closingTime` | Order cut-off: order by this time to receive goods on `availableDate` |
| `salesBlock` | true = cannot be ordered right now |
| `logisticModel` | `Stock` = Valio holds it and knows the quantity. `Terminal` = shipped from the supplier's warehouse, real quantity unknown |
| `scheduleLines[]` | Exactly one entry if available; empty = cannot be delivered on any date |
| `scheduleLines[].availableAmount` | Quantity available in `salesUnit`. Always 999999 for Terminal products. 0 = not available |
| `scheduleLines[].availableDate` | Earliest date that amount is available; may differ from the requested date |
| `scheduleLines[].salesUnit`, `.salesBlock` | Unit code; per-line block flag |

## POST /api/price

Response: `customerId`, `currency`, `pricingDate`, and `products[]`, each with:

| Field | Meaning |
|---|---|
| `quantity` | Always 1.0 (price is per one sales unit) |
| `catalogPrice` | `{value, valueWithTax, validFrom, validTo, currency}`; `value` is before tax |
| `priceWithTax` | Price including tax with its validity period |
| `comparisonPrice`, `comparisonUnit` | Price per KG or L, for comparing pack sizes |
| `tax` | `{taxRate, taxValue}` |
| `listPrice` | Price before customer-specific price or discount |
| `netPriceFound` | true = a customer-specific net price was used |
| `error` | true = no price found for the product |

Prices carry `validFrom` / `validTo`, which is the natural basis for a fixed-price quote with an expiry.

## Product data file (`valio_aimo_junction26_product_data.json`, 87 MB)

A JSON array of 17,546 products, none flagged deleted. Too large to bundle into a serverless function as is; build a slim index.

Top-level fields: `id` (the product code used everywhere), `salesUnitGtin`, `salesUnit`, `baseUnit`, `category` (349 numeric codes; `10400` is milk), `allowedLotSize`, `temperatureCondition`, `vendorName`, `countryOfOrigin`, `units[]` (`unitId`, `gtin`, `sizeInBaseUnits`), `deposits[]`, `substitutions[]` (only 196 products; `{product, substituteProduct}`), and `synkkaData`.

`synkkaData` holds the rich content: `names[]`, `marketingTexts[]`, `keyIngredients[]`, storage and usage texts (each as `{value, language}` in `en`, `fi`, `sv`), `brand`, `producers[]`, `ingredients[]`, `nutritionalContent[]`, `unitConversions[]` (case dimensions and gross weight), `vatCode`, and `classifications[]`.

**Units matter.** Sales units are codes: `KI` (case, the most common), `ST` (single piece), `KG`, `PAK`, `BAG`, `RAS`, `PRK`, `BOT`, and others. A product sold in `KI` lists how many base units the case holds, for example product `463038` (10-litre lactose-free milk box) sells in `KI` = 2 pieces. Turning "1,000 litres" into a number of sales units needs the pack volume, which is in the product name and unit data, not in one clean field. This conversion is a likely source of agent mistakes and worth testing hard.

**Dietary and allergen data** is in `synkkaData.classifications[]`:

- `nutritionalClaim`: `FREE_FROM_LACTOSE` (4,178 products), `LOW_LACTOSE`, `FREE_FROM_GLUTEN`, `VEGAN`, `VEGETARIAN`, `FREE_FROM_EGGS`, `FREE_FROM_SOY`, and others.
- `allergen` (codes with `CONTAINS`) and `nonAllergen` (codes with `FREE_FROM`).
- `packagingMarkedLabel`: certificates and labels such as `GOODS_FROM_FINLAND_BLUE_SWAN`.
- `nutritionFact`, `gda`, `mineral`, `vitamin`: numeric values.

Data quality varies by maker: packaged goods with a GTIN have precise allergen data, fresh produce often has none. Treat missing allergen data as unknown, never as safe.

About 32 products match "lactose-free milk" by Finnish name (Valio Eila and Arla lines, 2.5 dl to 10 l), so the challenge's own example has real choices in it.

## Side files

| File | Rows | Content |
|---|---|---|
| `valio_aimo_junction26_delivery_reliability.csv` | 4,425 | `productId, deliveryReliability` from 0 to 1 (mean 0.97). Share of ordered quantity historically delivered. Only a quarter of products have a value. |
| `valio_aimo_junction26_carbon_footprint.csv` | 11,033 | `productId, AVG kg CO2-eq/kg` (0.13 to 30.46). An average for the product's group, not a measurement of the product. |
| `valio_aimo_junction26_product_data_schema.json` | | JSON Schema for the product file |

Both side files use the same product codes as the product file. Say "group average" whenever a carbon figure is shown.
