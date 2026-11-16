import { useState, type KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, Tag, X } from 'lucide-react'

export function TagEditor({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  function commit() {
    const tag = value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 48)
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
    setValue('')
    setAdding(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      setValue('')
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag className="size-3.5 text-muted-foreground" aria-hidden />
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-md border bg-secondary pr-1 pl-2 text-xs text-secondary-foreground">
          <Link to="/inbox/$folder" params={{ folder: 'open' }} search={{ tag }} className="hover:underline">
            {tag}
          </Link>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((existing) => existing !== tag))}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder="tag name"
          maxLength={48}
          className="h-6 w-28 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:border-ring"
        />
      ) : (
        <button
          type="button"
          disabled={disabled || tags.length >= 20}
          onClick={() => setAdding(true)}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition hover:border-solid hover:text-foreground"
        >
          <Plus className="size-3" />
          Tag
        </button>
      )}
    </div>
  )
}
