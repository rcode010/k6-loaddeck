export function k6Version(
  value: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = /^k6(?:\.exe)?\s+v?(\d+)\.(\d+)\.(\d+)(?:\s|$|[-+])/i.exec(
    value.trim(),
  );
  return match
    ? {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
      }
    : undefined;
}
export function verifiedProfile(value: string): boolean {
  const version = k6Version(value);
  return version?.major === 2 && version.minor === 3;
}
