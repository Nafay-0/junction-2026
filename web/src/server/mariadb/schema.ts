import type { Maria } from "./client";

/**
 * The time machine's tables. Each `gate_*` table holds what the gate (src/core/policy.ts) and the door in front of
 * it read when they judge an order, one row per thing in force, and is declared WITH SYSTEM VERSIONING: the
 * application only ever inserts, updates and deletes current rows, and MariaDB itself keeps every earlier version
 * with the moment it stopped being true (ROW_START, ROW_END). Nothing here is written to by an order: the mirror
 * (mirror.ts) copies state after the fact.
 *
 * Columns marked WITHOUT SYSTEM VERSIONING change without making history: the demo kitchens re-sign the same mandate
 * terms every day under a new id and validity window, and that is not a change of rule. Only the terms are versioned.
 *
 * `writer` names who keeps a row (the app process, or the seeded scenario), so the app's mirror never deletes rows
 * the reproduction seeded into the same database, and the other way round.
 */
export const VECTOR_DIMS = 1536; // OpenAI text-embedding-3-small

export const TABLES = ["gate_mandate", "gate_kitchen_rule", "gate_product_hold", "gate_suspension", "gate_budget", "gate_order", "gate_order_body", "gate_decision", "mirror_meta"] as const;

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS gate_mandate (
    agent_id VARCHAR(100) NOT NULL PRIMARY KEY,
    org_id VARCHAR(100) NOT NULL,
    org_name VARCHAR(200) NOT NULL,
    per_order_limit_cents BIGINT NOT NULL,
    weekly_budget_cents BIGINT NOT NULL,
    allowed_categories JSON NOT NULL,
    required_attributes JSON NOT NULL,
    forbidden_allergens JSON NOT NULL,
    required_certificates JSON NOT NULL,
    max_lead_days INT NOT NULL,
    substitution_rule VARCHAR(30) NOT NULL,
    max_sub_increase_pct DOUBLE NOT NULL,
    approvers JSON NOT NULL,
    issued_as VARCHAR(160) NOT NULL COMMENT 'the mandate id under which these terms were first presented',
    changed_by VARCHAR(240) NOT NULL,
    mandate_id VARCHAR(160) NOT NULL WITHOUT SYSTEM VERSIONING COMMENT 'latest id presented with these terms',
    valid_from DATETIME(6) NOT NULL WITHOUT SYSTEM VERSIONING,
    valid_until DATETIME(6) NOT NULL WITHOUT SYSTEM VERSIONING,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING,
    KEY (org_id)
  ) WITH SYSTEM VERSIONING`,
  `CREATE TABLE IF NOT EXISTS gate_kitchen_rule (
    org_id VARCHAR(100) NOT NULL,
    rule_id VARCHAR(160) NOT NULL,
    strength VARCHAR(20) NOT NULL COMMENT 'rule: constrains what is offered; habit: only pre-selects',
    kind VARCHAR(40) NOT NULL,
    family VARCHAR(80) NULL,
    text VARCHAR(600) NOT NULL,
    fact JSON NOT NULL,
    changed_by VARCHAR(240) NOT NULL,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING,
    PRIMARY KEY (org_id, rule_id)
  ) WITH SYSTEM VERSIONING`,
  `CREATE TABLE IF NOT EXISTS gate_product_hold (
    hold_id VARCHAR(100) NOT NULL PRIMARY KEY,
    product_id VARCHAR(80) NOT NULL,
    product_name VARCHAR(300) NOT NULL,
    reason TEXT NOT NULL,
    notice_url VARCHAR(600) NOT NULL,
    drill BOOLEAN NOT NULL,
    status VARCHAR(10) NOT NULL COMMENT 'held | lifted',
    changed_by VARCHAR(240) NOT NULL,
    change_note VARCHAR(600) NULL,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING,
    KEY (product_id)
  ) WITH SYSTEM VERSIONING`,
  `CREATE TABLE IF NOT EXISTS gate_suspension (
    suspension_id VARCHAR(100) NOT NULL PRIMARY KEY,
    scope VARCHAR(10) NOT NULL COMMENT 'agent | org',
    target VARCHAR(100) NOT NULL,
    org_id VARCHAR(100) NOT NULL,
    label VARCHAR(240) NOT NULL,
    reason VARCHAR(600) NOT NULL,
    status VARCHAR(10) NOT NULL COMMENT 'active | resumed',
    changed_by VARCHAR(240) NOT NULL,
    change_note VARCHAR(600) NULL,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING,
    KEY (org_id)
  ) WITH SYSTEM VERSIONING`,
  `CREATE TABLE IF NOT EXISTS gate_budget (
    org_id VARCHAR(100) NOT NULL PRIMARY KEY,
    committed_cents BIGINT NOT NULL COMMENT 'committed orders of the last 7 days',
    held_cents BIGINT NOT NULL COMMENT 'held by orders waiting for sign-off',
    week_orders JSON NOT NULL COMMENT 'the orders behind the two sums: id, total, status',
    orders_in_week INT NOT NULL,
    changed_by VARCHAR(240) NOT NULL,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING
  ) WITH SYSTEM VERSIONING`,
  `CREATE TABLE IF NOT EXISTS gate_order (
    order_id VARCHAR(100) NOT NULL PRIMARY KEY,
    org_id VARCHAR(100) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    request_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    outcome VARCHAR(30) NOT NULL,
    authorised_by VARCHAR(10) NOT NULL COMMENT 'mandate | approver | pending | none',
    total_cents BIGINT NOT NULL,
    categories JSON NOT NULL,
    delivery_dates JSON NOT NULL,
    created_at DATETIME(6) NOT NULL,
    changed_by VARCHAR(240) NOT NULL,
    writer VARCHAR(80) NOT NULL WITHOUT SYSTEM VERSIONING,
    KEY (org_id, created_at)
  ) WITH SYSTEM VERSIONING`,
  // The order as it was put to the gate: never changes, so not versioned.
  `CREATE TABLE IF NOT EXISTS gate_order_body (
    order_id VARCHAR(100) NOT NULL PRIMARY KEY,
    org_id VARCHAR(100) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    body JSON NOT NULL,
    writer VARCHAR(80) NOT NULL
  )`,
  // The ledger's plain-language decisions with their embeddings, for "decisions like this one" (vector.ts).
  // Append-only like the ledger, so not versioned; the rules each was judged under come from the versioned tables.
  `CREATE TABLE IF NOT EXISTS gate_decision (
    entry_hash CHAR(64) NOT NULL PRIMARY KEY COMMENT 'the ledger entry hash: the chain is the identity',
    writer VARCHAR(80) NOT NULL,
    seq INT NOT NULL,
    at DATETIME(6) NOT NULL,
    org_id VARCHAR(100) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100) NULL,
    outcome VARCHAR(30) NOT NULL,
    rules_hit VARCHAR(400) NOT NULL COMMENT 'rules that refused or escalated, comma-separated',
    explanation TEXT NOT NULL,
    embedding VECTOR(${VECTOR_DIMS}) NOT NULL,
    KEY (org_id, at),
    VECTOR INDEX (embedding) M=8 DISTANCE=cosine,
    FULLTEXT (explanation)
  )`,
  // Which door the decision's request came through (core/orders.ts Door); added after the first schema.
  `ALTER TABLE gate_decision ADD COLUMN IF NOT EXISTS door VARCHAR(20) NULL AFTER order_id`,
  `CREATE TABLE IF NOT EXISTS mirror_meta (
    writer VARCHAR(80) NOT NULL PRIMARY KEY,
    last_ok_at DATETIME(6) NULL,
    last_error VARCHAR(600) NULL,
    note VARCHAR(600) NULL
  )`,
  // Everything the gate reads, as one relation. FOR SYSTEM_TIME applied to the view reaches every table under it, so
  // "the rules as they stood at 09.30 on 20.10." is one statement: SELECT … FROM gate_rules FOR SYSTEM_TIME AS OF ….
  `CREATE OR REPLACE VIEW gate_rules AS
    SELECT 'mandate' AS area, org_id, agent_id AS item, 1 AS in_force,
      JSON_OBJECT('orgName', org_name, 'perOrderLimitCents', per_order_limit_cents, 'weeklyBudgetCents', weekly_budget_cents,
        'allowedCategories', JSON_QUERY(allowed_categories, '$'), 'requiredAttributes', JSON_QUERY(required_attributes, '$'),
        'forbiddenAllergens', JSON_QUERY(forbidden_allergens, '$'), 'requiredCertificates', JSON_QUERY(required_certificates, '$'),
        'maxLeadDays', max_lead_days, 'substitutionRule', substitution_rule, 'maxPriceIncreasePct', max_sub_increase_pct,
        'approvers', JSON_QUERY(approvers, '$'), 'issuedAs', issued_as) AS value,
      changed_by, ROW_START AS since, ROW_END AS until
    FROM gate_mandate
    UNION ALL
    SELECT 'kitchen_rule', org_id, rule_id, 1,
      JSON_OBJECT('strength', strength, 'kind', kind, 'family', family, 'text', text, 'fact', JSON_QUERY(fact, '$')),
      changed_by, ROW_START, ROW_END
    FROM gate_kitchen_rule
    UNION ALL
    SELECT 'hold', '*', hold_id, status = 'held',
      JSON_OBJECT('productId', product_id, 'productName', product_name, 'reason', reason, 'noticeUrl', notice_url, 'drill', drill IS TRUE, 'status', status, 'note', change_note),
      changed_by, ROW_START, ROW_END
    FROM gate_product_hold
    UNION ALL
    SELECT 'suspension', org_id, suspension_id, status = 'active',
      JSON_OBJECT('scope', scope, 'target', target, 'label', label, 'reason', reason, 'status', status, 'note', change_note),
      changed_by, ROW_START, ROW_END
    FROM gate_suspension
    UNION ALL
    SELECT 'budget', org_id, org_id, 1,
      JSON_OBJECT('committedCents', committed_cents, 'heldCents', held_cents, 'weekOrders', JSON_QUERY(week_orders, '$'), 'ordersInWeek', orders_in_week),
      changed_by, ROW_START, ROW_END
    FROM gate_budget`,
];

export async function ensureSchema(db: Maria): Promise<void> {
  for (const sql of SCHEMA) await db.query(sql);
}

/** Drop everything, history included. Only the reproduction calls this, on a database it owns. */
export async function dropSchema(db: Maria): Promise<void> {
  await db.query("DROP VIEW IF EXISTS gate_rules");
  for (const t of [...TABLES].reverse()) await db.query(`DROP TABLE IF EXISTS ${t}`);
}

/** The versioned tables, for the measurements (rows now, versions kept). */
export const VERSIONED = ["gate_mandate", "gate_kitchen_rule", "gate_product_hold", "gate_suspension", "gate_budget", "gate_order"] as const;
