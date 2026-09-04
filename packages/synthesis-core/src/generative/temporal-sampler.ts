import type { NormalizedResponse } from "@survey-synth/domain";

export interface TemporalWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly offsetString: string;
  readonly observedEpochMs?: readonly number[];
}

const parseOffset = (isoString?: string): string => {
  if (!isoString) return "+00:00";
  const match = /([+-]\d{2}:\d{2})$/.exec(isoString);
  if (match) return match[1]!;
  if (isoString.endsWith("Z")) return "+00:00";
  return "+00:00";
};

export const detectTemporalWindow = (
  original: readonly NormalizedResponse[],
  fallbackCapturedAt?: string,
): TemporalWindow => {
  const epochs: number[] = [];
  let sampleOffset = "+09:00";

  for (const row of original) {
    const raw = row.lastSubmittedAt ?? row.createdAt;
    if (raw) {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) {
        epochs.push(parsed);
        sampleOffset = parseOffset(raw);
      }
    }
  }

  if (epochs.length === 0) {
    const baseEpoch =
      fallbackCapturedAt && !Number.isNaN(Date.parse(fallbackCapturedAt))
        ? Date.parse(fallbackCapturedAt)
        : Date.parse("2026-01-01T00:00:00.000Z");
    return {
      startMs: baseEpoch - 3 * 86400_000,
      endMs: baseEpoch,
      offsetString: sampleOffset,
      observedEpochMs: [],
    };
  }

  const minMs = Math.min(...epochs);
  const maxMs = Math.max(...epochs);

  const spanMs = maxMs - minMs;
  if (spanMs < 2 * 3600_000) {
    return {
      startMs: minMs - 2 * 86400_000,
      endMs: maxMs + 86400_000,
      offsetString: sampleOffset,
      observedEpochMs: epochs.sort((a, b) => a - b),
    };
  }

  return {
    startMs: minMs,
    endMs: maxMs,
    offsetString: sampleOffset,
    observedEpochMs: epochs.sort((a, b) => a - b),
  };
};

export const formatIsoWithOffset = (epochMs: number, offsetString: string): string => {
  const offsetSign = offsetString.startsWith("-") ? -1 : 1;
  const offsetParts = offsetString.replace(/^[+-]/, "").split(":").map(Number);
  const offsetHours = offsetParts[0] ?? 0;
  const offsetMinutes = offsetParts[1] ?? 0;
  const totalOffsetMs = offsetSign * (offsetHours * 3600_000 + offsetMinutes * 60_000);

  const localTime = new Date(epochMs + totalOffsetMs);
  const year = localTime.getUTCFullYear();
  const month = String(localTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localTime.getUTCDate()).padStart(2, "0");
  const hour = String(localTime.getUTCHours()).padStart(2, "0");
  const minute = String(localTime.getUTCMinutes()).padStart(2, "0");
  const second = String(localTime.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetString}`;
};

export interface TimestampPair {
  readonly createdAt: string;
  readonly lastSubmittedAt: string;
}

export const generateSyntheticTimestamps = (
  count: number,
  window: TemporalWindow,
  seed: number,
): readonly TimestampPair[] => {
  if (count <= 0) return [];

  let state = (seed >>> 0) || 0x12345678;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const observed = [...(window.observedEpochMs ?? [])].sort((a, b) => a - b);
  const spanSeconds = Math.max(count * 60, Math.floor((window.endMs - window.startMs) / 1000));
  const baseEpochSeconds = Math.floor(window.startMs / 1000);

  const usedSeconds = new Set<number>();
  const secondOffsets: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const quantile = (i + 0.5) / count;
    let targetEpochMs: number;
    if (observed.length > 0) {
      // Inverse empirical CDF sampling preserves source density: repeated or
      // clustered source timestamps receive proportionally more synthetic rows.
      const position = quantile * (observed.length - 1);
      const lowerIndex = Math.floor(position);
      const upperIndex = Math.min(observed.length - 1, lowerIndex + 1);
      const fraction = position - lowerIndex;
      const lower = observed[lowerIndex] ?? window.startMs;
      const upper = observed[upperIndex] ?? lower;
      const localGap = Math.max(1_000, upper - lower);
      const jitter = (random() - 0.5) * Math.min(localGap, (window.endMs - window.startMs) / count) * 0.8;
      targetEpochMs = lower + (upper - lower) * fraction + jitter;
    } else {
      const jitter = (random() - 0.5) * (spanSeconds / count) * 0.8 * 1000;
      targetEpochMs = window.startMs + quantile * (window.endMs - window.startMs) + jitter;
    }
    targetEpochMs = Math.min(window.endMs, Math.max(window.startMs, targetEpochMs));
    let targetSecond = Math.floor((targetEpochMs - window.startMs) / 1000);
    if (targetSecond < 0) targetSecond = 0;
    if (targetSecond > spanSeconds) targetSecond = spanSeconds;

    if (usedSeconds.has(targetSecond)) {
      let forward = targetSecond;
      while (forward <= spanSeconds && usedSeconds.has(forward)) forward += 1;
      if (forward <= spanSeconds) {
        targetSecond = forward;
      } else {
        let backward = targetSecond - 1;
        while (backward >= 0 && usedSeconds.has(backward)) backward -= 1;
        // detectTemporalWindow expands very narrow observed windows, so this
        // fallback is only reachable for a manually supplied saturated window.
        targetSecond = backward >= 0 ? backward : targetSecond;
      }
    }
    usedSeconds.add(targetSecond);
    secondOffsets.push(targetSecond);
  }

  secondOffsets.sort((a, b) => a - b);

  return secondOffsets.map((secOffset) => {
    const submitEpochMs = (baseEpochSeconds + secOffset) * 1000;
    const durationSeconds = Math.floor(45 + random() * 255);
    const createEpochMs = submitEpochMs - durationSeconds * 1000;

    return {
      createdAt: formatIsoWithOffset(createEpochMs, window.offsetString),
      lastSubmittedAt: formatIsoWithOffset(submitEpochMs, window.offsetString),
    };
  });
};
