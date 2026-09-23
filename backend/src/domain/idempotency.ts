import { createHash } from 'crypto';

// Fingerprint = hash of the parts of the request body that must match on retry.
// If a retried key arrives with a DIFFERENT fingerprint, that's a real conflict, not a replay.
export function computeFingerprint(payload: {
  studentId: string;
  competencyKey: string;
  score: number;
  evaluatorId: string;
}): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export type IdempotencyCheckResult =
  | { kind: 'no_record' }                                           // first time seeing this key -> proceed
  | { kind: 'replay'; storedStatus: number; storedBody: unknown }    // same key + same body -> resend stored response
  | { kind: 'conflict' };                                            // same key + different body -> reject

// Pure decision: given an existing DB record for this (tenant, key) — or none —
// and the fingerprint of the incoming request, decide what to do.
// The actual DB lookup/write happens later in attemptService.ts (Stage 6).
export function checkIdempotency(
  existingRecord: { requestFingerprint: string; responseStatus: number; responseBody: unknown } | null,
  incomingFingerprint: string
): IdempotencyCheckResult {
  if (existingRecord === null) {
    return { kind: 'no_record' };
  }
  if (existingRecord.requestFingerprint === incomingFingerprint) {
    return { kind: 'replay', storedStatus: existingRecord.responseStatus, storedBody: existingRecord.responseBody };
  }
  return { kind: 'conflict' };
}