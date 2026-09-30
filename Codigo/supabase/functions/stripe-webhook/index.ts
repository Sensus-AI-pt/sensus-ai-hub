import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "npm:stripe@^13"

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

// Em Deno o constructEvent síncrono falha (SubtleCrypto é assíncrono) —
// é obrigatório usar constructEventAsync com este provider.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
)

async function sendEmail(to: string, subject: string, html: string) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) return
  const from = Deno.env.get('RESEND_FROM') || 'Sensus AI <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendApiKey}`
    },
    body: JSON.stringify({ from, to: [to], subject, html })
  })
  if (!res.ok) {
    console.error('Erro ao enviar email pelo Resend:', await res.text())
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')

  if (!signature) {
    return new Response('Missing stripe signature', { status: 400 })
  }

  try {
    const body = await req.text()
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
    const event = await stripe.webhooks.constructEventAsync(
      body, signature, webhookSecret, undefined, cryptoProvider
    )

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const email = session.customer_details?.email ?? null

      // Fluxo do site: a conta já existe e vem identificada no client_reference_id.
      let userId = session.client_reference_id ?? null
      if (userId) {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
        if (error || !data?.user) userId = null
      }

      // Fluxo direto (Payment Link aberto sem conta): criar a conta como antes.
      let temporaryPassword: string | null = null
      if (!userId && email) {
        temporaryPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 10) + 'A1!'
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: temporaryPassword,
          email_confirm: true
        })
        if (createError || !created?.user) {
          // Conta já existia mas o checkout não trouxe client_reference_id —
          // regista-se a subscrição por email; sem password nova.
          console.error('createUser falhou (conta provavelmente já existe):', createError?.message)
          temporaryPassword = null
        } else {
          userId = created.user.id
          const { error: prefError } = await supabaseAdmin
            .from('user_preferences')
            .insert([{
              user_id: userId,
              theme: 'escuro',
              accent_color: '#FF5733',
              compact_mode: false
            }])
          if (prefError) console.error('Erro ao criar user_preferences:', prefError.message)
        }
      }

      if (!email && !userId) {
        throw new Error('Checkout sem email nem client_reference_id — impossível associar a subscrição')
      }

      const { error: subError } = await supabaseAdmin
        .from('subscriptions')
        .upsert({
          user_id: userId,
          email,
          plan: session.metadata?.plan ?? null,
          billing_interval: session.metadata?.interval ?? null,
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
          stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
          status: 'active',
          updated_at: new Date().toISOString()
        }, { onConflict: 'stripe_subscription_id' })
      if (subError) throw subError

      if (email) {
        const planNames: Record<string, string> = {
          personal: 'Pessoal', creator: 'Criador', commercial: 'Comercial'
        }
        const planName = planNames[session.metadata?.plan ?? ''] ?? 'Sensus AI'
        if (temporaryPassword) {
          await sendEmail(email, 'O teu acesso ao Sensus AI chegou!', `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2>Obrigado pela tua compra!</h2>
              <p>O teu plano <strong>${planName}</strong> está ativo e criámos a tua conta automaticamente.</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Palavra-passe Temporária:</strong> <code style="background: #eee; padding: 2px 6px; border-radius: 4px;">${temporaryPassword}</code></p>
              <br/>
              <p>Recomendamos que alteres a tua palavra-passe nas definições assim que iniciares sessão.</p>
            </div>
          `)
        } else {
          await sendEmail(email, 'O teu plano Sensus AI está ativo!', `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2>Obrigado pela tua compra!</h2>
              <p>O teu plano <strong>${planName}</strong> está ativo na tua conta <strong>${email}</strong>.</p>
              <p>Já podes entrar na app e no site com as tuas credenciais habituais.</p>
            </div>
          `)
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      const { error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', sub.id)
      if (error) console.error('Erro ao cancelar subscrição:', error.message)
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }
})
