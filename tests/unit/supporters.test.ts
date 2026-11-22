import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countryName, DEFAULT_SUPPORTERS_TITLE, MAX_SUPPORTERS, normalizeSupporters, parseSupporterLines, toCountryCode,
} from "../../src/lib/storefront/supporters";

test("normalizeSupporters: defaults, trims, drops blanks and unknown countries", () => {
  assert.deepEqual(normalizeSupporters(null), { title: DEFAULT_SUPPORTERS_TITLE, people: [] });
  const w = normalizeSupporters({
    title: "  ",
    people: [{ name: "  Maria   Rossi ", country: "it" }, { name: "", country: "US" }, { name: "Bob", country: "ZZ" }, "junk", { name: 5 }],
  });
  assert.equal(w.title, DEFAULT_SUPPORTERS_TITLE);
  assert.deepEqual(w.people, [{ name: "Maria Rossi", country: "IT" }, { name: "Bob", country: "" }]);
});

test("normalizeSupporters: caps name length and list size", () => {
  const many = Array.from({ length: MAX_SUPPORTERS + 5 }, (_, i) => ({ name: `P${i}`, country: "" }));
  assert.equal(normalizeSupporters({ people: many }).people.length, MAX_SUPPORTERS);
  assert.equal(normalizeSupporters({ people: [{ name: "x".repeat(200) }] }).people[0]!.name.length, 60);
});

test("toCountryCode / countryName", () => {
  assert.equal(toCountryCode("italy"), "IT");
  assert.equal(toCountryCode("us"), "US");
  assert.equal(toCountryCode("UK"), "GB");
  assert.equal(toCountryCode("Atlantis"), "");
  assert.equal(countryName("TN"), "Tunisia");
});

test("parseSupporterLines: common separators, name-only lines, commas inside names kept when no country", () => {
  assert.deepEqual(parseSupporterLines("Maria Rossi, Italy\nJohn Smith - US\n\nAmira\tTunisia\nJust A Name\nSmith, Jr."), [
    { name: "Maria Rossi", country: "IT" },
    { name: "John Smith", country: "US" },
    { name: "Amira", country: "TN" },
    { name: "Just A Name", country: "" },
    { name: "Smith, Jr.", country: "" },
  ]);
});
