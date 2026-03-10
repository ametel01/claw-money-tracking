import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CurrencyViewMode } from '@/types';

interface CurrencyControlsProps {
  viewMode: CurrencyViewMode;
  onViewModeChange: (mode: CurrencyViewMode) => void;
}

export function CurrencyControls({ viewMode, onViewModeChange }: CurrencyControlsProps) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor="viewMode"
        className="text-[0.64rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Transaction display
      </Label>
      <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as CurrencyViewMode)}>
        <SelectTrigger id="viewMode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="home">PHP normalized</SelectItem>
          <SelectItem value="native">Native currency</SelectItem>
          <SelectItem value="both">Both</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
