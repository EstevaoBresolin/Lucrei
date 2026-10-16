import { useCallback, useEffect, useState } from 'react'
import { erroMsg } from './supabase'

/** Carrega dados de uma função assíncrona e expõe recarregar(). */
export function useLoad<T>(fn: () => PromiseLike<{ data: T | null; error: unknown }>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setCarregando(true)
    const r = await fn()
    if (r.error) setErro(erroMsg(r.error)); else { setErro(null); setData(r.data) }
    setCarregando(false)
  }, deps)
  useEffect(() => { run() }, [run])
  return { data, erro, carregando, recarregar: run }
}
