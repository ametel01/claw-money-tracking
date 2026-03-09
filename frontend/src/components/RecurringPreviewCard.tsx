export function RecurringPreviewCard() {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-foreground">No recurring series yet.</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Recurring detection will populate this card once series persistence lands. Until then, the
        dashboard keeps the preview explicit instead of showing guessed subscriptions.
      </p>
    </div>
  )
}
