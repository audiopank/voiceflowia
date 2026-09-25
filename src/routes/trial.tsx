import { createFileRoute, redirect } from '@tanstack/react-router'

// LINK CURTO DE DIVULGAÇÃO (25/09): voiceflowia-up1.vercel.app/trial
// Cabe num post, num áudio ("acesse barra trial") e num print. Aqui só redireciona
// pro cadastro com o trial ligado — a regra do trial continua toda no /cadastro.
// Pros robôs de preview, o vercel.json entrega o cartão de /api/og?rota=trial.
export const Route = createFileRoute('/trial')({
  beforeLoad: () => {
    throw redirect({ to: '/cadastro', search: { trial: '1' } })
  },
  component: () => null,
})
