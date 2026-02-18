import type { AnyAgentTool, OpenClawPluginApi } from "../../src/plugins/types.js";
import { createYandexMetricaTools } from "./src/yandex-metrica-tools.js";

export default function register(api: OpenClawPluginApi) {
  for (const tool of createYandexMetricaTools(api)) {
    api.registerTool(tool as unknown as AnyAgentTool, { optional: true });
  }
}
