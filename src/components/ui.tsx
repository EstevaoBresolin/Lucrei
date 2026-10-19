import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ---------------- Botões ---------------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'plain'; size?: 'sm' | 'md' }
export function Button({ variant = 'plain', size = 'md', className, onClick, disabled, ...p }: BtnProps) {
  // Se o onClick for assíncrono (salvar, excluir…), o botão fica desabilitado até terminar.
  // Evita salvar duas vezes com clique duplo.
  const [ocupado, setOcupado] = useState(false)
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])
  const clicar = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (ocupado) return
    const r = onClick?.(e) as unknown
    if (r instanceof Promise) {
      setOcupado(true)
      r.finally(() => { if (montado.current) setOcupado(false) })
    }
  }
  return (
    <button
      {...p}
      onClick={clicar}
      disabled={disabled || ocupado}
      aria-busy={ocupado || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-box font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-[15px]',
        variant === 'primary' && 'bg-ink text-base hover:bg-ink/90',
        variant === 'plain' && 'bg-panel border border-line hover:border-muted',
        variant === 'ghost' && 'hover:bg-line/50 text-muted hover:text-ink',
        variant === 'danger' && 'bg-bad text-white hover:bg-bad/90',
        className,
      )}
    />
  )
}

/* ---------------- Campos ---------------- */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5 text-sm', className)}>
      <span className="text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}
const inputCls = 'h-10 rounded-box border border-line px-3 text-[15px] outline-none focus:border-led focus:ring-2 focus:ring-led/30'
const w = (c?: string) => (c && /(^|\s)(max-)?w-/.test(c) ? '' : 'w-full')
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, w(className), className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, w(className), 'pr-8', className)} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(inputCls, 'w-full h-auto min-h-20 py-2', className)} />
)
/** Campo numérico que aceita vírgula. Só aceita negativo quando `negativo` (ex.: saldo de conta). */
export function NumInput({ value, onChange, className, negativo, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onChange: (v: string) => void; negativo?: boolean }) {
  const limpar = (t: string) => {
    const s = t.replace(negativo ? /[^\d.,-]/g : /[^\d.,]/g, '')
    return negativo ? s.replace(/(?!^)-/g, '') : s
  }
  return <Input {...p} inputMode="decimal" value={value} onChange={(e) => onChange(limpar(e.target.value))} className={cx('num text-right', className)} />
}

/* ---------------- Estrutura ---------------- */
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="wide text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
export function Panel({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-box border border-line bg-panel', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}
export function Loading() {
  return <div className="px-6 py-12 text-center text-sm text-muted">Carregando…</div>
}
export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div role="alert" className="rounded-box border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{msg}</div>
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'led'
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
      tone === 'neutral' && 'bg-line/60 text-muted',
      tone === 'good' && 'bg-good/15 text-good',
      tone === 'bad' && 'bg-bad/15 text-bad',
      tone === 'warn' && 'bg-warn/15 text-warn',
      tone === 'led' && 'bg-led/20 text-ledink',
    )}>{children}</span>
  )
}

/* ---------------- Tabela ---------------- */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted [&_th]:whitespace-nowrap [&_th]:px-4 [&_th]:py-2.5 [&_th]:font-medium">{head}</thead>
        <tbody className="[&_td:first-child]:min-w-36 [&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-t [&_tr]:border-line">{children}</tbody>
      </table>
    </div>
  )
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Guarda o onClose mais recente sem refazer o efeito a cada render (o pai costuma passar uma função nova).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    // Esc só fecha avisos/confirmações; formulários não, para não perder o que foi digitado.
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || bodyRef.current?.querySelector('input,select,textarea')) return
      closeRef.current()
    }
    window.addEventListener('keydown', k)
    // Foca só ao abrir, e no primeiro campo do conteúdo (nunca no X do cabeçalho).
    const alvo = bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea')
      ?? ref.current?.querySelector<HTMLElement>('[data-modal-footer] button')
    alvo?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-xl bg-panel shadow-2xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="wide text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div data-modal-footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------- Toast ---------------- */
type ToastT = { id: number; msg: string; tone: 'good' | 'bad' }
const ToastCtx = createContext<(msg: string, tone?: 'good' | 'bad') => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastT[]>([])
  const push = useCallback((msg: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random()
    setList((l) => [...l, { id, msg, tone }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'bad' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {list.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto max-w-md rounded-box px-4 py-2.5 text-sm shadow-lg', t.tone === 'good' ? 'bg-ink text-base' : 'bg-bad text-white')}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/* ---------------- Confirmação ---------------- */
type ConfirmOpts = { titulo: string; mensagem?: ReactNode; confirmar?: string; perigo?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
/** Caixa de confirmação (ex.: antes de excluir). Uso: `if (!(await confirmar({ titulo: 'Excluir?' }))) return` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const confirmar = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setPedido({ ...o, resolve })), [])
  const fechar = (v: boolean) => { pedido?.resolve(v); setPedido(null) }
  return (
    <ConfirmCtx.Provider value={confirmar}>
      {children}
      <Modal open={!!pedido} onClose={() => fechar(false)} title={pedido?.titulo ?? ''}
        footer={<><Button onClick={() => fechar(false)}>Voltar</Button><Button variant={pedido?.perigo === false ? 'primary' : 'danger'} onClick={() => fechar(true)}>{pedido?.confirmar ?? 'Excluir'}</Button></>}>
        <div className="text-sm text-muted">{pedido?.mensagem ?? 'Essa ação não pode ser desfeita.'}</div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}
export const useConfirm = () => useContext(ConfirmCtx)

/** Botão de excluir alinhado à esquerda no rodapé de um modal. */
export function BotaoExcluir({ onClick, disabled, children = 'Excluir' }: { onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return <Button variant="ghost" className="mr-auto text-bad hover:text-bad" disabled={disabled} onClick={onClick}>{children}</Button>
}

/* ---------------- Indicador ---------------- */
export function Stat({ label, value, delta, tone }: { label: string; value: ReactNode; delta?: number | null; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-sm text-muted">{label}</span>
      <span className={cx('wide num text-[22px] font-bold leading-tight', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</span>
      {delta !== undefined && delta !== null && Number.isFinite(delta) && (
        <span className={cx('num text-xs', delta >= 0 ? 'text-good' : 'text-bad')}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}% vs. período anterior
        </span>
      )}
    </div>
  )
}
