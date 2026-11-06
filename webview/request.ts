import type { ClientMessage, QuickTest } from "../src/model";
import { integrationBuilder } from "./integrations";
import { workloadBuilder } from "./builder";

export function requestEditor(
  config: QuickTest,
  post: (m: ClientMessage) => void,
): HTMLElement {
  const root = document.createElement("div");
  const field = (
    label: string,
    value: string,
    update: (v: string) => void,
    options?: string[],
    multiline = false,
  ) => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const title = document.createElement("span");
    title.textContent = label;
    const input = options
      ? document.createElement("select")
      : multiline
        ? document.createElement("textarea")
        : document.createElement("input");
    if (options)
      for (const option of options) {
        const o = document.createElement("option");
        o.value = option;
        o.textContent = option;
        input.append(o);
      }
    input.setAttribute("aria-label", label);
    if (label === "Request target URL") input.dataset.bindingTarget = "url";
    if (label === "Request payload") input.dataset.bindingTarget = "body";
    input.value = value;
    input.addEventListener("change", () => {
      try {
        update(input.value);
        input.setCustomValidity("");
      } catch {
        input.setCustomValidity("Enter a valid value.");
      }
    });
    wrap.append(title, input);
    return wrap;
  };
  root.append(
    field("Request target URL", config.url, (v) => (config.url = v)),
    field("Request method", config.method, (v) => (config.method = v), [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]),
    field(
      "Request headers as JSON",
      JSON.stringify(config.headers),
      (v) => (config.headers = JSON.parse(v)),
      undefined,
      true,
    ),
    field(
      "Request body format",
      config.bodyMode,
      (v) => (config.bodyMode = v as QuickTest["bodyMode"]),
      ["text", "json", "form", "multipart"],
    ),
    field(
      "Request payload",
      config.body,
      (v) => (config.body = v),
      undefined,
      true,
    ),
    field(
      "Request think time (seconds)",
      String(config.sleep),
      (v) => (config.sleep = Number(v)),
    ),
  );
  const integrations = integrationBuilder(config, post, [], true);
  const checks = workloadBuilder(config, [], true);
  integrations.addEventListener("protocolChanged", () =>
    checks.dispatchEvent(new Event("refreshBuilder")),
  );
  root.append(integrations, checks);
  root.addEventListener("insertBinding", (event) => {
    event.stopPropagation();
    const { target, placeholder } = (
      event as CustomEvent<{ target: string; placeholder: string }>
    ).detail;
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-binding-target="${target}"]`,
    );
    if (input) {
      input.setRangeText(
        placeholder,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
        "end",
      );
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    }
  });
  return root;
}
