type ParsedVersion = readonly [number, number, number];

const parseStableVersion = (value: string): ParsedVersion | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
};

export const isNewerStableVersion = (candidate: string, current: string): boolean => {
  const next = parseStableVersion(candidate);
  const installed = parseStableVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]! > installed[index]!) return true;
    if (next[index]! < installed[index]!) return false;
  }
  return false;
};
