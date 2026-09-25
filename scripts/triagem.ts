// Roda a triagem localmente (teste/manual), fora do Netlify.
//
//   npm run triagem -- <cardId> [--dry-run] [--force]
//   npm run triagem -- --fase [--dry-run]      # cards da fase Triagem ainda sem triagem
//
// Lê as variáveis de .env (ANTHROPIC_API_KEY, PIPEFY_API_TOKEN, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, PIPEFY_TRIAGEM_PHASE_ID...). Sem o cache do
// dashboard (Netlify Blobs), a capacidade atual aparece como desconhecida.
import { triarCard, resolverCampoIa } from '../netlify/lib/triagem/index'
import { getCard, listPhaseCards } from '../netlify/lib/triagem/pipefy'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')
  const ids = args.filter((a) => !a.startsWith('--'))

  if (args.includes('--fase')) {
    const fase = process.env.PIPEFY_TRIAGEM_PHASE_ID
    if (!fase) throw new Error('Defina PIPEFY_TRIAGEM_PHASE_ID')
    const cards = await listPhaseCards(fase)
    if (cards.length) {
      const campoIaId = await resolverCampoIa(await getCard(cards[0].id))
      ids.push(...cards.filter((c) => force || !c.preenchidos.includes(campoIaId)).map((c) => c.id))
    }
  }
  if (!ids.length) {
    console.error('Uso: npm run triagem -- <cardId...> | --fase  [--dry-run] [--force]')
    process.exit(1)
  }

  for (const id of ids) {
    try {
      const r = await triarCard(id, { dryRun, force, semLock: true })
      if (r.pulado) {
        console.log(`# ${id} ${r.titulo}: pulado (${r.pulado})`)
        continue
      }
      console.log(`\n# ${id} ${r.titulo}${dryRun ? ' (dry-run, não gravado)' : ''}\n`)
      console.log(r.texto)
    } catch (e) {
      console.error(`# ${id}: erro`, e)
    }
  }
}

main()
