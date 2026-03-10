import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { ExpensesService } from './expenses-service';
import { resolveRootDir } from './root-dir';

const rootDir = resolveRootDir(__dirname);
const publicRoot = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 8081);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

export function createExpensesApp(service: ExpensesService) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, response, next) => {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    next();
  });

  app.get(
    '/api/expenses/overview',
    asyncHandler(async (_request, response) => {
      response.json(service.getOverview());
    }),
  );

  app.get(
    '/api/expenses/fx',
    asyncHandler(async (_request, response) => {
      response.json(service.listFxRates());
    }),
  );

  app.get(
    '/api/expenses/categories',
    asyncHandler(async (_request, response) => {
      response.json(service.listCategories());
    }),
  );

  app.get(
    '/api/expenses/transactions',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 50, 1, 50000)
      const month = singleQueryValue(request.query.month)
      response.json(service.listTransactions(limit, month));
    }),
  );

  app.get(
    '/api/expenses/import-batches',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 20, 1, 100)
      response.json(service.listImportBatches(limit));
    }),
  );

  app.get(
    '/api/expenses/import-batches/:id',
    asyncHandler(async (request, response) => {
      response.json(service.getImportBatch(requireIdParam(request.params.id, 'batch')));
    }),
  );

  app.get(
    '/api/expenses/categorization-rules',
    asyncHandler(async (_request, response) => {
      response.json(service.listCategorizationRules());
    }),
  );

  app.post(
    '/api/expenses/categorization-rules/from-transaction',
    asyncHandler(async (request, response) => {
      const body = isObject(request.body) ? request.body : {}
      const matchType = typeof body.matchType === 'string' ? body.matchType : undefined
      const priority =
        typeof body.priority === 'number' && Number.isFinite(body.priority)
          ? body.priority
          : undefined
      const pattern = typeof body.pattern === 'string' ? body.pattern : undefined

      response.json(
        service.createCategorizationRuleFromTransaction({
          transactionId: requireBodyId(body.transactionId, 'transaction'),
          categoryId: requireBodyId(body.categoryId, 'category'),
          accountScoped: body.accountScoped !== false,
          ...(matchType ? { matchType } : {}),
          ...(priority != null ? { priority } : {}),
          ...(pattern ? { pattern } : {}),
        }),
      );
    }),
  );

  app.post(
    '/api/expenses/categorization-rules/:id/disable',
    asyncHandler(async (request, response) => {
      response.json(
        service.disableCategorizationRule(requireIdParam(request.params.id, 'categorization rule')),
      );
    }),
  );

  app.get(
    '/api/expenses/analytics/monthly-summary',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 12, 1, 60)
      response.json(service.getMonthlyAnalyticsSummary(limit));
    }),
  );

  app.get(
    '/api/expenses/analytics/category-breakdown',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 8, 1, 20)
      const month = singleQueryValue(request.query.month)
      response.json(service.getCategoryBreakdown(month || undefined, limit));
    }),
  );

  app.get(
    '/api/expenses/analytics/cash-flow',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 12, 1, 60)
      response.json(service.getCashFlow(limit));
    }),
  );

  app.get(
    '/api/expenses/analytics/merchant-leaderboard',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 8, 1, 20)
      const month = singleQueryValue(request.query.month)
      response.json(service.getMerchantLeaderboard(month || undefined, limit));
    }),
  );

  app.get(
    '/api/expenses/analytics/spending-pace',
    asyncHandler(async (request, response) => {
      const month = singleQueryValue(request.query.month)
      response.json(service.getSpendingPaceModel(month));
    }),
  );

  app.get(
    '/api/expenses/budget-periods',
    asyncHandler(async (_request, response) => {
      response.json(service.listBudgetPeriods());
    }),
  );

  app.post(
    '/api/expenses/budget-periods',
    asyncHandler(async (request, response) => {
      const body = isObject(request.body) ? request.body : {}
      const month = typeof body.month === 'string' ? body.month : ''
      response.json(
        service.createBudgetPeriod({
          month,
          ...(typeof body.budgetName === 'string' ? { budgetName: body.budgetName } : {}),
          ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
        }),
      );
    }),
  );

  app.get(
    '/api/expenses/budget-periods/:id',
    asyncHandler(async (request, response) => {
      response.json(service.getBudgetPeriod(requireIdParam(request.params.id, 'budget period')));
    }),
  );

  app.post(
    '/api/expenses/budget-periods/:id/targets',
    asyncHandler(async (request, response) => {
      const body = isObject(request.body) ? request.body : {}
      response.json(
        service.upsertBudgetTarget(
          requireIdParam(request.params.id, 'budget period'),
          requireBodyId(body.categoryId, 'category'),
          requireBodyNumber(body.targetAmount, 'target amount'),
        ),
      );
    }),
  );

  app.delete(
    '/api/expenses/budget-targets/:id',
    asyncHandler(async (request, response) => {
      response.json(service.deleteBudgetTarget(requireIdParam(request.params.id, 'budget target')));
    }),
  );

  app.post(
    '/api/expenses/recurring/recompute',
    asyncHandler(async (_request, response) => {
      response.json(service.recomputeRecurringSeries());
    }),
  );

  app.get(
    '/api/expenses/recurring/insights',
    asyncHandler(async (request, response) => {
      const month = singleQueryValue(request.query.month)
      response.json(service.getRecurringInsights(month || undefined));
    }),
  );

  app.post(
    '/api/expenses/import-rows/:id/accept',
    asyncHandler(async (request, response) => {
      response.json(await service.acceptImportRow(requireIdParam(request.params.id, 'import row')));
    }),
  );

  app.post(
    '/api/expenses/import-rows/:id/reject',
    asyncHandler(async (request, response) => {
      response.json(service.rejectImportRow(requireIdParam(request.params.id, 'import row')));
    }),
  );

  app.post(
    '/api/expenses/fx-rate',
    asyncHandler(async (request, response) => {
      const body = isObject(request.body) ? request.body : {};
      const base = typeof body.base === 'string' ? body.base : 'USD';
      const quote = typeof body.quote === 'string' ? body.quote : 'PHP';
      const rate = Number(body.rate || 0);
      const rateDate = typeof body.date === 'string' ? body.date : undefined;

      response.json(await service.upsertFxRate(base, quote, rate, rateDate));
    }),
  );

  app.post(
    '/api/expenses/fx-backfill',
    asyncHandler(async (_request, response) => {
      response.json(await service.backfillFx());
    }),
  );

  app.post(
    '/api/expenses/import-pdf',
    upload.single('file'),
    asyncHandler(async (request, response) => {
      const file = request.file;
      if (!file?.originalname) {
        response.status(400).json({ ok: false, error: 'file field is required' });
        return;
      }

      if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
        response.status(400).json({ ok: false, error: 'only PDF supported' });
        return;
      }

      const accountNameRaw =
        typeof request.body.accountName === 'string' ? request.body.accountName : '';
      const accountName = accountNameRaw.trim() || 'Default Account';

      response.json(await service.importPdfStatement(accountName, file.originalname, file.buffer));
    }),
  );

  app.get('/expenses', (_request, response) => {
    response.redirect(302, '/');
  });
  app.get(/^\/expenses\/.*/, (_request, response) => {
    response.redirect(302, '/');
  });
  app.use(express.static(publicRoot));
  app.get(/^\/(?!api(?:\/|$)).*/, (_request, response) => {
    response.sendFile(path.join(publicRoot, 'index.html'));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'unexpected server error';
    const status = message === 'invalid JSON body' ? 400 : 500;
    response.status(status).json({ ok: false, error: message });
  });

  return app;
}

if (require.main === module) {
  const service = new ExpensesService(rootDir);
  service.ensureSchema();

  const app = createExpensesApp(service);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Serving money dashboard on http://127.0.0.1:${port}/`);
  });
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function safeInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireIdParam(raw: string | string[] | undefined, label: string): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${label} id`);
  }

  return parsed;
}

function requireBodyId(raw: unknown, label: string): number {
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${label} id`);
  }

  return parsed;
}

function requireBodyNumber(raw: unknown, label: string): number {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${label}`);
  }

  return parsed;
}

function singleQueryValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
