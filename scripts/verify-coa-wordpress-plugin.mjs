import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefrontManifest = readFileSync("src/components/data/coa-source-truth.json", "utf8");
const wordpressManifest = readFileSync("wordpress-plugin/rgv-coa-library/data/coa-source-truth.json", "utf8");
const plugin = readFileSync("wordpress-plugin/rgv-coa-library/rgv-coa-library.php", "utf8");
const migration = readFileSync("wordpress-plugin/rgv-coa-library/includes/class-rgv-coa-migration.php", "utf8");
const rest = readFileSync("wordpress-plugin/rgv-coa-library/includes/class-rgv-coa-rest-api.php", "utf8");
const admin = readFileSync("wordpress-plugin/rgv-coa-library/includes/class-rgv-coa-admin.php", "utf8");
const pluginZip = readFileSync("wordpress-plugin/rgv-coa-library-1.12.0.zip");

function zipEntryNames(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const names = [];
  let offset = 0;

  while ((offset = buffer.indexOf(signature, offset)) !== -1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

assert.equal(wordpressManifest, storefrontManifest, "WordPress and storefront must use the same manifest");
assert.match(plugin, /Version:\s*1\.12\.0/);
assert.match(plugin, /class-rgv-coa-integrity\.php/);
assert.match(plugin, /class-rgv-coa-migration\.php/);
assert.ok(
  migration.indexOf("$backup_key = self::snapshot()") < migration.indexOf("foreach ($manifest['records']"),
  "migration must snapshot all records before its first update",
);
assert.match(migration, /hash_equals\(\$expected_hash, strtolower\(\$actual_hash\)\)/);
for (const field of [
  "product_name",
  "compound_name",
  "aliases",
  "sku",
  "batch",
  "lab",
  "sample_id",
  "received_date",
  "test_date",
  "report_date",
  "purity",
  "analytes",
  "tests",
  "results",
  "notes",
  "pdf_url",
  "is_current",
]) {
  assert.match(rest, new RegExp(`['\"]${field}['\"]`), `REST schema is missing ${field}`);
}
assert.match(admin, /valid_purity/);
assert.match(admin, /valid_sample_id/);
assert.match(admin, /remove_analyte_aliases/);

const zipEntries = zipEntryNames(pluginZip);
assert.ok(zipEntries.length > 0, "plugin ZIP must contain entries");
assert.ok(
  zipEntries.every((name) => name.startsWith("rgv-coa-library/") && !name.includes("\\")),
  "plugin ZIP entries must use portable forward-slash paths under rgv-coa-library/",
);
assert.ok(
  zipEntries.includes("rgv-coa-library/rgv-coa-library.php"),
  "plugin ZIP must contain its main file at the expected WordPress path",
);

console.log("WordPress COA storage/migration checks passed");
