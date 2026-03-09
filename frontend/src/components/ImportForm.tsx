import { importPdfStatement, toErrorMessage } from '@/api/expenses'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FormEvent, useRef, useState } from 'react'

interface ImportFormProps {
  onImported: () => Promise<void>
  latestBatchSummary?: string
}

type Status = { tone: 'idle' | 'pending' | 'success' | 'error'; message: string }

export function ImportForm({ onImported, latestBatchSummary }: ImportFormProps) {
  const [status, setStatus] = useState<Status>({ tone: 'idle', message: '' })
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const accountName = (form.elements.namedItem('accountName') as HTMLInputElement).value.trim()
    const file = (form.elements.namedItem('pdfFile') as HTMLInputElement).files?.[0]

    if (!file) {
      setStatus({ tone: 'error', message: 'Choose a PDF statement first.' })
      return
    }

    setStatus({ tone: 'pending', message: 'Parsing PDF statement…' })

    try {
      const response = await importPdfStatement(accountName, file)
      if (!response.ok) throw new Error(response.error || 'Import failed')

      formRef.current?.reset()
      await onImported()
      setStatus({
        tone: 'success',
        message: `Imported ${response.insertedTransactions ?? 0} transaction(s) from ${response.parsedRows ?? 0} parsed rows.`,
      })
    } catch (error) {
      setStatus({ tone: 'error', message: toErrorMessage(error) })
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      <div className="grid gap-1.5">
        <Label
          htmlFor="accountName"
          className="text-[0.64rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Account name
        </Label>
        <Input
          id="accountName"
          name="accountName"
          placeholder="BPI Visa"
          autoComplete="off"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="pdfFile"
          className="text-[0.64rem] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Statement PDF
        </Label>
        <Input id="pdfFile" name="pdfFile" type="file" accept="application/pdf" required />
      </div>
      <Button type="submit" disabled={status.tone === 'pending'} className="w-full">
        {status.tone === 'pending' ? 'Parsing…' : 'Upload and parse'}
      </Button>
      {latestBatchSummary ? (
        <p className="text-[0.65rem] leading-relaxed text-muted-foreground">{latestBatchSummary}</p>
      ) : null}
      <StatusLine status={status} />
    </form>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.tone === 'idle' || !status.message) {
    return <div className="min-h-[1.1rem]" />
  }

  if (status.tone === 'error') {
    return (
      <Alert variant="destructive" className="py-2">
        <AlertDescription className="text-xs">{status.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <p
      className={
        status.tone === 'success'
          ? 'text-xs text-[var(--color-success)]'
          : 'text-xs text-muted-foreground'
      }
    >
      {status.message}
    </p>
  )
}
