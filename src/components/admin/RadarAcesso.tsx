import { useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Radar as RadarIcon, UserCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ADMIN_EMAIL } from '../../lib/plans'
import { Button } from '../ui/button'
import { Field, inputClass } from './shared'

const DIAS_PADRAO = 365

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

/**
 * Libera o add-on RADAR PRO na mão.
 *
 * A compra pela Kiwify já concede sozinha (o webhook grava radar_expires_at),
 * mas não havia NENHUM caminho no app pra conceder fora dela: nem pro próprio
 * dono testar o módulo, nem pra um cliente que pagou por PIX/combinado. A única
 * saída era rodar SQL no banco.
 */
export function RadarAcesso() {
  const [email, setEmail] = useState('')
  const [dias, setDias] = useState(String(DIAS_PADRAO))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  // `diasFixos` existe pro atalho "Liberar na minha conta": o campo de dias fica
  // embaixo do divisor, visualmente dentro da seção "outra pessoa" — deixar o
  // atalho ler esse campo faria ele conceder 30 dias porque alguém digitou 30
  // ali pra outro cliente. O atalho é sempre um ano.
  async function liberar(paraEmail: string, diasFixos?: number) {
    const alvo = paraEmail.trim().toLowerCase()
    if (!alvo) return setErro('Informe o e-mail de quem vai receber o Radar.')

    const numDias = diasFixos ?? Number(dias)
    if (!Number.isFinite(numDias) || numDias < 1) {
      return setErro('Quantidade de dias inválida.')
    }

    setSalvando(true)
    setErro('')
    setSucesso('')
    try {
      const { data, error } = await supabase.rpc('grant_radar_access', {
        p_email: alvo,
        p_days: Math.floor(numDias),
      })
      if (error) throw error

      const perfil = Array.isArray(data) ? data[0] : data
      setSucesso(
        `Radar liberado para ${alvo} até ${formatDate(perfil?.radar_expires_at)}. ` +
          'Se for a sua própria conta, recarregue o painel pra ver o módulo.',
      )
    } catch (err: any) {
      const msg = String(err?.message || '')
      // A RPC devolve mensagens específicas: vale repassar em vez de engolir num
      // "erro genérico", porque cada uma pede uma ação diferente do admin.
      if (/não encontrado/i.test(msg)) {
        setErro(`Não existe conta com o e-mail ${alvo}. A pessoa precisa se cadastrar primeiro — depois você libera aqui.`)
      } else if (/não autorizado/i.test(msg)) {
        setErro('O banco recusou: só a conta admin pode liberar o Radar.')
      } else if (/function|does not exist/i.test(msg)) {
        setErro('A função grant_radar_access não existe no banco. Rode o MIGRATION_RADAR.sql no SQL Editor do Supabase.')
      } else {
        setErro(`Não consegui liberar agora: ${msg || 'erro desconhecido'}`)
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <span className="text-red-300 text-sm">{erro}</span>
        </div>
      )}
      {sucesso && (
        <div className="p-4 bg-green-900/20 border border-green-700 rounded-xl flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0 mt-0.5" />
          <span className="text-green-300 text-sm">{sucesso}</span>
        </div>
      )}

      <div className="bg-[#111111] border border-gray-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <RadarIcon className="w-6 h-6 text-[#2563EB] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-bold text-white">Liberar RADAR PRO</h3>
            <p className="text-sm text-gray-500">
              Quem compra pela Kiwify já recebe automaticamente. Use aqui pra testar você mesmo, dar
              cortesia, ou atender quem pagou por fora.
            </p>
          </div>
        </div>

        {/* Atalho pro caso mais comum: o dono querendo abrir o próprio módulo. */}
        <Button
          onClick={() => void liberar(ADMIN_EMAIL, DIAS_PADRAO)}
          disabled={salvando}
          className="bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-2"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
          Liberar 1 ano na minha conta ({ADMIN_EMAIL})
        </Button>

        <div className="border-t border-gray-800 pt-4 space-y-4">
          <p className="text-sm text-gray-400">Ou libere pra outra pessoa:</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Field label="E-mail da conta" hint="Precisa ser um e-mail que já se cadastrou no VoiceFlow.">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@email.com"
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Dias de acesso" hint="365 = um ano.">
              <input
                type="number"
                min={1}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Button
            onClick={() => liberar(email)}
            disabled={salvando || !email.trim()}
            className="bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 flex items-center gap-2"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RadarIcon className="w-4 h-4" />}
            Liberar Radar
          </Button>
        </div>
      </div>
    </div>
  )
}
