import { inspect } from "node:util";

const escape = (value) =>
  String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");

export default async function* report(source) {
  for await (const event of source) {
    if (event.type === "test:pass") yield `PASS ${event.data.name}\n`;
    else if (event.type === "test:fail") {
      const diagnostic = inspect(event.data.details.error, {
        depth: 8,
        colors: false,
      }).slice(0, 16000);
      yield `FAIL ${event.data.name}\n${diagnostic}\n`;
      yield `::error title=${escape(event.data.name).replaceAll(",", "%2C")}::${escape(diagnostic)}\n`;
    } else if (event.type === "test:diagnostic" || event.type === "test:stderr")
      yield `${event.data.message}\n`;
  }
}
