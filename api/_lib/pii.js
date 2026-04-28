// Application-level PII helpers.
//
// Two concerns this module addresses:
//
// 1. **Column encryption (opt-in).** AES-256-GCM with a key from the
//    PII_ENCRYPTION_KEY env var. Output is a base64 string of
//    [12-byte nonce | 16-byte tag | ciphertext], so a single TEXT column
//    holds the whole package and we don't need a separate iv column.
//    No columns use this *yet* — the helpers exist for future opt-in on
//    fields that warrant operator-blind encryption (free-text notes,
//    secondary contact data, etc.) without another round of migrations.
//
// 2. **Anonymization for GDPR delete.** redactRecord() takes a row and a
//    list of PII columns, returning a copy with each column replaced by a
//    deterministic placeholder ("[redacted]" for strings, null for the
//    rest). Used by /api/admin/gdpr/delete so audit_log can keep its
//    historical references without retaining the original values.
//
// PII_ENCRYPTION_KEY must be exactly 32 bytes (base64-decoded). If the var
// is missing, encrypt/decrypt throw — call sites should guard or wrap in a
// configuration check.

import crypto from "node:crypto";

const ALG = "aes-256-gcm";

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.PII_ENCRYPTION_KEY || "";
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not configured.");
  // Accept either base64 (preferred) or 64-char hex.
  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    buf = Buffer.from(raw, "base64");
  }
  if (buf.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).");
  }
  cachedKey = buf;
  return cachedKey;
}

export function piiConfigured() {
  try { getKey(); return true; } catch { return false; }
}

export function encryptPii(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptPii(packaged) {
  if (packaged == null) return null;
  const key = getKey();
  const buf = Buffer.from(String(packaged), "base64");
  if (buf.length < 28) throw new Error("Ciphertext too short.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

const REDACTED = "[redacted]";

export function redactRecord(row, fields) {
  const out = { ...row };
  const touched = {};
  for (const f of fields) {
    if (!(f in out)) continue;
    const original = out[f];
    if (original == null) continue;
    out[f] = typeof original === "string" ? REDACTED : null;
    touched[f] = true;
  }
  return { row: out, touched };
}

// Per-table encryption config used by the /api/db proxy. Adding a column
// here makes future writes through the proxy encrypted at rest, and reads
// transparently decrypted on the way out. NEVER add a column that is also
// queried with `ilike.` filters (e.g. customer_interactions.body, which
// the GDPR export searches by email substring) — encryption breaks that.
//
// Encryption only activates when PII_ENCRYPTION_KEY is configured. Without
// the key the proxy is a no-op; legacy plaintext values keep working
// because decryptIfPossible() falls back to the original value when the
// payload doesn't look like a sealed envelope.
export const PII_COLUMNS = {
  customers: ["notes"],
};

const ENVELOPE_PREFIX = "pii:v1:";

// Wrap encrypted output with a tag so the read path can recognize values
// that need decryption versus plaintext rows written before encryption was
// turned on. Removing the tag is harmless — decryptIfPossible() will fall
// through to plaintext rather than throwing.
function sealEnvelope(packaged) {
  return ENVELOPE_PREFIX + packaged;
}
function isSealedEnvelope(value) {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

export function encryptIfConfigured(value) {
  if (value == null || typeof value !== "string" || value.length === 0) return value;
  if (isSealedEnvelope(value)) return value;
  if (!piiConfigured()) return value;
  try { return sealEnvelope(encryptPii(value)); } catch { return value; }
}

export function decryptIfPossible(value) {
  if (!isSealedEnvelope(value)) return value;
  if (!piiConfigured()) return value;
  try { return decryptPii(value.slice(ENVELOPE_PREFIX.length)); } catch { return value; }
}

// Mutates the row in place: every column listed in PII_COLUMNS[table] is
// encrypted before writing. Safe on partial PATCH payloads (only touches
// fields actually present).
export function encryptRowInPlace(table, row) {
  if (!row || typeof row !== "object") return row;
  const cols = PII_COLUMNS[table];
  if (!cols || !cols.length) return row;
  for (const col of cols) {
    if (col in row) row[col] = encryptIfConfigured(row[col]);
  }
  return row;
}

export function decryptRowInPlace(table, row) {
  if (!row || typeof row !== "object") return row;
  const cols = PII_COLUMNS[table];
  if (!cols || !cols.length) return row;
  for (const col of cols) {
    if (col in row) row[col] = decryptIfPossible(row[col]);
  }
  return row;
}
