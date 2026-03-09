import path from 'node:path'
import { ExpensesService } from '../server/expenses-service'
import { resolveRootDir } from '../server/root-dir'

const rootDir = resolveRootDir(__dirname)
const service = new ExpensesService(rootDir)

service.ensureSchema()

console.log(`Initialized expenses schema in ${path.join(rootDir, 'money_dashboard.db')}`)
