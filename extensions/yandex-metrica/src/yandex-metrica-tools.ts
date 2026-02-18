import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type PluginCfg = {
  oauthToken?: string;
};

const API_MANAGEMENT = "https://api-metrika.yandex.net/management/v1";
const API_STAT = "https://api-metrika.yandex.net/stat/v1/data";

function getToken(api: OpenClawPluginApi): string {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const token = cfg.oauthToken?.trim();
  if (!token) {
    throw new Error(
      "Yandex Metrica OAuth token is not configured. Set oauthToken in the plugin config.",
    );
  }
  return token;
}

async function apiFetch(
  url: string,
  token: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const fullUrl = params ? `${url}?${new URLSearchParams(params)}` : url;
  const res = await fetch(fullUrl, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Yandex Metrica API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export function createYandexMetricaTools(api: OpenClawPluginApi) {
  const listCounters = {
    name: "yandex_list_counters",
    label: "Yandex Metrica: List Counters",
    description:
      "List all Yandex Metrica counters (sites) available for the configured OAuth token.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: Record<string, unknown>) {
      const token = getToken(api);
      const data = (await apiFetch(`${API_MANAGEMENT}/counters`, token)) as {
        counters?: Array<{ id: number; name: string; site: string; status: string }>;
      };
      const counters = (data.counters ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        site: c.site,
        status: c.status,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(counters, null, 2) }],
      };
    },
  };

  const getStats = {
    name: "yandex_get_stats",
    label: "Yandex Metrica: Get Stats",
    description:
      "Fetch statistics from a Yandex Metrica counter. Returns visits, users, and other requested metrics.",
    parameters: Type.Object({
      id: Type.Number({ description: "Counter ID (e.g. 104717880)." }),
      metrics: Type.Optional(
        Type.String({
          description: "Comma-separated metrics list (default: ym:s:visits,ym:s:users).",
        }),
      ),
      dimensions: Type.Optional(
        Type.String({ description: "Comma-separated grouping dimensions (optional)." }),
      ),
      date1: Type.Optional(
        Type.String({
          description:
            "Start date: YYYY-MM-DD, 'today', 'yesterday', or 'NdaysAgo' (default: today).",
        }),
      ),
      date2: Type.Optional(
        Type.String({
          description:
            "End date: YYYY-MM-DD, 'today', 'yesterday', or 'NdaysAgo' (default: today).",
        }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max rows to return (default: 100)." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const token = getToken(api);
      const counterId = params.id;
      if (typeof counterId !== "number") {
        throw new Error("id (counter ID) is required and must be a number");
      }
      const queryParams: Record<string, string> = {
        ids: String(counterId),
        metrics: typeof params.metrics === "string" ? params.metrics : "ym:s:visits,ym:s:users",
        date1: typeof params.date1 === "string" ? params.date1 : "today",
        date2: typeof params.date2 === "string" ? params.date2 : "today",
        limit: typeof params.limit === "number" ? String(params.limit) : "100",
      };
      if (typeof params.dimensions === "string" && params.dimensions.trim()) {
        queryParams.dimensions = params.dimensions;
      }
      const data = await apiFetch(API_STAT, token, queryParams);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  };

  return [listCounters, getStats];
}
