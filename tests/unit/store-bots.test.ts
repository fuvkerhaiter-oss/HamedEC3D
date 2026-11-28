import { test } from "node:test";
import assert from "node:assert/strict";
import { rectsFromBoxes, resolve } from "../../src/features/store3d/collision";
import { GATE_X, PLAZA_PROPS } from "../../src/features/store3d/env/extension";
import { STORE_CONFIG, STORE_ENV } from "../../src/features/store3d/env/supermarket";
import {
  BOT_COUNT, BOT_SHAPE, PERSONAS, botLabel, botPose, botsEnabled, buildBotWorld, buildNavGrid, createBots, findPath, isFree, lineFree, newPose, stepBots,
} from "../../src/features/store3d/bots/bots";

const RECTS = rectsFromBoxes([...STORE_ENV.walls, ...STORE_ENV.fixtures]);
const SEED: [number, number] = [STORE_CONFIG.spawn[0], STORE_CONFIG.spawn[2]];
const WORLD = buildBotWorld(STORE_ENV, RECTS, SEED);

test("switch: on in development by default, off in production unless forced on", () => {
  assert.equal(botsEnabled(undefined, "development"), true);
  assert.equal(botsEnabled(undefined, "production"), false);
  assert.equal(botsEnabled("on", "production"), true);
  assert.equal(botsEnabled("1", "production"), true);
  assert.equal(botsEnabled("off", "development"), false);
  assert.equal(botsEnabled("0", "development"), false);
});

test("exactly 5 bots, all labelled as bots with distinct names", () => {
  const bots = createBots(WORLD);
  assert.equal(bots.length, BOT_COUNT);
  assert.equal(BOT_COUNT, 5);
  const labels = bots.map((b) => botLabel(b.persona));
  assert.ok(labels.every((l) => l.startsWith("Bot · ")), labels.join());
  assert.equal(new Set(labels).size, 5);
});

test("walkable grid: the plaza is free around its attractions; attractions/behind the chains are not", () => {
  const g = WORLD.grid;
  assert.ok(isFree(g, SEED[0], SEED[1]), "spawn is walkable");
  assert.ok(isFree(g, -3, -1.3), "middle of the benchmark aisle");
  // The centre gondolas were replaced by the plaza (env/extension.ts PLAZA_PROPS): its islands are obstacles.
  assert.ok(!isFree(g, PLAZA_PROPS.claw.x, PLAZA_PROPS.claw.z), "inside the claw machine");
  assert.ok(!isFree(g, PLAZA_PROPS.center.x, PLAZA_PROPS.center.z), "inside the centre island");
  assert.ok(!isFree(g, GATE_X + 3, 0), "inside the chained wing (unreachable)");
  assert.ok(!isFree(g, GATE_X - 1, 0), "under the updates board");
  assert.ok(WORLD.shelfSpots.length >= 6, `look spots ${WORLD.shelfSpots.length}`);
  assert.ok(WORLD.danceSpots.length >= 3, `dance spots ${WORLD.danceSpots.length}`);
  for (const s of [...WORLD.shelfSpots, ...WORLD.danceSpots]) assert.ok(isFree(g, s.x, s.z));
});

test("grid flood fill drops enclosed pockets", () => {
  // A closed box around (0,0) inside a 10×10 room: its inside is open but unreachable from (4,4).
  const room = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const ring = rectsFromBoxes([
    { min: [-2, 0, -2], max: [2, 2, -1.8] }, { min: [-2, 0, 1.8], max: [2, 2, 2] },
    { min: [-2, 0, -2], max: [-1.8, 2, 2] }, { min: [1.8, 0, -2], max: [2, 2, 2] },
  ]);
  const g = buildNavGrid(room, ring, [4, 4], 0.25, 0.3);
  assert.ok(isFree(g, 4, 4));
  assert.ok(!isFree(g, 0, 0));
  assert.equal(findPath(g, [4, 4], [0, 0]), null);
});

test("paths go around gondolas and every leg stays on walkable ground", () => {
  const from: [number, number] = [-3, -1.3]; // aisle between L1 and L2
  const to: [number, number] = [-3, 2.4]; // next aisle over, between L2 and L3
  assert.ok(!lineFree(WORLD.grid, from[0], from[1], to[0], to[1]), "straight line would cross L2");
  const path = findPath(WORLD.grid, from, to);
  assert.ok(path && path.length >= 2, "found a path with at least one turn");
  let px = from[0], pz = from[1];
  for (const [x, z] of path) {
    assert.ok(lineFree(WORLD.grid, px, pz, x, z), `leg to ${x.toFixed(2)},${z.toFixed(2)} is clear`);
    px = x;
    pz = z;
  }
  assert.deepEqual(path[path.length - 1], to);
});

test("simulated minutes: bots roam, never end up inside obstacles, never enter the wing, do silly things", () => {
  const bots = createBots(WORLD, 3);
  const start = bots.map((b) => [b.motion.x, b.motion.z] as const);
  const travelled = bots.map(() => 0);
  const modes = new Set<string>();
  const pose = newPose();
  const dt = 1 / 30;
  for (let f = 0; f < 30 * 240; f++) {
    const prev = bots.map((b) => [b.motion.x, b.motion.z] as const);
    stepBots(bots, WORLD, dt, { x: -9, z: -1.27, active: true });
    bots.forEach((b, i) => {
      travelled[i]! += Math.hypot(b.motion.x - prev[i]![0], b.motion.z - prev[i]![1]);
      modes.add(b.mode);
      assert.ok(b.motion.x < GATE_X - 0.25, `${b.persona.name} stays out of the wing`);
      assert.ok(Number.isFinite(b.motion.x) && Number.isFinite(b.motion.z));
      botPose(b, f * dt, pose);
      assert.ok(Number.isFinite(pose.lift) && Number.isFinite(pose.turn));
    });
    if (f % 30 === 0) {
      for (const b of bots) {
        const probe = { ...b.motion };
        // Allow a hair of overlap from the last bump nudge; never deep inside anything.
        resolve(probe, b.yaw, BOT_SHAPE, WORLD.rects);
        assert.ok(Math.hypot(probe.x - b.motion.x, probe.z - b.motion.z) < 0.05, `${b.persona.name} not inside an obstacle`);
      }
    }
  }
  travelled.forEach((d, i) => assert.ok(d > 25, `${bots[i]!.persona.name} moved ${d.toFixed(1)} m`));
  assert.ok(bots.some((b, i) => Math.hypot(b.motion.x - start[i]![0], b.motion.z - start[i]![1]) > 2), "they went somewhere");
  for (const m of ["walk", "look", "spin", "hop", "dance"]) assert.ok(modes.has(m), `saw mode ${m} (${[...modes].join()})`);
});

test("bots keep their distance from each other (bump and back off)", () => {
  const bots = createBots(WORLD, 11);
  let minD = Infinity;
  for (let f = 0; f < 30 * 120; f++) {
    stepBots(bots, WORLD, 1 / 30);
    for (let i = 0; i < bots.length; i++)
      for (let j = i + 1; j < bots.length; j++) minD = Math.min(minD, Math.hypot(bots[i]!.motion.x - bots[j]!.motion.x, bots[i]!.motion.z - bots[j]!.motion.z));
  }
  assert.ok(minD > 0.35, `bodies never overlap (closest ${minD.toFixed(2)} m)`);
});

test("deterministic for a seed", () => {
  const a = createBots(WORLD, 5), b = createBots(WORLD, 5);
  for (let f = 0; f < 300; f++) {
    stepBots(a, WORLD, 1 / 30);
    stepBots(b, WORLD, 1 / 30);
  }
  assert.deepEqual(a.map((x) => [x.motion.x, x.motion.z]), b.map((x) => [x.motion.x, x.motion.z]));
});

test("some bots break into a run (Pip the most), the others never run", () => {
  const bots = createBots(WORLD, 21);
  const top = new Map<string, number>();
  const ran = new Map<string, number>();
  for (let f = 0; f < 30 * 180; f++) {
    stepBots(bots, WORLD, 1 / 30);
    for (const b of bots) {
      const v = Math.hypot(b.motion.vx, b.motion.vz);
      top.set(b.persona.name, Math.max(top.get(b.persona.name) ?? 0, v));
      if (b.sprintT > 0) ran.set(b.persona.name, (ran.get(b.persona.name) ?? 0) + 1 / 30);
      assert.ok(b.motion.x < GATE_X - 0.25, "runners stay out of the wing too");
    }
  }
  const runners = PERSONAS.filter((p) => p.dash > 0).map((p) => p.name);
  assert.ok(runners.length >= 2 && runners.length < BOT_COUNT, "only some bots run");
  assert.ok((top.get("Pip") ?? 0) > 3, `Pip sprints (${top.get("Pip")?.toFixed(2)} m/s)`);
  assert.ok((ran.get("Pip") ?? 0) > 5, `Pip ran for ${ran.get("Pip")?.toFixed(1)} s`);
  for (const p of PERSONAS.filter((x) => x.dash === 0)) {
    assert.equal(ran.get(p.name) ?? 0, 0, `${p.name} never runs`);
    assert.ok((top.get(p.name) ?? 0) <= p.speed + 1e-6, `${p.name} stays at walking pace`);
  }
});
