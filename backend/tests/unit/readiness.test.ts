import { describe, it, expect } from 'vitest';
import {
  calculateReadiness,
  pickLatestAttempt,
  type LatestAttempt,
  type CompetencyKey,
} from '../../src/domain/readiness';

describe('calculateReadiness', () => {
  const allPresent = (scores: Record<CompetencyKey, number>): Record<CompetencyKey, LatestAttempt> => ({
    frontend: { competencyKey: 'frontend', score: scores.frontend },
    backend: { competencyKey: 'backend', score: scores.backend },
    databases: { competencyKey: 'databases', score: scores.databases },
    problem_solving: { competencyKey: 'problem_solving', score: scores.problem_solving },
  });

  it('returns INCOMPLETE when any competency is missing, regardless of other scores', () => {
    const attempts = allPresent({ frontend: 100, backend: 100, databases: 100, problem_solving: 100 });
    attempts.databases = null; // simulate missing competency

    const result = calculateReadiness(attempts);

    expect(result.status).toBe('INCOMPLETE');
    expect(result.overallScore).toBeNull();
  });

  it('computes the correct weighted mean when all four competencies are present', () => {
    // 80*0.30 + 80*0.30 + 80*0.25 + 80*0.15 = 80 exactly
    const attempts = allPresent({ frontend: 80, backend: 80, databases: 80, problem_solving: 80 });

    const result = calculateReadiness(attempts);

    expect(result.overallScore).toBe(80);
    expect(result.status).toBe('READY'); // boundary: exactly 80 => READY
  });

  it('returns READY at and above 80', () => {
    const attempts = allPresent({ frontend: 90, backend: 90, databases: 90, problem_solving: 90 });
    expect(calculateReadiness(attempts).status).toBe('READY');
  });

  it('returns NEARLY_READY between 65 and just under 80', () => {
    const attempts = allPresent({ frontend: 70, backend: 70, databases: 70, problem_solving: 70 });
    expect(calculateReadiness(attempts).status).toBe('NEARLY_READY');
  });

  it('returns DEVELOPING between 50 and just under 65', () => {
    const attempts = allPresent({ frontend: 55, backend: 55, databases: 55, problem_solving: 55 });
    expect(calculateReadiness(attempts).status).toBe('DEVELOPING');
  });

  it('returns NEEDS_PREPARATION below 50', () => {
    const attempts = allPresent({ frontend: 40, backend: 40, databases: 40, problem_solving: 40 });
    expect(calculateReadiness(attempts).status).toBe('NEEDS_PREPARATION');
  });

  it('weights competencies unevenly, not as a plain average', () => {
    // High frontend/backend (30% each), zero on the rest — plain average would be 50, weighted should differ
    const attempts = allPresent({ frontend: 100, backend: 100, databases: 0, problem_solving: 0 });
    const result = calculateReadiness(attempts);
    // 100*0.30 + 100*0.30 + 0*0.25 + 0*0.15 = 60
    expect(result.overallScore).toBe(60);
    expect(result.status).toBe('DEVELOPING');
  });
});

describe('pickLatestAttempt', () => {
  it('returns null for an empty attempts array', () => {
    expect(pickLatestAttempt([])).toBeNull();
  });

  it('picks the attempt with the latest submittedAt', () => {
    const attempts = [
      { id: '1', submittedAt: '2026-01-01T10:00:00Z', score: 60 },
      { id: '2', submittedAt: '2026-01-02T10:00:00Z', score: 75 },
      { id: '3', submittedAt: '2026-01-01T12:00:00Z', score: 90 },
    ];
    expect(pickLatestAttempt(attempts)?.id).toBe('2');
  });

  it('breaks a tie on equal submittedAt by the highest id', () => {
    const attempts = [
      { id: '10', submittedAt: '2026-01-01T10:00:00Z', score: 60 },
      { id: '25', submittedAt: '2026-01-01T10:00:00Z', score: 75 },
      { id: '18', submittedAt: '2026-01-01T10:00:00Z', score: 90 },
    ];
    // Highest id string-wise — since these are UUIDs in real use, string compare is what the app does
    expect(pickLatestAttempt(attempts)?.id).toBe('25');
  });
});