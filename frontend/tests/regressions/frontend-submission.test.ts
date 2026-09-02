import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const coreSource = fileURLToPath(new URL('../../packages/core/src', import.meta.url))
const transferCard = readFileSync(join(coreSource, 'components/TxSubmitCard.tsx'), 'utf8')
const reconciliationLifecycle = readFileSync(
  join(coreSource, 'components/TransferReconciliationLifecycle.tsx'),
  'utf8',
)

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('production transfer submission boundary', () => {
  it('has zero production callers of the retained legacy TransferSubmission utility', () => {
    const legacyPath = join(coreSource, 'utils/TransferSubmission.ts')
    const callers = productionSourceFiles(coreSource)
      .filter(path => path !== legacyPath)
      .filter(path => /from ['"][^'"]*TransferSubmission['"]/.test(readFileSync(path, 'utf8')))
    expect(callers).toEqual([])
  })

  it('stores an immutable coordinator review and displays its exact fee and full recipient', () => {
    expect(transferCard).toContain('transferCoordinator.prepare({')
    expect(transferCard).toContain('transferCoordinator.confirm(current.authorization)')
    expect(transferCard).toContain("reconcileTransfers('submission').catch(() => undefined)")
    expect(transferCard).toContain("if (result.kind === 'unknown') requestSubmissionReconciliation()")
    expect(transferCard).toContain('authorization: TransferReview')
    expect(transferCard).toContain('value={review.recipient}')
    expect(transferCard).toContain('formatWei(review.fee, nativeToken.decimals)')
    expect(transferCard).not.toContain('shortenAddress')
    expect(transferCard).not.toContain('AVERAGE_TX_SIZE')
    expect(transferCard).not.toContain('console.log')
    expect(transferCard).not.toMatch(/getPrivateKey|submitTransaction|hexData/)
  })

  it('keeps lifecycle reconciliation observation-only', () => {
    expect(reconciliationLifecycle).toContain("requestReconciliation('startup')")
    expect(reconciliationLifecycle).toContain("requestReconciliation('unlock')")
    expect(reconciliationLifecycle).toContain("requestReconciliation('focus')")
    expect(reconciliationLifecycle).toContain("requestReconciliation('online')")
    expect(reconciliationLifecycle).not.toMatch(/getPrivateKey|\.confirm\(|submitTransaction|hexData/)
  })
})
