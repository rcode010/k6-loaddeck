export function durationSeconds(value: string): number {
  if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) return NaN;
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
    (total, match) =>
      total +
      Number(match[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]!] ?? 0),
    0,
  );
}
