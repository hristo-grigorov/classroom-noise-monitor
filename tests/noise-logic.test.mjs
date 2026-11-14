import test from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeLevelFromRms, rmsOf, smoothLevel, nextZone, suggestThresholds
} from '../noise-logic.mjs';

test('silence and digital signal levels are bounded', () => {
  assert.equal(relativeLevelFromRms(0), 0);
  assert.equal(relativeLevelFromRms(1), 100);
  assert.ok(relativeLevelFromRms(0.01) > 40);
  assert.ok(relativeLevelFromRms(0.01) < 60);
  assert.equal(rmsOf(new Float32Array([0, 0])), 0);
  assert.ok(Math.abs(rmsOf(new Float32Array([1, -1])) - 1) < 0.0001);
});

test('smoothing rises gradually and later falls', () => {
  const first = smoothLevel(0, 100, 100, 650);
  assert.ok(first > 0 && first < 30);
  assert.ok(smoothLevel(first, 0, 100, 650) < first);
});

test('hysteresis resists flicker around yellow and red thresholds', () => {
  assert.equal(nextZone('green', 46, 45, 70, 4), 'yellow');
  assert.equal(nextZone('yellow', 43, 45, 70, 4), 'yellow');
  assert.equal(nextZone('yellow', 40, 45, 70, 4), 'green');
  assert.equal(nextZone('yellow', 70, 45, 70, 4), 'red');
  assert.equal(nextZone('red', 68, 45, 70, 4), 'red');
  assert.equal(nextZone('red', 65, 45, 70, 4), 'yellow');
  assert.equal(nextZone('red', 35, 45, 70, 4), 'green');
});

test('calibration uses an upper-percentile baseline with a safety gap', () => {
  const result = suggestThresholds([...Array(40).fill(45), 98]);
  assert.equal(result.baseline, 45);
  assert.equal(result.yellow, 52);
  assert.equal(result.red, 67);
  const high = suggestThresholds(Array(50).fill(99));
  assert.ok(high.red > high.yellow);
  assert.ok(high.red <= 96);
  assert.throws(() => suggestThresholds([10, 20]), /Insufficient/);
});
