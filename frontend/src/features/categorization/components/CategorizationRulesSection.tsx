import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CategorizationRuleRecord } from '@/types';

interface CategorizationRulesSectionProps {
  rules: CategorizationRuleRecord[];
  loading: boolean;
  busyRuleId: number | null;
  status: {
    tone: 'idle' | 'pending' | 'success' | 'error';
    message: string;
  };
  onDisableRule: (ruleId: number) => Promise<void>;
}

export function CategorizationRulesSection({
  rules,
  loading,
  busyRuleId,
  status,
  onDisableRule,
}: CategorizationRulesSectionProps) {
  return (
    <div className="grid gap-3">
      <RulesStatus status={status} />

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading categorization rules…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active categorization rules yet.</p>
      ) : (
        rules.map((rule) => (
          <article key={rule.id} className="grid gap-3 rounded-lg border border-border/70 bg-muted/15 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Priority {rule.priority}</Badge>
              <Badge variant="outline">{rule.matchType}</Badge>
              <Badge variant="outline">{rule.active ? 'Active' : 'Inactive'}</Badge>
            </div>

            <div className="grid gap-1">
              <p className="text-xs font-semibold text-foreground">{rule.pattern}</p>
              <p className="text-xs text-muted-foreground">
                Category: {rule.categoryName || 'Unknown'} • Account: {rule.accountName || 'All accounts'}
              </p>
            </div>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyRuleId === rule.id}
                onClick={() => void onDisableRule(rule.id)}
              >
                {busyRuleId === rule.id ? 'Disabling…' : 'Disable rule'}
              </Button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function RulesStatus({
  status,
}: {
  status: {
    tone: 'idle' | 'pending' | 'success' | 'error';
    message: string;
  };
}) {
  if (!status.message || status.tone === 'idle') {
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
