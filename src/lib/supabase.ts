import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!url || !key) {
  // Sem as variáveis o app não funciona; mostra o motivo em vez de uma tela branca.
  document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no projeto da Vercel e publique de novo.</p>'
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não definidas')
}

// Sessão fica salva no navegador e é renovada sozinha: não precisa entrar de novo a cada visita.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Mensagem legível de um erro do Supabase/Postgres. */
export function erroMsg(e: unknown): string {
  if (!e) return 'Erro desconhecido'
  const m = (e as { message?: string }).message ?? String(e)
  if (m.includes('duplicate key')) return 'Já existe um registro com esse código (SKU/nome).'
  if (m.includes('violates foreign key')) return 'Não dá para excluir: este cadastro está ligado a outros registros (ex.: um fornecedor que é o principal de algum material, ou uma categoria em uso). Desfaça o vínculo ou, se existir a opção, desative-o.'
  if (m.includes('Could not find the function') || m.includes('does not exist')) return 'Esta ação precisa de uma atualização no banco que ainda não foi aplicada (arquivo supabase/2026-10-15_editar_excluir.sql).'
  if (m.includes('row-level security') || m.includes('Sem permissão')) return 'Seu perfil não tem permissão para esta ação.'
  if (m.includes('JSON object requested') || m.includes('0 rows')) return 'O registro não foi encontrado ou mudou de situação. Recarregue a página e tente de novo.'
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  if (m.includes('violates check constraint')) return 'Algum valor está fora do permitido (ex.: quantidade precisa ser maior que zero).'
  return m
}
