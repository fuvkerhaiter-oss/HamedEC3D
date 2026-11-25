import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHiddenGuides } from "../../src/features/admin/prefs";

test("hidden guides: missing or invalid storage becomes an empty list", () => {
  assert.deepEqual(parseHiddenGuides(null), []);
  assert.deepEqual(parseHiddenGuides(""), []);
  assert.deepEqual(parseHiddenGuides("not json"), []);
});

test("hidden guides: an object or scalar from old app versions is ignored", () => {
  assert.deepEqual(parseHiddenGuides('{"admin":"/admin"}'), []);
  assert.deepEqual(parseHiddenGuides('"admin"'), []);
  assert.deepEqual(parseHiddenGuides("42"), []);
});

test("hidden guides: keeps only strings from an array", () => {
  assert.deepEqual(parseHiddenGuides('["/admin","/admin/orders",null,7,{"a":1}]'), ["/admin", "/admin/orders"]);
});
