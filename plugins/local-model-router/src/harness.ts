import type { ModelContract } from "./types.ts";

export function generateOmpProviderConfig(baseUrl: string, models: ModelContract[]): string {
  const lines: string[] = [
    "# Add this provider snippet to ~/.omp/agent/models.yml",
    "providers:",
    "  local-fleet:",
    `    baseUrl: ${baseUrl.replace(/\/+$/, "")}`,
    '    apiKey: "local-fleet-token"',
    "    api: openai-completions",
    "    models:",
  ];

  for (const m of models) {
    lines.push(`      - id: ${m.id}`);
    lines.push(`        name: ${m.id} (${m.quantization})`);
    lines.push(`        contextWindow: ${m.contextWindow}`);
    if (m.maxOutputTokens) {
      lines.push(`        maxTokens: ${m.maxOutputTokens}`);
    }
    if (m.reasoning) {
      lines.push("        reasoning: true");
    }
    lines.push("        cost:");
    lines.push("          input: 0");
    lines.push("          output: 0");
    lines.push("          cacheRead: 0");
    lines.push("          cacheWrite: 0");
  }

  return lines.join("\n");
}

export function generatePiProviderConfig(baseUrl: string, models: ModelContract[]): Record<string, unknown> {
  return {
    name: "local-fleet",
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: "local-fleet-token",
    models: models.map((m) => ({
      id: m.id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxOutputTokens ?? 16384,
      reasoning: m.reasoning ?? false,
    })),
  };
}
