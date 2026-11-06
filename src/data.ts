import { parseCsv, type Dataset } from "./integrations";

export function datasetRows(
  text: string,
  d: Pick<Dataset, "format" | "types">,
): Record<string, unknown>[] {
  const rows: unknown = d.format === "csv" ? parseCsv(text) : JSON.parse(text);
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  )
    throw new Error("Dataset must contain a nonempty array of row objects.");
  return rows.map((row) => {
    const result = { ...row };
    for (const [key, type] of Object.entries(d.types ?? {})) {
      if (!Object.hasOwn(result, key))
        throw new Error(`Dataset is missing column: ${key}`);
      const value = result[key];
      let converted: unknown = value;
      if (type === "string") converted = String(value);
      else if (type === "number") {
        if (
          (typeof value !== "number" && typeof value !== "string") ||
          String(value).trim() === "" ||
          !Number.isFinite(Number(value))
        )
          throw new Error(
            `Dataset column ${key} cannot be converted to number.`,
          );
        converted = Number(value);
      } else if (type === "boolean") {
        if (![true, false, "true", "false"].includes(value))
          throw new Error(`Dataset column ${key} must be true or false.`);
        converted = value === true || value === "true";
      } else if (type === "json" && typeof value === "string") {
        try {
          converted = JSON.parse(value);
        } catch {
          throw new Error(`Dataset column ${key} must contain valid JSON.`);
        }
      }
      Object.defineProperty(result, key, {
        value: converted,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  });
}
export function datasetPreview(rows: Record<string, unknown>[]): {
  rowCount: number;
  columns: { name: string; type: string }[];
} {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    rowCount: rows.length,
    columns: keys.map((name) => {
      const types = new Set(
        rows
          .slice(0, 100)
          .map((row) =>
            row[name] === null
              ? "null"
              : Array.isArray(row[name])
                ? "array"
                : typeof row[name],
          ),
      );
      return { name, type: [...types].join(" / ") };
    }),
  };
}
export const dataRuntime = `function dataRow(row, schema) { const result = { ...row }; for (const [key, type] of Object.entries(schema)) { if (!Object.prototype.hasOwnProperty.call(result, key)) throw new Error('Dataset is missing column: ' + key); const value = result[key]; let converted = value; if (type === 'string') converted = String(value); else if (type === 'number') { if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Dataset column cannot be converted to number: ' + key); converted = Number(value); } else if (type === 'boolean') { if (![true,false,'true','false'].includes(value)) throw new Error('Dataset column must be true or false: ' + key); converted = value === true || value === 'true'; } else if (type === 'json' && typeof value === 'string') converted = JSON.parse(value); Object.defineProperty(result, key, {value: converted, enumerable: true, writable: true, configurable: true}); } return result; }\n`;
