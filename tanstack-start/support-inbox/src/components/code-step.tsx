import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { errorMessage } from '#/lib/utils'
import { Button } from './ui/button'
import { FormError, Input, Label } from './ui/field'
import { Spinner } from './ui/primitives'

const RESEND_SECONDS = 60

// Second step of the email OTP flow: enter the 6-digit code that was emailed.
export function CodeStep({
  email,
  submitLabel,
  onVerify,
  onResend,
  onBack,
}: {
  email: string
  submitLabel: string
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [wait, setWait] = useState(RESEND_SECONDS)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  async function verify(value: string) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onVerify(value)
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (code.length === 6) void verify(code)
  }

  async function resend() {
    setError(null)
    try {
      await onResend()
      setWait(RESEND_SECONDS)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{email}</span> has access, a 6-digit code is on its way. It expires in 15 minutes.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(value)
            if (value.length === 6) void verify(value)
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="000000"
          aria-describedby="code-help"
          className="h-11 text-center font-mono text-lg tracking-[0.5em]"
        />
      </div>
      <FormError message={error} />
      <Button type="submit" variant="brand" className="w-full" disabled={pending || code.length !== 6}>
        {pending ? <Spinner /> : null}
        {submitLabel}
      </Button>
      <div id="code-help" className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Use a different email
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={wait > 0}
          className="text-muted-foreground tabular-nums hover:text-foreground disabled:cursor-default disabled:opacity-60 disabled:hover:text-muted-foreground"
        >
          {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
        </button>
      </div>
    </form>
  )
}
