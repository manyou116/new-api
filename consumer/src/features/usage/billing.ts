interface RecordedTier {
  expression: string
  /** Null means missing, unsupported, or ambiguous; [] means an unconditional leaf. */
  conditions: string[] | null
}

/** A lossless scan of display structure, with quoted text excluded from syntax. */
function billingStructure(source: string) {
  const stack: string[] = []
  const symbols: Array<{ value: string; index: number }> = []
  let quote = ''
  let firstClosing = -1
  let tierCalls = 0
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (
      source.startsWith('tier', index) &&
      !/[\w]/.test(source[index - 1] || '') &&
      /^\s*\(/.test(source.slice(index + 4))
    )
      tierCalls++
    if ('([{'.includes(character)) stack.push(character)
    else if (')]}'.includes(character)) {
      const opener = stack.pop()
      if (!opener || '([{'.indexOf(opener) !== ')]}'.indexOf(character)) return null
      if (!stack.length && firstClosing < 0) firstClosing = index
    } else if (!stack.length && '?:*,'.includes(character)) {
      symbols.push({ value: character, index })
    }
  }
  return !quote && !stack.length ? { symbols, firstClosing, tierCalls } : null
}

/**
 * Read only a conditional tier tree and its multiplicative wrappers. This
 * consumer-local display adapter does not evaluate conditions, amounts or
 * request rules. Historical unit prices remain a server-issued explanation.
 */
function tierBranches(
  source: string,
  path: string[] = [],
  depth = 0,
): Array<{
  label: string
  conditions: string[]
}> | null {
  if (depth > 64) return null
  source = source.trim()
  if (!source) return null
  let structure = billingStructure(source)
  if (!structure) return null
  let wrappers = depth
  while (source.startsWith('(') && structure.firstClosing === source.length - 1) {
    if (++wrappers > 64) return null
    source = source.slice(1, -1).trim()
    structure = billingStructure(source)
    if (!structure) return null
  }
  if (!structure.tierCalls) return []
  const question = structure.symbols.find((symbol) => symbol.value === '?')
  if (question) {
    let nesting = 0
    let colon = -1
    for (const symbol of structure.symbols) {
      if (symbol.index < question.index) continue
      if (symbol.value === '?') nesting++
      if (symbol.value === ':' && --nesting === 0) {
        colon = symbol.index
        break
      }
    }
    if (colon < 0) return null
    const condition = source.slice(0, question.index).trim()
    if (!condition || billingStructure(condition)?.tierCalls) return null
    const simple = /^(p|c|len)\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(condition)
    const opposite: Record<string, string> = { '<': '>=', '<=': '>', '>': '<=', '>=': '<' }
    const inverse = simple ? `${simple[1]} ${opposite[simple[2]]} ${simple[3]}` : `!(${condition})`
    const yes = tierBranches(
      source.slice(question.index + 1, colon),
      [...path, simple ? condition : `(${condition})`],
      depth + 1,
    )
    const no = tierBranches(source.slice(colon + 1), [...path, inverse], depth + 1)
    return yes && no ? [...yes, ...no] : null
  }
  const factors = structure.symbols.filter((symbol) => symbol.value === '*')
  if (factors.length) {
    const leaves: NonNullable<ReturnType<typeof tierBranches>> = []
    let start = 0
    for (const end of [...factors.map((symbol) => symbol.index), source.length]) {
      const branch = tierBranches(source.slice(start, end), path, depth + 1)
      if (!branch) return null
      leaves.push(...branch)
      start = end + 1
    }
    return leaves
  }
  const leaf = /^tier\s*\(([\s\S]*)\)$/.exec(source)
  if (!leaf || structure.tierCalls !== 1) return null
  const argumentsStructure = billingStructure(leaf[1])
  const comma = argumentsStructure?.symbols.filter((symbol) => symbol.value === ',')
  if (!comma || comma.length !== 1) return null
  try {
    const label: unknown = JSON.parse(leaf[1].slice(0, comma[0].index))
    if (typeof label !== 'string' || !leaf[1].slice(comma[0].index + 1).trim()) return null
    return [{ label, conditions: path }]
  } catch {
    return null
  }
}

/** Match solely by the recorded label; missing or duplicate labels never infer a tier from usage. */
export function recordedTier(details: Record<string, unknown>): RecordedTier {
  let expression = ''
  if (typeof details.expr_b64 === 'string' && details.expr_b64.length <= 100_000) {
    try {
      const bytes = Uint8Array.from(atob(details.expr_b64), (character) => character.charCodeAt(0))
      expression = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      // Historical snapshots may be absent or malformed.
    }
  }
  if (
    !expression ||
    expression.length > 65_536 ||
    typeof details.matched_tier !== 'string' ||
    !details.matched_tier
  )
    return { expression, conditions: null }
  const body = expression.trim().replace(/^v1:/, '')
  if (/^v\d+:/.test(body)) return { expression, conditions: null }
  const matches = tierBranches(body)?.filter((tier) => tier.label === details.matched_tier)
  return {
    expression,
    conditions: matches?.length === 1 ? matches[0].conditions : null,
  }
}
