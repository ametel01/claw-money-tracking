import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CategoryRecord, TransactionRecord } from '@/types';
import { type FormEvent, useEffect, useState } from 'react';

interface TransactionCategorizationPanelProps {
  transaction: TransactionRecord;
  categories: CategoryRecord[];
  categoriesLoading: boolean;
  creatingTransactionId: number | null;
  status: {
    tone: 'idle' | 'pending' | 'success' | 'error';
    message: string;
    transactionId: number | null;
  };
  onCreateRule: (input: {
    transactionId: number;
    categoryId: number;
    accountScoped: boolean;
    matchType: 'contains' | 'exact' | 'regex';
    pattern: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function TransactionCategorizationPanel({
  transaction,
  categories,
  categoriesLoading,
  creatingTransactionId,
  status,
  onCreateRule,
  onClose,
}: TransactionCategorizationPanelProps) {
  const [categoryId, setCategoryId] = useState<string>('');
  const [matchType, setMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [scope, setScope] = useState<'account' | 'global'>('account');
  const [pattern, setPattern] = useState(transaction.description);

  useEffect(() => {
    const fallbackCategoryId = categories[0]?.id ? String(categories[0].id) : '';
    setCategoryId(
      transaction.category_id != null ? String(transaction.category_id) : fallbackCategoryId,
    );
    setMatchType('contains');
    setScope('account');
    setPattern(transaction.description);
  }, [categories, transaction.category_id, transaction.description, transaction.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCategoryId = Number(categoryId);

    if (!Number.isFinite(parsedCategoryId) || !pattern.trim()) {
      return;
    }

    await onCreateRule({
      transactionId: transaction.id,
      categoryId: parsedCategoryId,
      accountScoped: scope === 'account',
      matchType,
      pattern: pattern.trim(),
    });
  }

  const localStatus = status.transactionId === transaction.id ? status : null;
  const saving = creatingTransactionId === transaction.id;

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="grid gap-1">
        <p className="text-xs font-semibold text-foreground">Create categorization rule</p>
        <p className="text-xs text-muted-foreground">
          Save a rule from this transaction and optionally scope it to the current account only.
        </p>
      </div>

      {categoriesLoading ? (
        <p className="text-xs text-muted-foreground">Loading categories…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select value={matchType} onValueChange={(value) => setMatchType(value as typeof matchType)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Match type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="exact">Exact</SelectItem>
                <SelectItem value="regex">Regex</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="account">Account-scoped</SelectItem>
                <SelectItem value="global">Global rule</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      <Input value={pattern} onChange={(event) => setPattern(event.target.value)} required />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={saving || categoriesLoading || categories.length === 0}
        >
          {saving ? 'Saving rule…' : 'Create rule'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={onClose}
          disabled={saving}
        >
          Close
        </Button>
      </div>

      <CategorizationStatus status={localStatus} />
    </form>
  );
}

function CategorizationStatus({
  status,
}: {
  status:
    | {
        tone: 'idle' | 'pending' | 'success' | 'error';
        message: string;
      }
    | null;
}) {
  if (!status || !status.message || status.tone === 'idle') {
    return null;
  }

  if (status.tone === 'error') {
    return (
      <Alert variant="destructive" className="py-2">
        <AlertDescription className="text-xs">{status.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <p
      className={
        status.tone === 'success' ? 'text-xs text-[var(--color-success)]' : 'text-xs text-muted-foreground'
      }
    >
      {status.message}
    </p>
  );
}
