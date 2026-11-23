import assert from "node:assert/strict";
import { test } from "node:test";
import { countPlaceholders, fillLegalPlaceholders, legalFactsFromEnv } from "../../src/lib/legal/fill";
import { LEGAL_PAGES } from "../../src/lib/legal/templates";

test("facts from Settings + env; multi-line address joined; bad URL ignored", () => {
  const f = legalFactsFromEnv({ legalName: " Wego Srl ", vatNumber: "IT123", address: "Via Roma 1\n20100 Milano\n" }, { SUPPORT_EMAIL: "help@shop.test", NEXT_PUBLIC_SITE_URL: "https://www.shop.test" });
  assert.deepEqual(f, { legalName: "Wego Srl", vatNumber: "IT123", address: "Via Roma 1, 20100 Milano", supportEmail: "help@shop.test", domain: "www.shop.test" });
  assert.equal(legalFactsFromEnv({}, { NEXT_PUBLIC_SITE_URL: "not a url" }).domain, null);
});

test("fills known placeholders everywhere, leaves business choices and missing facts", () => {
  const terms = LEGAL_PAGES.find((p) => p.slug === "terms")!.body;
  const out = fillLegalPlaceholders(terms, { legalName: "Wego Srl", supportEmail: "help@shop.test" });
  assert.ok(!out.includes("[LEGAL COMPANY NAME]") && !out.includes("[SUPPORT EMAIL]"));
  assert.ok(out.includes("Wego Srl") && out.includes("help@shop.test"));
  assert.ok(out.includes("[VAT NUMBER]"), "unknown fact stays");
  assert.ok(countPlaceholders(out) < countPlaceholders(terms));
  assert.ok(countPlaceholders(out) > 0, "choices remain for the owner");
});

test("model-form blanks are not counted as placeholders", () => {
  assert.equal(countPlaceholders("Ordered on [ ] / [NAME] and [You pay / We pay]"), 2);
});
