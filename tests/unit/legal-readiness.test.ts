import assert from "node:assert/strict";
import { test } from "node:test";
import { fillLegalPlaceholders } from "../../src/lib/legal/fill";
import { legalPageProblems, legalReadiness, placeholderSignal, sellerIdentityProblems } from "../../src/lib/legal/readiness";
import { LEGAL_PAGES } from "../../src/lib/legal/templates";

const REQUIRED = ["terms", "privacy", "returns"];
const seller = { legalName: "Wego Shiiip S.r.l.", address: "Via Roma 1, 20100 Milano MI, Italy", vatNumber: "IT 12345678901", email: "help@wegoshiiip.com" };
const realBody = (name: string) =>
  `These terms are between you and ${name}, registered at Via Roma 1, 20100 Milano, VAT IT12345678901. `.repeat(10);

test("the shipped templates are never 'ready', even with every known fact filled in", () => {
  const pages = LEGAL_PAGES.filter((p) => REQUIRED.includes(p.slug)).map((p) => ({
    slug: p.slug,
    body: fillLegalPlaceholders(p.body, { legalName: seller.legalName, vatNumber: seller.vatNumber, address: seller.address, supportEmail: seller.email, domain: "wegoshiiip.com" }),
  }));
  const problems = legalPageProblems(pages, REQUIRED);
  assert.equal(problems.length, 3, problems.join("\n"));
});

test("placeholder signals: brackets, mustache, TODO, lorem, XXX, example emails, TEMPLATE banner", () => {
  for (const t of ["Sold by [LEGAL COMPANY NAME].", "VAT {{vat}}", "Address: TODO", "Lorem ipsum dolor", "VAT XXXXXX", "write to a@example.com", "TEMPLATE — fill in", "[REA NUMBER]", "Your Company Name Ltd", "<insert address>"]) {
    assert.ok(placeholderSignal(t), t);
  }
  assert.equal(placeholderSignal("Sold by Wego Shiiip S.r.l., Via Roma 1, Milano. VAT IT12345678901."), null);
});

test("seller identity: missing, placeholder and fake VAT numbers are refused", () => {
  assert.deepEqual(sellerIdentityProblems(seller), []);
  assert.equal(sellerIdentityProblems(null).length, 3);
  assert.ok(sellerIdentityProblems({ ...seller, legalName: "[LEGAL COMPANY NAME]" }).some((p) => p.includes("placeholder")));
  for (const vat of ["123", "IT00000000000", "TBD", "[VAT NUMBER]", "ITXXXXXXXXXX"]) {
    assert.ok(sellerIdentityProblems({ ...seller, vatNumber: vat }).some((p) => p.includes("VAT")), vat);
  }
  assert.ok(sellerIdentityProblems({ ...seller, address: "Milano" }).some((p) => p.includes("address")));
});

test("filled pages + complete identity pass; missing/short pages and an unnamed seller fail", () => {
  const pages = REQUIRED.map((slug) => ({ slug, body: realBody(seller.legalName) }));
  assert.deepEqual(legalReadiness(pages, seller, REQUIRED), []);
  assert.ok(legalReadiness(pages.slice(0, 2), seller, REQUIRED).some((p) => p.includes("returns page is not published")));
  assert.ok(legalReadiness([{ slug: "terms", body: "Short." }, ...pages.slice(1)], seller, REQUIRED).some((p) => p.includes("too short")));
  const other = REQUIRED.map((slug) => ({ slug, body: realBody("Someone Else S.p.A.") }));
  assert.ok(legalReadiness(other, seller, REQUIRED).some((p) => p.includes("does not name")));
});
