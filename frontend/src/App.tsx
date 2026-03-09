import { ExpensesDashboardPage } from '@/features/dashboard/components/ExpensesDashboardPage';
import { useExpensesDashboard } from '@/features/dashboard/hooks/useExpensesDashboard';

export function App() {
  const dashboard = useExpensesDashboard();

  return <ExpensesDashboardPage {...dashboard} />;
}
