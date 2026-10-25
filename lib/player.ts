/** Small rules behind the player's own controls, kept apart so they can be tested. */

export const RATES = [1, 1.25, 1.5, 2, 0.75] as const;

/** The next playback speed when the speed button is tapped. */
export function nextRate(rate: number): number {
  const i = RATES.findIndex((r) => Math.abs(r - rate) < 0.01);
  return RATES[(i + 1) % RATES.length];
}

export function rateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/** Which part of the screen a tap landed in: the outer thirds skip, the middle shows the controls. */
export function tapZone(x: number, width: number): 'back' | 'forward' | 'middle' {
  if (width <= 0) return 'middle';
  if (x < width * 0.35) return 'back';
  if (x > width * 0.65) return 'forward';
  return 'middle';
}

/** Where a skip lands, kept inside the video (a forward skip stops just short of the end). */
export function skipTarget(current: number, by: number, duration: number): number {
  const end = duration > 0 ? Math.max(0, duration - 1) : Infinity;
  return Math.min(end, Math.max(0, current + by));
}

export const INTRO_SKIP_SEC = 90;

/** Openings come in the first few minutes; the button stays out of the way after that. */
export function offerSkipIntro(current: number, duration: number): boolean {
  return duration > 300 && current >= 3 && current < 240;
}
