# Part A — Answers

Candidate: Sakshi Rana | Student ID: 2509401009

---

## A1. Concurrent React requests

Problems in the given code:
1. If I type fast, multiple requests go out, and an older request can come
   back AFTER a newer one — so old data can overwrite new data on screen.
2. Old requests are never cancelled.
3. If the component is removed from the screen while a request is still
   going, the code still tries to update it — React doesn't like this.
4. If the server sends back an error (like 404/500), this code doesn't
   catch that properly, only catches actual network failure.
5. If an error happens, `setLoading(false)` is never called, so the loading
   spinner gets stuck forever.

```jsx
useEffect(() => {
  let cancelled = false;

  setLoading(true);
  setError(null);

  fetch(`/api/students?q=${query}&page=${page}&category=${category}`)
    .then((res) => {
      if (!res.ok) {
        throw new Error('Server error: ' + res.status);
      }
      return res.json();
    })
    .then((data) => {
      if (cancelled) return;
      setRows(data.items);
      setLoading(false);
    })
    .catch((err) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [query, page, category]);
```

Every time the effect runs again (because query/page/category changed), the
cleanup function from the previous run fires first and sets `cancelled =
true` for that old run. So when that old request's response finally
arrives, it checks `cancelled` and does nothing. This fixes both the
out-of-order problem and the unmount problem with one flag. The same
cleanup also runs if the component unmounts, so the same flag covers that
case too.

---

## A2. TypeScript state with no impossible states

```ts
type State =
  | { status: 'loading' }
  | { status: 'success'; data: StudentDetail }
  | { status: 'error'; message: string };

function reducer(state: State, action: any): State {
  if (action.type === 'FETCH_START') {
    return { status: 'loading' };
  }
  if (action.type === 'FETCH_SUCCESS') {
    return { status: 'success', data: action.data };
  }
  if (action.type === 'FETCH_ERROR') {
    return { status: 'error', message: action.message };
  }
  return state;
}
```

`status` can only be one of three values, and each value only has the
fields that make sense for it, so TypeScript won't let me accidentally
write `state.data` when `status === 'error'` — that combination doesn't
exist in the type, so an impossible state can't be represented.

If a refresh fails but I want to keep showing old data, I check in the
component: `if (state.status === 'error' && previousData) show
previousData with an error banner`.

---

## A3. Idempotency and optimistic concurrency

```js
async function createAttempt(req, res) {
  const key = req.headers['idempotency-key'];
  const existing = await db.idempotencyRecords.findOne({ tenantId, key });

  if (existing) {
    return res.status(existing.status).json(existing.responseBody);
  }

  const attempt = await db.attempts.insert({ ...validatedData });
  const responseBody = { id: attempt.id, score: attempt.score };

  await db.idempotencyRecords.insert({ tenantId, key, status: 201, responseBody });
  return res.status(201).json(responseBody);
}
```

Client sends an `Idempotency-Key` header with the request. Server remembers
it processed that key the first time; if the same key comes again, it just
replays the saved response instead of doing the work again — this covers
the mobile-retry case.

For two evaluators editing the same record at once, every row has a
`version` number:

```sql
UPDATE assessments SET score = $1, version = version + 1
WHERE id = $2 AND version = $3;
```

If this updates 0 rows, someone else already changed it — I return an
error telling the client to refresh and try again.

---

## A4. SQL query

```sql
WITH latest_attempt AS (
  SELECT DISTINCT ON (student_id, competency_id)
    student_id, competency_id, score
  FROM attempts
  WHERE voided = false
  ORDER BY student_id, competency_id, submitted_at DESC, id DESC
)
SELECT
  s.id AS student_id,
  COALESCE(SUM(la.score * cw.weight) / NULLIF(SUM(cw.weight), 0), 0) AS calculated_score
FROM students s
CROSS JOIN competency_weights cw
LEFT JOIN latest_attempt la
  ON la.student_id = s.id AND la.competency_id = cw.competency_id
GROUP BY s.id;
```

`WITH latest_attempt` finds, for every student+competency pair, only their
most recent attempt — `DISTINCT ON` keeps the first row per group, ordered
by `submitted_at DESC, id DESC` so the newest wins and exact-time ties are
broken by the higher id. Then for every student, I go through every
competency they're supposed to have (`CROSS JOIN`), attach their latest
score if they have one (`LEFT JOIN`), and if they don't, that score is
NULL, which contributes 0 to the weighted sum.

Index: `attempts(student_id, competency_id, submitted_at)` to make the
`DISTINCT ON` step fast.

---

## A5. Race condition

```sql
BEGIN;
SELECT id FROM students WHERE id = $1 FOR UPDATE;

INSERT INTO attempts (student_id, competency_id, score, submitted_at)
VALUES ($1, $2, $3, now());

UPDATE students SET current_score = (
  SELECT COALESCE(AVG(score), 0) FROM attempts WHERE student_id = $1 AND voided = false
) WHERE id = $1;

COMMIT;
```

`FOR UPDATE` locks this student's row, so if another request tries to
touch the same student at the same time, it has to wait until this
transaction finishes. That means the second request always sees the
correct, up-to-date score before doing its own calculation, so no update
gets silently lost.

---

## A6. MongoDB aggregation

```js
db.activity_events.aggregate([
  { $match: { occurredAt: { $gte: new Date(Date.now() - 24*60*60*1000) } } },
  {
    $group: {
      _id: { tenant: "$tenantId", assessment: "$assessmentId" },
      successCount: { $sum: { $cond: [{ $eq: ["$eventType", "attempt.succeeded"] }, 1, 0] } },
      failCount: { $sum: { $cond: [{ $eq: ["$eventType", "attempt.rejected"] }, 1, 0] } },
    }
  },
  {
    $group: {
      _id: "$_id.tenant",
      totalSuccess: { $sum: "$successCount" },
      totalFail: { $sum: "$failCount" },
      duplicates: { $sum: { $cond: [{ $gt: ["$successCount", 1] }, 1, 0] } },
    }
  }
]);
```

First group by (tenant, assessment) so I can count how many success events
each individual assessment got — if it's more than 1, that's a duplicate.
Then group again by tenant alone to get overall totals. Counting duplicates
needs the per-assessment grouping first; going straight to tenant level
would hide that.

Indexes: `{ tenantId: 1, occurredAt: -1 }` for the time filter,
`{ tenantId: 1, assessmentId: 1 }` for the grouping. Just counting
documents directly would be wrong because one real submission can create
two event documents (e.g. from a retry), inflating the count.

---

## A7. Security review

- tenantId sent by the browser and trusted by the server — biggest issue.
  Someone could change this value and access another tenant's data. Fix:
  always get tenantId from the logged-in user's session/token, never from
  what the client sends in the request body.
- Spreading the whole request body into the create call — lets someone
  send extra fields they shouldn't be able to set. Fix: only pick out the
  exact fields expected: `{ studentId, score, category, notes }`.
- Rendering notes as HTML — if someone types a `<script>` tag into notes
  and it gets rendered as real HTML, that script runs in other people's
  browsers. Fix: render it as plain text (React escapes text by default
  unless `dangerouslySetInnerHTML` is used).

Ranked: tenantId trust issue first (breaks tenant isolation completely),
mass assignment second, XSS third.

---

## A8. Tests

- Unit test for score calculation — check known input combinations give
  the expected score and status (READY, INCOMPLETE etc).
- Integration test — call the API to create an attempt, then check the
  database has the right row and the score updated correctly.
- Idempotency test — call the same create-attempt request twice with the
  same key, check only one row got created.
- Frontend test — simulate two API responses coming back in the wrong
  order, check the UI shows the correct (latest) one.
- Authorization test — try to access another tenant's student, check I get
  blocked with a generic error, not one that reveals the data exists.

I would not mock the actual database in the integration tests — a real
(test) Postgres database is the only way to actually catch the race
conditions and rollback bugs this assessment is about.

---

## A9. Git recovery

1. Stop anyone else from pushing to the branch right now.
2. Use `git reflog` to find the commit hash from before the bad rebase —
   reflog keeps a local history even after rebase/force-push.
3. Save that commit somewhere safe (make a new branch pointing to it)
   before doing anything else.
4. Instead of force-pushing over everything again, create a new branch
   from that safe commit, add back any real changes that happened after
   (but not the leaking part), and merge it normally through a pull
   request — keeps a clean, honest history.
5. Since this leaked cross-tenant data, check logs to see who might have
   seen the leaked data while the bug was live.

