/**
 * @file contextStateService.ts
 * Manages project state compilation and memory persistence on the Postgres plane
 * for KD Code. Guarantees zero context loss across model switches.
 */

const BRIDGE_URL = "http://localhost:3778";

export interface ProjectStateResponse {
  project: string;
  stateMarkdown: string;
}

/**
 * Fetch the latest compiled project state (priorities, lessons, outcomes, nudges)
 * from the Postgres memory plane.
 */
export async function fetchProjectState(projectName: string = "krusch-ide"): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${BRIDGE_URL}/api/state?project=${encodeURIComponent(projectName)}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data: ProjectStateResponse = await res.json();
      return data.stateMarkdown || null;
    }
  } catch (e) {
    // Graceful offline fallback
    console.warn("[KD Code Context] Project state fetch skipped (bridge offline or unreachable)");
  }
  return null;
}

/**
 * Format compiled project state into an injected system context block.
 */
export function formatContextEnvelope(stateMarkdown: string): string {
  if (!stateMarkdown || !stateMarkdown.trim()) return "";
  return `\n\n---
### 🧠 KD CODE PERSISTENT PROJECT CONTEXT (PostgreSQL Memory Plane)
The following architectural facts, active priorities, and lessons are persisted in the database across all models and sessions:

${stateMarkdown.trim()}
---
\n`;
}

/**
 * Commit a new memory item to the Postgres plane at the conclusion of an architectural step.
 */
export async function recordTurnMemory(
  content: string,
  category: "priorities" | "bugs" | "outcomes" | "lessons" | "activity" = "lessons",
  project: string = "krusch-ide",
): Promise<boolean> {
  if (!content || !content.trim()) return false;
  try {
    const res = await fetch(`${BRIDGE_URL}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, content, category }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Commit a behavioral steering nugget to the Postgres plane.
 */
export async function recordSteeringNudge(
  nudge: string,
  project: string = "krusch-ide",
): Promise<boolean> {
  if (!nudge || !nudge.trim()) return false;
  try {
    const res = await fetch(`${BRIDGE_URL}/api/nudge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, nudge }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
