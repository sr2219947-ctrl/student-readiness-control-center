CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','evaluator','viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  current_score NUMERIC(5,2),              -- cached, recomputed on each attempt
  status        TEXT NOT NULL DEFAULT 'INCOMPLETE',
  version       INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE competencies (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key     TEXT NOT NULL UNIQUE,             -- 'frontend' | 'backend' | 'databases' | 'problem_solving'
  weight  NUMERIC(4,3) NOT NULL             -- 0.30, 0.30, 0.25, 0.15
);

CREATE TABLE attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  student_id     UUID NOT NULL REFERENCES students(id),
  competency_id  UUID NOT NULL REFERENCES competencies(id),
  score          NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  evaluator_id   UUID NOT NULL REFERENCES users(id),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_void        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attempts_student_competency
  ON attempts (student_id, competency_id, submitted_at DESC, id DESC)
  WHERE is_void = false;
-- ^ this index directly answers A4: "latest attempt per student+competency, ties by id"

CREATE INDEX idx_students_tenant_status ON students (tenant_id, status);
-- ^ supports the tenant-scoped list + status filter without a full scan

CREATE TABLE idempotency_records (
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  idempotency_key     TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,        -- hash of {studentId, competencyId, score, evaluatorId}
  response_status      INTEGER NOT NULL,
  response_body        JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)   -- <- the unique constraint your Part C incident was missing!
);