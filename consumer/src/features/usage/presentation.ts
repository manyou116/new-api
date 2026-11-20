/** Keep unknown model IDs intact, including private aliases and provider suffixes. */
export function usageModelName(id: string): string {
  const image = /^gpt-image-(\d+(?:\.\d+)?)$/.exec(id)
  if (image) return `GPT Image ${image[1]}`
  const gpt = /^gpt-(\d+(?:\.\d+)*)(?:-(sol|luna|terra|astra))?$/.exec(id)
  if (!gpt) return id || '—'
  const variant = gpt[2]
  return `GPT-${gpt[1]}${variant ? ' ' + variant[0]!.toUpperCase() + variant.slice(1) : ''}`
}

/** Match Sub2API's first-token thresholds, expressed here in seconds. */
export function latencyBand(
  seconds: number | undefined,
): 'good' | 'warn' | 'slow' | 'critical' | undefined {
  if (seconds === undefined) return undefined
  if (seconds < 10) return 'good'
  if (seconds < 30) return 'warn'
  if (seconds < 60) return 'slow'
  return 'critical'
}
