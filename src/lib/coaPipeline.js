const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PURITY = /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/;

function clean(value) {
  const text = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\t ]+/g, " ")
    .trim();
  return text || null;
}

function cleanPdfLine(value) {
  return clean(String(value ?? "").replace(/\s+/g, " "));
}

function firstMatch(text, expression, group = 1) {
  const match = String(text || "").match(expression);
  return clean(match?.[group]);
}

function parseUsDate(value) {
  const match = String(value || "").match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!match) return null;
  const [, month, day, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

function normalizeComparison(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePurity(value) {
  const match = String(value || "").match(/\b(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%/);
  return match ? `${match[1]}%` : null;
}

function addTest(tests, entry) {
  const name = cleanPdfLine(entry.name);
  const result = cleanPdfLine(entry.result);
  if (!name || !result) return;

  const normalizedName = normalizeComparison(name);
  const normalizedResult = normalizeComparison(result);
  if (
    tests.some(
      (test) =>
        normalizeComparison(test.name) === normalizedName &&
        normalizeComparison(test.result) === normalizedResult,
    )
  ) {
    return;
  }

  tests.push({
    name,
    result,
    specification: cleanPdfLine(entry.specification),
    unit: cleanPdfLine(entry.unit),
    status: cleanPdfLine(entry.status),
    method: cleanPdfLine(entry.method),
  });
}

function parseIlsTests(text) {
  const tests = [];
  const linePatterns = [
    {
      expression:
        /^Peptide Purity \(HPLC\)\s+(>=?\s*\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s+%\s+(PASS|FAIL)\b/im,
      build: (match) => ({
        name: "Peptide Purity (HPLC)",
        specification: match[1],
        result: match[2],
        unit: "%",
        status: match[3],
        method: "HPLC",
      }),
    },
    {
      expression:
        /^Net Peptide Content\s+Report Only\s+(\d+(?:\.\d+)?)\s+mg\s+(N\/A|PASS|FAIL)\b/im,
      build: (match) => ({
        name: "Net Peptide Content",
        specification: "Report Only",
        result: match[1],
        unit: "mg",
        status: match[2],
        method: "HPLC",
      }),
    },
    {
      expression:
        /^Identity \(HPLC-RTM\)\s+(.+?)\s+(Confirmed|Not Confirmed)\s+-\s+(PASS|FAIL)\b/im,
      build: (match) => ({
        name: "Identity (HPLC-RTM)",
        specification: match[1],
        result: match[2],
        status: match[3],
        method: "HPLC-RTM",
      }),
    },
    {
      expression:
        /^Fentanyl Screen\s+(.+?cutoff)\s+(Not Detected|Detected)\s+-\s+(PASS|FAIL)\b/im,
      build: (match) => ({
        name: "Fentanyl Screen",
        specification: match[1],
        result: match[2],
        status: match[3],
        method: "Immunoassay",
      }),
    },
    {
      expression:
        /^Endotoxin \(USP <85>\)\s+(.+?)\s+((?:NMT\s+)?\d+(?:\.\d+)?\s+EU\/mL)\s+(Reported|PASS|FAIL)\b/im,
      build: (match) => ({
        name: "Endotoxin (USP <85>)",
        specification: match[1],
        result: match[2],
        unit: "EU/mL",
        status: match[3],
        method: "USP <85>",
      }),
    },
  ];

  for (const pattern of linePatterns) {
    const match = text.match(pattern.expression);
    if (match) addTest(tests, pattern.build(match));
  }

  for (const metal of ["Arsenic", "Cadmium", "Lead", "Mercury", "Chromium"]) {
    const expression = new RegExp(
      `^${metal} \\(([^)]+)\\)\\s+(NMT\\s+\\d+(?:\\.\\d+)?\\s+ppm)\\s+(Not Detected|Detected|\\d+(?:\\.\\d+)?)\\s+(PASS|FAIL)\\b`,
      "im",
    );
    const match = text.match(expression);
    if (match) {
      addTest(tests, {
        name: `${metal} (${match[1]})`,
        specification: match[2],
        result: match[3],
        unit: "ppm",
        status: match[4],
        method: "ICP-MS",
      });
    }
  }

  const sterility = text.match(
    /^Sterility \(PCR\)\s+(No Growth|Report Only)\s+(No Growth|Growth Detected)\s+(PASS|FAIL)\b/im,
  );
  if (sterility) {
    addTest(tests, {
      name: "Sterility (PCR)",
      specification: sterility[1],
      result: sterility[2],
      status: sterility[3],
      method: "PCR",
    });
  }

  return tests;
}

function parseFreedomTests(text) {
  const tests = [];
  const identity = text.match(/^Identity \(LC-MS\)\s+(.+)$/im);
  if (identity) {
    addTest(tests, {
      name: "Identity (LC-MS)",
      result: identity[1],
      method: "LC-MS",
    });
  }

  const purity = text.match(/^Purity \(HPLC-UV\)\s+(\d+(?:\.\d+)?%)$/im);
  if (purity) {
    addTest(tests, {
      name: "Purity (HPLC-UV)",
      result: purity[1],
      unit: "%",
      method: "HPLC-UV",
    });
  }

  const fentanyl = text.match(/^Fentanyl\s+(No Fentanyl Detected|Not Detected|Detected)\s*$/im);
  if (fentanyl) {
    addTest(tests, {
      name: "Fentanyl",
      result: fentanyl[1],
    });
  }

  const microbial = text.match(
    /^Microbial Analysis \(PCR\)(?::|\s)\s*(Pass|No Detectable Microbial DNA|Fail)\s*$/im,
  );
  if (microbial) {
    addTest(tests, {
      name: "Microbial Analysis (PCR)",
      result: microbial[1],
      method: "PCR",
    });
  }

  const elemental = text.match(
    /^Elemental Impurities \(ICP-MS\):?\s+(Pass|Fail)(?:\s+[-—].*)?$/im,
  );
  if (elemental) {
    addTest(tests, {
      name: "Elemental Impurities (ICP-MS)",
      result: elemental[1],
      method: "ICP-MS",
    });
  }

  for (const replicate of ["1", "2"]) {
    const expression = new RegExp(
      `^Endotoxin Replicate ${replicate}:\\s*(Pass|Fail)\\s+Assay Sensitivity:\\s*([^\\r\\n]+)$`,
      "im",
    );
    const match = text.match(expression);
    if (match) {
      addTest(tests, {
        name: `Endotoxin Replicate ${replicate}`,
        result: match[1],
        specification: match[2],
        method: "USP <85>",
      });
    }
  }

  return tests;
}

function productFromIls(text) {
  const lines = String(text || "").split(/\r?\n/);
  const certificateIndex = lines.findIndex((line) => /^Certificate of Analysis\s*$/i.test(line.trim()));
  if (certificateIndex < 0) return null;
  for (let index = certificateIndex + 1; index < Math.min(lines.length, certificateIndex + 8); index += 1) {
    const value = cleanPdfLine(lines[index]);
    if (!value || /^Tested for:/i.test(value)) continue;
    return clean(value.replace(/\s+(?:PASS|FAIL)\s*$/i, ""));
  }
  return null;
}

function collectDateConflicts(text, testDate, reportDate) {
  const conflicts = [];
  const notedDates = Array.from(text.matchAll(/Date Tested:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi))
    .map((match) => parseUsDate(match[1]))
    .filter(Boolean);
  for (const date of new Set(notedDates)) {
    if (testDate && date !== testDate) {
      conflicts.push({
        field: "test_date",
        type: "source_date_conflict",
        values: [testDate, date],
        message: `Analysis Date (${testDate}) conflicts with Date Tested (${date}) in the PDF.`,
      });
    }
  }
  if (testDate && reportDate && testDate > reportDate) {
    conflicts.push({
      field: "dates",
      type: "source_chronology_conflict",
      values: [testDate, reportDate],
      message: `The PDF reports a test date (${testDate}) after its issued/reported date (${reportDate}).`,
    });
  }
  return conflicts;
}

function parseIls(text) {
  const testDate = parseUsDate(firstMatch(text, /^Analysis Date:\s*(.+)$/im));
  const reportDate = parseUsDate(firstMatch(text, /^Issued:\s*(.+)$/im));
  const sourceConflicts = collectDateConflicts(text, testDate, reportDate);
  const purityLine = firstMatch(text, /^Peptide Purity \(HPLC\)\s+(.+)$/im);
  const purityValues = Array.from(String(purityLine || "").matchAll(/\d+(?:\.\d+)?\s*%/g));
  const purity = normalizePurity(purityValues.at(-1)?.[0]);
  const identityMatch = text.match(
    /^Identity \(HPLC-RTM\)\s+(.+?)\s+(?:Confirmed|Not Confirmed)\s+-\s+(?:PASS|FAIL)\b/im,
  );
  const productName = productFromIls(text);
  const compoundName = cleanPdfLine(identityMatch?.[1]) || clean(productName?.replace(/\s*-\s*\d+(?:\.\d+)?\s*(?:mg|g|mL)\s*$/i, ""));
  const tests = parseIlsTests(text);

  return {
    parser: "ils-v1",
    product_name: productName,
    compound_name: compoundName,
    batch: firstMatch(text, /^Lot Number:\s*([^\r\n]+)$/im),
    lab: "ILS Laboratories",
    sample_id: firstMatch(text, /^Accession #:\s*(ACC-[A-Z0-9-]+)\s*$/im),
    received_date: parseUsDate(firstMatch(text, /^Date Received:\s*(.+)$/im)),
    test_date: sourceConflicts.some((conflict) => conflict.field === "test_date") ? null : testDate,
    report_date: reportDate,
    report_code: firstMatch(text, /^COA #:\s*([^\s]+)\s*$/im),
    purity,
    tests,
    source_conflicts: sourceConflicts,
  };
}

function parseFreedom(text) {
  const productLine = firstMatch(text, /^Product:\s*(.+?)(?:\s+Purity:.*)?$/im);
  const identitySummary = firstMatch(text, /^Identity:\s*(.+?)(?:\s+Net Content:.*)?$/im);
  const tests = parseFreedomTests(text);
  const identityTest = tests.find((test) => normalizeComparison(test.name) === "identity lc ms");
  const compoundName = cleanPdfLine(identityTest?.result) ||
    clean(productLine?.replace(/\s+\d+(?:\.\d+)?\s*(?:mg|g|mL)\s*$/i, ""));
  const purityFromTest = tests.find((test) => normalizeComparison(test.name) === "purity hplc uv")?.result;
  const summaryPurity = firstMatch(text, /^Product:.*?Purity:\s*(?:Vial\s+\d+:\s*)?(\d+(?:\.\d+)?%)/im);

  return {
    parser: "freedom-v1",
    product_name: productLine,
    compound_name: identityTest?.result || (identitySummary === "Confirmed" ? compoundName : identitySummary) || compoundName,
    batch: firstMatch(text, /\bLot:\s*([^\r\n]+)$/im),
    lab: "Freedom Diagnostics",
    sample_id: firstMatch(text, /\bAccession #:\s*(\d{8,})\s*$/im),
    received_date: parseUsDate(firstMatch(text, /\bReceived:\s*(.+)$/im)),
    test_date: null,
    report_date: parseUsDate(firstMatch(text, /\bReported:\s*(.+)$/im)),
    report_code: firstMatch(text, /\bSearch Code:\s*([A-Z0-9-]+)\s*$/im),
    purity: normalizePurity(purityFromTest || summaryPurity),
    tests,
    source_conflicts: [],
  };
}

function parseLegacyFreedom(text) {
  const dates = Array.from(text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g))
    .map((match) => parseUsDate(match[0]))
    .filter(Boolean);
  const lotLine = text.match(/^(.+?)\s+((?:MS\s+10|[A-Z0-9-]+)-\d{4}-\d{2})\s*$/im);
  const percentLines = Array.from(
    text.matchAll(/^(.+?)\s+(\d{2,3}(?:\.\d+)?%)\s*$/gim),
  );
  const identityResult = percentLines.at(-1);
  let compoundName = cleanPdfLine(identityResult?.[1]);
  if (compoundName && /\bmg$/i.test(compoundName)) compoundName = null;
  if (!compoundName && lotLine) {
    const tail = text.slice((lotLine.index || 0) + lotLine[0].length);
    compoundName = firstMatch(
      tail,
      /^((?:(?!\b(?:Blue|Red|White)\s+(?:Lyophilized Powder|Liquid)\b)[\s\S])+?)\s+(?:Blue|Red|White)\s+(?:Lyophilized Powder|Liquid)\s*$/im,
    );
  }
  const purity = normalizePurity(identityResult?.[2]);
  const tests = [];
  if (compoundName) {
    addTest(tests, { name: "Mass Identification", result: compoundName, method: "LC-MS" });
  }
  if (purity) {
    addTest(tests, { name: "Purity", result: purity, unit: "%", method: "HPLC-UV" });
  }
  return {
    parser: "freedom-legacy-ocr-v1",
    product_name: cleanPdfLine(lotLine?.[1]),
    compound_name: cleanPdfLine(compoundName),
    batch: cleanPdfLine(lotLine?.[2]) || firstMatch(text, /\b([A-Z0-9]{2,12}-\d{4}-\d{2})\b/i),
    lab: "Freedom Diagnostics",
    sample_id: firstMatch(text, /^\D*(\d{10})\s*$/m),
    received_date: dates[0] || null,
    test_date: null,
    report_date: dates[1] || null,
    report_code: firstMatch(text, /\b(RGVE\d{10})\b/i),
    purity,
    tests,
    source_conflicts: [],
  };
}

function parseChromate(text) {
  const productName = firstMatch(text, /\b(eBac BAC Water 30\s*mL)\b/i);
  const tests = [];
  const rows = [
    ["Identity", /Benzyl alcohol\s+Benzyl alcohol\s+Conforms/i, "Benzyl alcohol", null],
    ["Quantity", /0\.9%\s+0\.921%\s+Conforms/i, "0.921%", "0.9%"],
    ["Sterility", /Sterility:\s*Pass\s+Pass\s+Conforms/i, "Pass", "Pass"],
    ["Endotoxins", /<\s*0\.5\s*EU\/ml\s+<\s*0\.25\s*EU\/ml\s+Conforms/i, "< 0.25 EU/mL", "< 0.5 EU/mL"],
    ["pH", /4\.5\s*-\s*7\.0\s+6\.253\s+Conforms/i, "6.253", "4.5 - 7.0"],
  ];
  for (const [name, expression, result, specification] of rows) {
    if (expression.test(text)) addTest(tests, { name, result, specification, status: "Conforms" });
  }
  return {
    parser: "chromate-ocr-v1",
    product_name: productName,
    compound_name: tests.some((test) => test.name === "Identity") ? "Benzyl alcohol" : null,
    batch: firstMatch(text, /\b(EB\d{5})\b/i),
    lab: "Chromate",
    sample_id: null,
    received_date: parseUsDate(firstMatch(text, /Sample received:\s*([^\r\n]+)/i)),
    test_date: parseUsDate(firstMatch(text, /Analysis conducted:\s*([^\r\n]+)/i)),
    report_date: parseUsDate(firstMatch(text, /produced\s+([^\r\n]+)/i)),
    report_code: firstMatch(text, /COA\s*#?\s*(\d{4,})/i),
    purity: null,
    tests,
    source_conflicts: [],
  };
}

export function parseCoaText(text) {
  const source = String(text || "").replace(/\f/g, "\n");
  if (/ILS Laboratories/i.test(source)) return parseIls(source);
  const isFreedom = /FreedomDiagnostics(?:Testing)?\.com|Freedom Diagnostics|F\s*R\s*E\s*E\s*D\s*[O0]\s*M[\s\S]{0,30}DIAGNOSTICS/i.test(source);
  if (isFreedom && /^Product:\s*\S/im.test(source)) return parseFreedom(source);
  if (
    isFreedom &&
    !/^Client:\s*\S/im.test(source)
  ) {
    return parseLegacyFreedom(source);
  }
  if (isFreedom) {
    return parseFreedom(source);
  }
  if (/Chromate|chromate\.org\/verify/i.test(source)) return parseChromate(source);
  return {
    parser: "unknown",
    product_name: null,
    compound_name: null,
    batch: null,
    lab: null,
    sample_id: null,
    received_date: null,
    test_date: null,
    report_date: null,
    report_code: null,
    purity: null,
    tests: [],
    source_conflicts: [
      {
        field: "lab",
        type: "unsupported_document",
        values: [],
        message: "No supported laboratory template matched this PDF.",
      },
    ],
  };
}

function catalogAliases(matches) {
  const aliases = [];
  for (const match of matches) {
    const parent = clean(match.parent_name);
    const name = clean(match.name);
    if (parent) aliases.push(parent);
    if (name && !/^(?:single|kit\s*x?\d+|\d+(?:\.\d+)?\s*mg,?\s*(?:single|kit))/i.test(name)) {
      aliases.push(name);
    }
  }
  return aliases;
}

function uniqueText(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const cleaned = cleanPdfLine(value);
    const normalized = normalizeComparison(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleaned);
  }
  return output;
}

export function resolveCatalogMapping(record, catalog = []) {
  const wanted = new Set((record.product_ids || []).map((id) => Number(id)).filter(Boolean));
  const matches = catalog.filter((entry) => wanted.has(Number(entry.id)));
  const variationSkus = uniqueText(
    matches.filter((entry) => entry.type === "variation").map((entry) => entry.sku),
  );
  const skus = uniqueText(matches.map((entry) => entry.sku));
  const resolvedSkus = variationSkus.length === 1 ? variationSkus : skus;
  return {
    status:
      matches.length === 0
        ? "missing"
        : resolvedSkus.length === 1
          ? "deterministic"
          : resolvedSkus.length === 0
            ? "catalog_sku_empty"
            : "ambiguous",
    matches,
    sku: resolvedSkus.length === 1 ? resolvedSkus[0] : null,
  };
}

function sourceTruthKey(record) {
  return `${Number(record?.id) || 0}|${clean(record?.pdf_url || record?.url) || ""}`;
}

export function indexSourceTruth(manifest) {
  const map = new Map();
  for (const record of manifest?.records || []) {
    map.set(sourceTruthKey(record), record);
  }
  return map;
}

export function buildCanonicalRecord(upstream, parsed, mapping, source = {}) {
  const productName = clean(upstream.product_name || upstream.product) || parsed.product_name;
  const tests = Array.isArray(parsed.tests) ? parsed.tests : [];
  const analyteNames = new Set(tests.map((test) => normalizeComparison(test.name)));
  const resultValues = new Set(tests.map((test) => normalizeComparison(test.result)));
  const aliases = uniqueText([
    parsed.product_name,
    ...catalogAliases(mapping.matches || []),
  ]).filter((alias) => {
    const normalized = normalizeComparison(alias);
    return normalized !== normalizeComparison(productName) &&
      normalized !== normalizeComparison(parsed.compound_name) &&
      !analyteNames.has(normalized) &&
      !resultValues.has(normalized);
  });

  const manualReview = [...(parsed.source_conflicts || [])];
  if (mapping.status !== "deterministic") {
    manualReview.push({
      field: "sku",
      type: "catalog_mapping",
      values: (upstream.product_ids || []).map(String),
      message: `Catalog mapping is ${mapping.status}; SKU was not inferred.`,
    });
  }

  return {
    id: Number(upstream.id),
    product_name: productName,
    compound_name: clean(parsed.compound_name),
    aliases,
    sku: mapping.sku || clean(upstream.sku),
    batch: clean(parsed.batch) || clean(upstream.batch || upstream.lot),
    lab: clean(parsed.lab),
    sample_id: clean(parsed.sample_id),
    received_date: clean(parsed.received_date),
    test_date: clean(parsed.test_date),
    report_date: clean(parsed.report_date),
    report_code: clean(parsed.report_code),
    purity: VALID_PURITY.test(parsed.purity || "") ? parsed.purity : null,
    analytes: tests.map((test) => test.name),
    tests,
    results: tests.map((test) => ({
      analyte: test.name,
      value: test.result,
      unit: test.unit,
      status: test.status,
    })),
    notes: null,
    pdf_url: clean(upstream.pdf_url || upstream.url),
    is_current: upstream.is_current === true || upstream.status === "current",
    product_ids: (upstream.product_ids || []).map(Number).filter(Boolean),
    group_key: clean(upstream.group_key || upstream.family_key || upstream.canonical_key),
    source: {
      parser: parsed.parser,
      pdf_sha256: clean(source.pdf_sha256),
      captured_at: clean(source.captured_at),
    },
    manual_review: manualReview,
  };
}

function resultPolarity(value) {
  const normalized = normalizeComparison(value);
  if (/\b(no|not)\b.*\b(detec|detectable|growth)\w*/.test(normalized)) return "negative";
  if (/\b(detec|growth)\w*/.test(normalized)) return "positive";
  return null;
}

export function validateCanonicalRecords(records) {
  const issues = [];
  const duplicateKeys = new Map();
  const groups = new Map();

  for (const record of records || []) {
    const prefix = { id: record.id, product_name: record.product_name };
    const analytes = new Set((record.analytes || []).map(normalizeComparison));
    for (const alias of record.aliases || []) {
      if (analytes.has(normalizeComparison(alias))) {
        issues.push({ ...prefix, severity: "error", code: "alias_from_analyte", field: "aliases", value: alias });
      }
    }

    if (record.purity && !VALID_PURITY.test(record.purity)) {
      issues.push({ ...prefix, severity: "error", code: "invalid_purity", field: "purity", value: record.purity });
    }

    for (const field of ["received_date", "test_date", "report_date"]) {
      if (record[field] && !ISO_DATE.test(record[field])) {
        issues.push({ ...prefix, severity: "error", code: "invalid_date", field, value: record[field] });
      }
    }

    if (record.received_date && record.test_date && record.received_date > record.test_date) {
      issues.push({ ...prefix, severity: "warning", code: "received_after_test", field: "dates" });
    }
    if (record.test_date && record.report_date && record.test_date > record.report_date) {
      issues.push({ ...prefix, severity: "warning", code: "test_after_report", field: "dates" });
    }

    if (record.sample_id && !/^(?:ACC-[A-Z0-9-]+|\d{8,})$/i.test(record.sample_id)) {
      issues.push({ ...prefix, severity: "error", code: "malformed_sample_id", field: "sample_id", value: record.sample_id });
    }

    for (const field of ["product_name", "batch", "lab", "pdf_url"]) {
      if (!clean(record[field])) {
        issues.push({ ...prefix, severity: "error", code: "required_field_empty", field });
      }
    }
    if (!clean(record.sku)) {
      issues.push({ ...prefix, severity: "review", code: "sku_unresolved", field: "sku" });
    }

    const resultsByAnalyte = new Map();
    for (const result of record.results || []) {
      const key = normalizeComparison(result.analyte);
      const polarity = resultPolarity(result.value);
      if (!key || !polarity) continue;
      if (!resultsByAnalyte.has(key)) resultsByAnalyte.set(key, new Set());
      resultsByAnalyte.get(key).add(polarity);
    }
    for (const [analyte, polarities] of resultsByAnalyte) {
      if (polarities.size > 1) {
        issues.push({ ...prefix, severity: "error", code: "contradictory_results", field: "results", value: analyte });
      }
    }

    const duplicateKey = [record.report_code, record.batch, record.pdf_url].map(normalizeComparison).join("|");
    if (!duplicateKeys.has(duplicateKey)) duplicateKeys.set(duplicateKey, []);
    duplicateKeys.get(duplicateKey).push(record.id);

    const groupKey = record.group_key || `id-${record.id}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);

    for (const review of record.manual_review || []) {
      issues.push({ ...prefix, severity: "review", code: review.type, field: review.field, value: review.values });
    }
  }

  for (const [key, ids] of duplicateKeys) {
    if (ids.length > 1) {
      issues.push({ severity: "error", code: "duplicate", field: "record", value: key, ids });
    }
  }

  for (const [groupKey, groupRecords] of groups) {
    const current = groupRecords.filter((record) => record.is_current);
    if (current.length !== 1) {
      issues.push({
        severity: "error",
        code: "current_history_inconsistent",
        field: "is_current",
        value: groupKey,
        ids: groupRecords.map((record) => record.id),
      });
    }
  }

  return issues;
}

export function applySourceTruth(payload, manifest) {
  if (!payload || typeof payload !== "object") return payload;
  const sourceIndex = indexSourceTruth(manifest);
  const normalizedById = new Map();

  const normalizeRecord = (record) => {
    const truth = sourceIndex.get(sourceTruthKey(record));
    if (!truth) return record;
    const legacy = {
      ...record,
      product: truth.product_name,
      product_name: truth.product_name,
      compound_name: truth.compound_name,
      identity: truth.compound_name,
      aliases: truth.aliases,
      sku: truth.sku || "",
      code: truth.report_code,
      report_code: truth.report_code,
      lot: truth.batch,
      batch: truth.batch,
      lab: truth.lab,
      lab_name: truth.lab,
      sample_id: truth.sample_id,
      received_date: truth.received_date,
      test_date: truth.test_date,
      report_date: truth.report_date,
      purity: truth.purity,
      analytes: truth.analytes,
      tests: truth.tests,
      results: truth.results,
      notes: truth.notes,
      pdf_url: truth.pdf_url,
      url: truth.pdf_url,
      is_current: truth.is_current,
      status: truth.is_current ? "current" : "history",
      manual_review: truth.manual_review,
      source: truth.source,
    };
    normalizedById.set(Number(legacy.id), legacy);
    return legacy;
  };

  const items = Array.isArray(payload.items) ? payload.items.map(normalizeRecord) : payload.items;
  const companies = Array.isArray(payload.companies)
    ? payload.companies.map((company) => ({
        ...company,
        files: Array.isArray(company.files)
          ? company.files.map((file) => {
              const current = normalizeRecord(file);
              return {
                ...current,
                history: Array.isArray(file.history)
                  ? file.history.map((history) => normalizedById.get(Number(history.id)) || normalizeRecord(history))
                  : [],
              };
            })
          : company.files,
      }))
    : payload.companies;

  const families = Array.isArray(payload.families)
    ? payload.families.map((family) => ({
        ...family,
        current: Array.isArray(family.current) ? family.current.map(normalizeRecord) : [],
        history: Array.isArray(family.history) ? family.history.map(normalizeRecord) : [],
      }))
    : payload.families;

  return { ...payload, items, companies, families };
}

export { normalizeComparison, normalizePurity, parseUsDate, VALID_PURITY };
