require('dotenv').config()
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const KIWIFY_WEBHOOK_SECRET = process.env.KIWIFY_WEBHOOK_SECRET

function verifySignature(req) {
  const signature = req.headers['x-kiwify-signature']
  if (!signature) return false

  const hmac = crypto.createHmac('sha256', KIWIFY_WEBHOOK_SECRET)
  const digest = hmac.update(JSON.stringify(req.body)).digest('hex')
  
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))
}

function getPlanFromProductName(productName) {
  if (productName.toLowerCase().includes('barbeiro')) return 'barbeiro'
  if (productName.toLowerCase().includes('crescimento')) return 'crescimento'
  if (productName.toLowerCase().includes('dominação')) return 'dominacao'
  return null
}

app.post('/api/kiwify/webhook', async (req, res) => {
  try {
    // Verifica a assinatura de segurança
    if (!verifySignature(req)) {
      return res.status(401).json({ error: 'Assinatura inválida' })
    }

    const { customer, product, status } = req.body
    console.log('Webhook recebido:', { customer, product, status })

    if (status === 'APPROVED' || status === 'ACTIVE') {
      const plan = getPlanFromProductName(product.name)
      if (!plan) {
        console.log('Plano não reconhecido:', product.name)
        return res.status(200).json({ ok: true })
      }

      // Atualiza o perfil do usuário no Supabase
      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_plan: plan,
          subscription_status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('email', customer.email)

      if (error) {
        console.error('Erro ao atualizar perfil:', error)
        return res.status(500).json({ error: 'Erro interno' })
      }

      console.log(`Plano ${plan} ativado para ${customer.email}`)
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Erro no webhook:', error)
    res.status(500).json({ error: 'Erro interno' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Servidor de webhook rodando na porta ${PORT}`)
})
