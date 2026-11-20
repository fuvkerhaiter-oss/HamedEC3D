import { test } from "node:test";
import assert from "node:assert/strict";
import { analogSpeed, joystickVector, JOYSTICK_DEADZONE, SPRINT_FROM } from "../../src/features/store3d/input/touch-input";

const R = 50;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("joystick: center and dead zone produce no movement", () => {
  assert.deepEqual(joystickVector(0, 0, R), { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 });
  const v = joystickVector(R * JOYSTICK_DEADZONE * 0.9, 0, R);
  assert.equal(v.magnitude, 0);
  assert.ok(v.knobX > 0, "knob still follows the thumb inside the dead zone");
});

test("joystick: up on screen is forward, right is strafe right", () => {
  const up = joystickVector(0, -R, R);
  close(up.y, 1);
  close(up.x, 0);
  const right = joystickVector(R, 0, R);
  close(right.x, 1);
  close(right.y, 0);
  const back = joystickVector(0, R, R);
  close(back.y, -1);
});

test("joystick: diagonals keep unit length, knob is clamped to the travel radius", () => {
  const d = joystickVector(300, -300, R);
  close(Math.hypot(d.x, d.y), 1);
  close(d.x, Math.SQRT1_2);
  close(d.y, Math.SQRT1_2);
  close(Math.hypot(d.knobX, d.knobY), R);
});

test("joystick: magnitude grows continuously with displacement (analog)", () => {
  let prev = -1;
  for (let px = 0; px <= R; px += 5) {
    const m = joystickVector(px, 0, R).magnitude;
    assert.ok(m >= prev && m <= 1);
    prev = m;
  }
  close(prev, 1);
});

test("analog speed: walk ramps linearly, run only near full push", () => {
  close(analogSpeed(0, 2, 4), 0);
  close(analogSpeed(SPRINT_FROM / 2, 2, 4), 1);
  close(analogSpeed(SPRINT_FROM, 2, 4), 2);
  close(analogSpeed(1, 2, 4), 4);
  close(analogSpeed(5, 2, 4), 4);
});
