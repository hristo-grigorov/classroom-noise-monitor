/**
 * Pure, browser-independent helpers for relative microphone levels.
 * 0..100 is a digital signal scale, NOT calibrated acoustic dB SPL.
 */
export const DEFAULTS = Object.freeze({
  yellow: 45,
  red: 70,
  hysteresis: 4,
  smoothingMs: 650,
  warningDelayMs: 2000
});
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
export function relativeLevelFromRms(rms) {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  // -70 dBFS maps to 0, -10 dBFS (or louder) maps to 100.
  const dbfs = 20 * Math.log10(rms);
  return clamp((dbfs + 70) * (100 / 60), 0, 100);
}
export function rmsOf(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
export function smoothLevel(previous, measured, elapsedMs, timeConstantMs = DEFAULTS.smoothingMs) {
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / Math.max(1, timeConstantMs));
  return previous + alpha * (measured - previous);
}
/**
 * Hysteresis: rising zones use the configured thresholds; falling zones
 * require crossing threshold minus hysteresis. Prevents boundary flicker.
 * States: green, yellow, red.
 */
export function nextZone(previous, level, yellow, red, hysteresis = DEFAULTS.hysteresis) {
  const h = clamp(hysteresis, 0, 15);
  if (previous === 'red') {
    if (level >= red - h) return 'red';
    return level >= yellow - h ? 'yellow' : 'green';
  }
  if (previous === 'yellow') {
    if (level >= red) return 'red';
    return level < yellow - h ? 'green' : 'yellow';
  }
  if (level >= red) return 'red';
  if (level >= yellow) return 'yellow';
  return 'green';
}
/**
 * Calibrate while the class is making an ACCEPTABLE amount of noise.
 * Use the 75th percentile to resist a few quiet moments or brief spikes.
 */
export function suggestThresholds(levels) {
  const valid = levels.filter(Number.isFinite).map(x => clamp(x, 0, 100)).sort((a, b) => a - b);
  if (valid.length < 15) throw new Error('Insufficient calibration samples');
  const index = Math.floor((valid.length - 1) * 0.75);
  const baseline = valid[index];
  const yellow = Math.round(clamp(baseline + 7, 12, 78));
  const red = Math.round(clamp(Math.max(baseline + 22, yellow + 14), yellow + 12, 96));
  return { yellow, red, baseline: Math.round(baseline) };
}
