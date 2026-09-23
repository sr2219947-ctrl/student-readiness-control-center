import { describe, it, expect } from 'vitest';
import { computeFingerprint, checkIdempotency } from '../../src/domain/idempotency';

describe('computeFingerprint', () => {
  it('produces the same hash for identical payloads', () => {
    const payload = { studentId: 's1', competencyKey: 'frontend', score: 80, evaluatorId: 'e1' };
    expect(computeFingerprint(payload)).toBe(computeFingerprint({ ...payload }));
  });

  it('is insensitive to key order (stable canonicalization)', () => {
    const a = { studentId: 's1', competencyKey: 'frontend', score: 80, evaluatorId: 'e1' };
    const b = { evaluatorId: 'e1', score: 80, competencyKey: 'frontend', studentId: 's1' };
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it('produces different hashes when any field differs', () => {
    const base = { studentId: 's1', competencyKey: 'frontend', score: 80, evaluatorId: 'e1' };
    const changedScore = { ...base, score: 81 };
    expect(computeFingerprint(base)).not.toBe(computeFingerprint(changedScore));
  });
});

describe('checkIdempotency', () => {
  const fingerprint = computeFingerprint({
    studentId: 's1', competencyKey: 'frontend', score: 80, evaluatorId: 'e1',
  });

  it('returns no_record when nothing exists yet for this key', () => {
    const result = checkIdempotency(null, fingerprint);
    expect(result.kind).toBe('no_record');
  });

  it('returns replay when an existing record has a matching fingerprint', () => {
    const existing = { requestFingerprint: fingerprint, responseStatus: 201, responseBody: { id: 'attempt-1' } };
    const result = checkIdempotency(existing, fingerprint);

    expect(result.kind).toBe('replay');
    if (result.kind === 'replay') {
      expect(result.storedStatus).toBe(201);
      expect(result.storedBody).toEqual({ id: 'attempt-1' });
    }
  });

  it('returns conflict when an existing record has a different fingerprint', () => {
    const differentFingerprint = computeFingerprint({
      studentId: 's1', competencyKey: 'frontend', score: 99, evaluatorId: 'e1', // score changed
    });
    const existing = { requestFingerprint: fingerprint, responseStatus: 201, responseBody: { id: 'attempt-1' } };

    const result = checkIdempotency(existing, differentFingerprint);
    expect(result.kind).toBe('conflict');
  });
});