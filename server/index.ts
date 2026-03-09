import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { ExpensesService } from './expenses-service'
import { resolveRootDir } from './root-dir'

const rootDir = resolveRootDir(__dirname)
const publicRoot = path.join(rootDir, 'public')
const expensesRoot = path.join(publicRoot, 'expenses')
const port = Number(process.env.PORT || 8081)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
})

export function createExpensesApp(service: ExpensesService) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use((_req, response, next) => {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    next()
  })

  app.get('/', (_request, response) => {
    response.redirect(302, '/expenses/')
  })

  app.get(
    '/api/expenses/overview',
    asyncHandler(async (_request, response) => {
      response.json(service.getOverview())
    })
  )

  app.get(
    '/api/expenses/fx',
    asyncHandler(async (_request, response) => {
      response.json(service.listFxRates())
    })
  )

  app.get(
    '/api/expenses/transactions',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 50, 1, 400)
      response.json(service.listTransactions(limit))
    })
  )

  app.get(
    '/api/expenses/import-batches',
    asyncHandler(async (request, response) => {
      const limit = safeInt(request.query.limit, 20, 1, 100)
      response.json(service.listImportBatches(limit))
    })
  )

  app.get(
    '/api/expenses/import-batches/:id',
    asyncHandler(async (request, response) => {
      response.json(service.getImportBatch(requireIdParam(request.params.id, 'batch')))
    })
  )

  app.post(
    '/api/expenses/import-rows/:id/accept',
    asyncHandler(async (request, response) => {
      response.json(await service.acceptImportRow(requireIdParam(request.params.id, 'import row')))
    })
  )

  app.post(
    '/api/expenses/import-rows/:id/reject',
    asyncHandler(async (request, response) => {
      response.json(service.rejectImportRow(requireIdParam(request.params.id, 'import row')))
    })
  )

  app.post(
    '/api/expenses/fx-rate',
    asyncHandler(async (request, response) => {
      const body = isObject(request.body) ? request.body : {}
      const base = typeof body.base === 'string' ? body.base : 'USD'
      const quote = typeof body.quote === 'string' ? body.quote : 'PHP'
      const rate = Number(body.rate || 0)
      const rateDate = typeof body.date === 'string' ? body.date : undefined

      response.json(await service.upsertFxRate(base, quote, rate, rateDate))
    })
  )

  app.post(
    '/api/expenses/fx-backfill',
    asyncHandler(async (_request, response) => {
      response.json(await service.backfillFx())
    })
  )

  app.post(
    '/api/expenses/import-pdf',
    upload.single('file'),
    asyncHandler(async (request, response) => {
      const file = request.file
      if (!file?.originalname) {
        response.status(400).json({ ok: false, error: 'file field is required' })
        return
      }

      if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
        response.status(400).json({ ok: false, error: 'only PDF supported' })
        return
      }

      const accountNameRaw =
        typeof request.body.accountName === 'string' ? request.body.accountName : ''
      const accountName = accountNameRaw.trim() || 'Default Account'

      response.json(await service.importPdfStatement(accountName, file.originalname, file.buffer))
    })
  )

  app.use('/expenses', express.static(expensesRoot))
  app.get('/expenses', (_request, response) => {
    response.redirect(302, '/expenses/')
  })
  app.get(/^\/expenses\/.*/, (_request, response) => {
    response.sendFile(path.join(expensesRoot, 'index.html'))
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'unexpected server error'
    const status = message === 'invalid JSON body' ? 400 : 500
    response.status(status).json({ ok: false, error: message })
  })

  return app
}

if (require.main === module) {
  const service = new ExpensesService(rootDir)
  service.ensureSchema()

  const app = createExpensesApp(service)
  app.listen(port, '0.0.0.0', () => {
    console.log(`Serving money dashboard on http://127.0.0.1:${port}/expenses/`)
  })
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next)
  }
}

function safeInt(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }

  return Math.max(minimum, Math.min(maximum, parsed))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireIdParam(raw: string | string[] | undefined, label: string): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${label} id`)
  }

  return parsed
}
