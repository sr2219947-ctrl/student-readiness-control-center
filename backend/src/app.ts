import express from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { studentsRouter } from './routes/students';

export const app = express();

app.use(requestId);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Everything under /api requires authentication — requireAuth populates
// req.auth (tenantId, userId, role) before any /api/* route handler runs.
app.use('/api', requireAuth, studentsRouter);

app.use(errorHandler);