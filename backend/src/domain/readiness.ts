export type CompetencyKey = 'frontend' | 'backend' | 'databases' | 'problem_solving';

export const COMPETENCY_WEIGHTS: Record<CompetencyKey, number> = {
  frontend: 0.30,
  backend: 0.30,
  databases: 0.25,
  problem_solving: 0.15,
};

export type ReadinessStatus =
  | 'READY' | 'NEARLY_READY' | 'DEVELOPING' | 'NEEDS_PREPARATION' | 'INCOMPLETE';

// One "latest valid attempt" per competency — or null if none exists yet.
export type LatestAttempt = { competencyKey: CompetencyKey; score: number } | null;

export interface ReadinessResult {
  overallScore: number | null; // null when INCOMPLETE — never show a misleading number
  status: ReadinessStatus;
}

export function calculateReadiness(
  latestAttempts: Record<CompetencyKey, LatestAttempt>
): ReadinessResult {
  const keys = Object.keys(COMPETENCY_WEIGHTS) as CompetencyKey[];

  // Rule: ANY missing required competency => INCOMPLETE, full stop.
  const missing = keys.some((k) => latestAttempts[k] === null);
  if (missing) {
    return { overallScore: null, status: 'INCOMPLETE' };
  }

  const weightedSum = keys.reduce((sum, k) => {
    const score = latestAttempts[k]!.score;
    return sum + score * COMPETENCY_WEIGHTS[k];
  }, 0);

  const overallScore = Math.round(weightedSum * 100) / 100;

  let status: ReadinessStatus;
  if (overallScore >= 80) status = 'READY';
  else if (overallScore >= 65) status = 'NEARLY_READY';
  else if (overallScore >= 50) status = 'DEVELOPING';
  else status = 'NEEDS_PREPARATION';

  return { overallScore, status };
}

// Given all non-void attempts for one competency, pick the "current" one.
// Rule: latest submitted_at wins; equal timestamps resolved by highest attempt id.
export function pickLatestAttempt<T extends { submittedAt: string; id: string; score: number }>(
  attempts: T[]
): T | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((latest, current) => {
    if (current.submittedAt > latest.submittedAt) return current;
    if (current.submittedAt === latest.submittedAt && current.id > latest.id) return current;
    return latest;
  });
}