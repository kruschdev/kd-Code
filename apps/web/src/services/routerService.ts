/**
 * @file routerService.ts
 * Client-side dual-stage router service for KD Code.
 * 
 * Orchestrates:
 * - Stage 0 / L1 Pre-Router (Deterministic syntax evaluation in <15µs CPU)
 * - Stage 1 / L2 Neural Centroid Escalation (via krusch-context-mcp bridge)
 */

import type { ProviderKind } from "@t3tools/contracts";

export interface ResolvedRoute {
  stage: "L1_FAST_PATH" | "L2_NEURAL_CENTROID" | "FALLBACK";
  tier: "fast_edge" | "medium_code" | "heavy";
  role: string;
  recommendedProvider: ProviderKind;
  recommendedModel: string;
  confidence: number;
  reason: string;
  durationMs?: number;
}

const BRIDGE_URL = "http://localhost:3778";

/**
 * Fast client-side syntactic regex checks (L1 fast-path heuristics)
 * Matches code fences, SQL syntax, LaTeX, and regex transformations.
 */
function evaluateL1SyntacticFastPath(prompt: string): { isFastPath: boolean; role?: string; reason?: string } {
  if (!prompt || typeof prompt !== "string") {
    return { isFastPath: false };
  }

  const trimmed = prompt.trim();

  // 1. Triple-backtick code block
  if (/```[\w-]*\n[\s\S]+?```/.test(trimmed)) {
    return { isFastPath: true, role: "code", reason: "code_fence" };
  }

  // 2. SQL DDL / DML keywords
  if (/^\s*(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE)\b/i.test(trimmed)) {
    return { isFastPath: true, role: "code", reason: "sql_syntax" };
  }

  // 3. Diff / Unified patch
  if (/^--- [a-zA-Z0-9_\-./]+\n\+\+\+ [a-zA-Z0-9_\-./]+/m.test(trimmed) || /^(?:diff --git|@@ -\d+,\d+ \+\d+,\d+ @@)/m.test(trimmed)) {
    return { isFastPath: true, role: "code", reason: "patch_diff" };
  }

  // 4. Closed-world tasks (syntax format, regex, JSON convert)
  if (/^(?:format|prettify|lint|convert)\b[\s\S]+?\b(?:to|into)?\s*(?:json|yaml|csv|xml|sql)\b/i.test(trimmed)) {
    return { isFastPath: true, role: "code", reason: "closed_world_transform" };
  }

  // 5. LaTeX mathematical notation
  if (/(?:\$\$[\s\S]+?\$\$|\\[a-zA-Z]+\{[^}]*\}|\b(?:int|sum|prod|frac|sqrt)\b)/.test(trimmed)) {
    return { isFastPath: true, role: "math", reason: "latex_syntax" };
  }

  return { isFastPath: false };
}

/**
 * Route an incoming prompt through the dual-stage router.
 * 1. Checks L1 syntactic gate in CPU microseconds.
 * 2. If ambiguous or missing deterministic structure, queries L2 Neural Centroid bridge.
 */
export async function resolveOptimalRoute(prompt: string): Promise<ResolvedRoute> {
  const t0 = performance.now();

  // 1. L1 Fast Syntactic Gate
  const l1 = evaluateL1SyntacticFastPath(prompt);
  if (l1.isFastPath) {
    const durationMs = performance.now() - t0;
    return {
      stage: "L1_FAST_PATH",
      tier: "fast_edge",
      role: l1.role || "code",
      recommendedProvider: "opencode",
      recommendedModel: "qwen2.5-coder:7b",
      confidence: 1.0,
      reason: `L1 Syntactic Intercept: ${l1.reason}`,
      durationMs: Number(durationMs.toFixed(2)),
    };
  }

  // 2. L2 Neural Centroid Escalation via bridge
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${BRIDGE_URL}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return {
        stage: data.stage || "L2_NEURAL_CENTROID",
        tier: data.tier || "heavy",
        role: data.role || "general",
        recommendedProvider: (data.recommendedProvider as ProviderKind) || "gemini",
        recommendedModel: data.recommendedModel || "gemini-3.1-pro",
        confidence: data.confidence || 0.8,
        reason: data.reason || "L2 Neural Centroid match",
        durationMs: Number((performance.now() - t0).toFixed(2)),
      };
    }
  } catch (err) {
    // Bridge offline or timed out; apply resilient local fallback
  }

  // 3. Fallback routing
  const durationMs = performance.now() - t0;
  const isCodeHeavy = /(?:function|class|import|const|let|async|def|return)\b/.test(prompt);

  return {
    stage: "FALLBACK",
    tier: isCodeHeavy ? "medium_code" : "heavy",
    role: isCodeHeavy ? "code" : "reasoning_deep",
    recommendedProvider: isCodeHeavy ? "claudeAgent" : "gemini",
    recommendedModel: isCodeHeavy ? "claude-3-7-sonnet" : "gemini-3.1-pro",
    confidence: 0.7,
    reason: isCodeHeavy ? "Lexical code indicators detected" : "Default heavy reasoning router fallback",
    durationMs: Number(durationMs.toFixed(2)),
  };
}
