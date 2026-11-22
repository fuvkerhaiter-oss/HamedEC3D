import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCmsBody } from "../../src/lib/storefront/cms-body";
import { LEGAL_PAGES } from "../../tools/content/legal-templates";

test("heading followed directly by text: heading stays short, text becomes content", () => {
  assert.deepEqual(parseCmsBody("# At a glance\n• One.\n• Two."), [{ kind: "h2", text: "At a glance" }, { kind: "list", items: ["One.", "Two."] }]);
  assert.deepEqual(parseCmsBody("# Title\n\nPlain."), [{ kind: "h2", text: "Title" }, { kind: "p", text: "Plain." }]);
});

test("intro line + bullets, sub-headings, plain paragraphs, model-form lines", () => {
  assert.deepEqual(parseCmsBody("You have the right to:\n• a;\n• b."), [{ kind: "p", text: "You have the right to:" }, { kind: "list", items: ["a;", "b."] }]);
  assert.deepEqual(parseCmsBody("How to withdraw\nWrite to us."), [{ kind: "h3", text: "How to withdraw" }, { kind: "p", text: "Write to us." }]);
  assert.deepEqual(parseCmsBody("Ordered on (*) / received on (*): ____\nOrder number: ____"), [{ kind: "p", text: "Ordered on (*) / received on (*): ____\nOrder number: ____" }]);
});

test("every legal template: headings are single short lines (no swallowed sections)", () => {
  for (const p of LEGAL_PAGES) {
    for (const b of parseCmsBody(p.body)) if (b.kind === "h2" || b.kind === "h3") assert.ok(!b.text.includes("\n") && b.text.length <= 80, `${p.slug}: ${b.text.slice(0, 60)}`);
  }
});

test("text, bullets, then text again: list in the middle", () => {
  assert.deepEqual(parseCmsBody("Ways:\n• email;\n• post.\nYou may use the form."), [
    { kind: "p", text: "Ways:" }, { kind: "list", items: ["email;", "post."] }, { kind: "p", text: "You may use the form." },
  ]);
});
