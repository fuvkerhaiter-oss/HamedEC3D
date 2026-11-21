import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanColor, cleanName, cleanPose, mustMoveOn, ROOM_CAPACITY, type MemberMeta } from "../../src/features/store3d/multiplayer/rooms";

const m = (id: string, joinedAt: number): MemberMeta => ({ id, name: id, color: "#000000", joinedAt });

test("rooms: up to capacity, nobody moves", () => {
  const members = Array.from({ length: ROOM_CAPACITY }, (_, i) => m(`u${i}`, i));
  for (const x of members) assert.equal(mustMoveOn(members, x.id), false);
});

test("rooms: the 11th (latest) shopper moves on; ties broken by id identically everywhere", () => {
  const members = Array.from({ length: ROOM_CAPACITY }, (_, i) => m(`u${i}`, i));
  members.push(m("late", 100));
  assert.equal(mustMoveOn(members, "late"), true);
  assert.equal(mustMoveOn(members, "u9"), false);
  const tie = [m("b", 5), m("a", 5), m("c", 1)];
  assert.equal(mustMoveOn(tie, "b", 2), true);
  assert.equal(mustMoveOn(tie, "a", 2), false);
});

test("rooms: untrusted presence/pose data is sanitized", () => {
  assert.equal(cleanName("  <b>Happy\u0007  Panda</b> "), "bHappy Panda/b");
  assert.equal(cleanName(42), "Shopper");
  assert.equal(cleanName("x".repeat(50)).length, 20);
  assert.equal(cleanColor("red"), "#e4572e");
  assert.deepEqual(cleanPose([1, 2, 3, 0.5]), [1, 2, 3, 0.5]);
  assert.equal(cleanPose([1, 2, "x", 0]), null);
  assert.equal(cleanPose([1e9, 0, 0, 0]), null);
});
