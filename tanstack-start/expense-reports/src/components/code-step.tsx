import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '#/lib/utils'
import { Button } from './ui/button'
import { Field, FormError, Input } from './ui/field'
import { Spinner } from './ui/primitives'

// Second step of email sign-in: a single 6-digit field that submits itself.
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
  const [resending, setResending] = useState(false)

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
    setResending(true)
    setError(null)
    try {
      await onResend()
      toast.success('New code sent', { description: `Check ${email}.` })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. It expires in 10 minutes.
      </p>
      <Field label="Code" htmlFor="code">
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(next)
            if (next.length === 6) void verify(next)
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          required
          autoFocus
          disabled={pending}
          placeholder="000000"
          className="h-11 text-center font-mono text-lg tracking-[0.5em] tabular-nums placeholder:tracking-[0.5em]"
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="brand" className="w-full" disabled={pending || code.length !== 6}>
        {pending ? <Spinner /> : null}
        {submitLabel}
        {pending ? null : <ArrowRight />}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-muted-foreground transition hover:text-foreground">
          Use a different email
        </button>
        <button type="button" onClick={resend} disabled={resending} className="text-muted-foreground transition hover:text-foreground disabled:opacity-50">
          {resending ? 'Sending…' : 'Resend code'}
        </button>
      </div>
    </form>
  )
}
