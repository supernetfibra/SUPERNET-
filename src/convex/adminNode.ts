/**
 * Admin Node.js Actions — Functions that require Node.js runtime.
 * Separated from admin.ts to avoid "use node" restrictions on mutations/queries.
 */

"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import https from "https";
import http from "http";

// ---------------------------------------------------------------------------
// Test API Connection — validates the configured credentials
// Uses Node.js https directly to bypass SSL cert issues with self-signed certs
// ---------------------------------------------------------------------------

function apiFetch(
  url: string,
  token: string
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const mod = isHttps ? https : http;

    const agent = isHttps
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      agent,
      timeout: 15000,
    };

    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        resolve({
          ok:
            res.statusCode !== undefined &&
            res.statusCode >= 200 &&
            res.statusCode < 300,
          status: res.statusCode || 0,
          statusText: res.statusMessage || "",
          body: data,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Tempo limite da requisição excedido (15s)."));
    });

    req.on("error", reject);
    req.end();
  });
}

export const testApiConnection = action({
  args: {
    apiUrl: v.string(),
    apiToken: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const url = `${args.apiUrl.replace(/\/$/, "")}/clientes?cpf_cnpj=00000000000&limit=1`;

      const response = await apiFetch(url, args.apiToken);

      if (response.ok) {
        return { success: true, message: "Conexão estabelecida com sucesso!" };
      }

      // Try to parse the response body for a better error message
      let errorBody = "";
      try {
        const parsed = JSON.parse(response.body);
        errorBody = parsed.error || parsed.message || "";
      } catch {
        errorBody = response.body.slice(0, 200);
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: `Token inválido ou sem permissão (HTTP ${response.status}).${errorBody ? ` ${errorBody}` : ""}`,
        };
      }

      return {
        success: false,
        message: `Erro HTTP ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ""}`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Erro de conexão: ${err instanceof Error ? err.message : "Desconhecido"}`,
      };
    }
  },
});
