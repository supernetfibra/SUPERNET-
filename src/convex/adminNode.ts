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
    const baseUrl = args.apiUrl.replace(/\/$/, "");

    // Try the most common MikWeb API paths
    const paths = [
      { path: "/clientes", label: "cliente" },
      { path: "/api/clientes", label: "cliente (com /api/)" },
    ];

    for (const { path, label } of paths) {
      try {
        const url = `${baseUrl}${path}?cpf_cnpj=00000000000&limit=1`;

        const response = await apiFetch(url, args.apiToken);

        if (response.ok) {
          return {
            success: true,
            message: `Conexão estabelecida com sucesso! (rota: ${label})`,
          };
        }

        // If we got a 404 on the first path, try the next one
        if (response.status === 404) {
          continue;
        }

        // For other status codes, return immediately
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
        // Network error — skip to next path
        continue;
      }
    }

    // All paths failed — show the exact URLs attempted
    const attemptedPaths = paths
      .map(({ path }) => `${baseUrl}${path}?cpf_cnpj=00000000000&limit=1`)
      .join("\n");

    return {
      success: false,
      message: `Não foi possível conectar. URLs testadas:\n${attemptedPaths}\n\nVerifique se a URL da API está correta no campo acima. Se precisar, tente também "https://api.mikweb.com.br" ou "https://www.api.mikweb.com.br" como URL base.`,
    };
  },
});
