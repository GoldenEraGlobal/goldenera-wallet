import type { Page } from '@playwright/test'
import { test, expect, importPublicWallet, openSettings, RECIPIENT } from './fixtures'

async function openNativeToken(page: Page) {
  const token = page.getByRole('button').filter({ hasText: 'GoldenEra Test' })
  await expect(token).toBeVisible()
  await token.click()
  await expect(page.getByRole('button', { name: 'Go Back', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Receive', exact: true })).toBeVisible()
}

async function openTransactionReview(page: Page) {
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: /GoldenEra Test/ }).click()
  await page.getByPlaceholder('0x...').fill(RECIPIENT)
  await page.locator('input[inputmode="decimal"]').fill('1')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  return page.getByRole('dialog', { name: 'Review Transaction' })
}

test.describe('Base UI Drawer migration', () => {
  test('Receive exposes the new anatomy, focus management, editable nested dialog and focus return', async ({ page, api }) => {
    await importPublicWallet(page)
    await openNativeToken(page)
    const trigger = page.getByRole('button', { name: 'Receive', exact: true })
    await trigger.focus()
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Receive' })
    await expect(dialog).toBeVisible()
    for (const slot of ['drawer-overlay', 'drawer-viewport', 'drawer-popup', 'drawer-content', 'drawer-swipe-handle']) {
      await expect(page.locator(`[data-slot="${slot}"]`).first()).toBeVisible()
    }
    await expect(page.locator('[data-slot="drawer-popup"]')).toHaveAttribute('data-swipe-direction', 'down')
    await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)

    await page.getByRole('button', { name: 'Set amount', exact: true }).click()
    await page.getByRole('dialog', { name: 'Set Amount' }).getByRole('textbox').fill('12.34')
    await page.getByRole('dialog', { name: 'Set Amount' }).getByRole('button', { name: 'Confirm' }).click()
    await expect(dialog.getByText('Amount: 12.34', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(api.submitted).toHaveLength(0)
  })

  test('Receive closes on outside press and Escape without invoking pull-to-refresh', async ({ page, api }) => {
    let balanceRequests = 0
    await page.route('**/api/core/v1/wallet/balances**', async route => {
      balanceRequests += 1
      await route.fallback()
    })
    await importPublicWallet(page)
    await openNativeToken(page)
    const receive = page.getByRole('button', { name: 'Receive', exact: true })
    await receive.click()
    const dialog = page.getByRole('dialog', { name: 'Receive' })
    await expect(dialog).toBeVisible()
    const before = balanceRequests

    await page.locator('[data-slot="drawer-overlay"]').click({ position: { x: 5, y: 5 } })
    await expect(dialog).toBeHidden()
    await receive.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(balanceRequests).toBe(before)
    expect(api.submitted).toHaveLength(0)
  })

  test('Send review can be scrolled and cancelled but never confirms a transaction', async ({ page, api }) => {
    await importPublicWallet(page)
    const dialog = await openTransactionReview(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Recipient', { exact: true })).toBeVisible()
    await dialog.locator('.overflow-y-auto').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(api.submitted).toHaveLength(0)
  })

  test('transfer filter and detail drawers preserve their real controlled flows', async ({ page, api }) => {
    await importPublicWallet(page)
    await openNativeToken(page)

    const filterTrigger = page.getByRole('button', { name: 'Filter transfers', exact: true })
    await filterTrigger.click()
    const filter = page.getByRole('dialog', { name: 'Transfer filter' })
    await expect(filter).toBeVisible()
    await expect(filter.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('data-base-ui-swipe-ignore', '')
    await filter.getByRole('button', { name: 'Transfer', exact: true }).click()
    await expect(filter).toBeHidden()
    await expect(filterTrigger).toBeFocused()

    const transfer = page.getByRole('button').filter({ hasText: 'received' }).filter({ hasText: '1' }).first()
    await expect(transfer).toBeVisible()
    await transfer.click()
    const detail = page.getByRole('dialog', { name: '+1.00000000GE', exact: true })
    await expect(detail).toBeVisible()
    await expect(detail.getByText('Tx hash', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(detail).toBeHidden()
    expect(api.submitted).toHaveLength(0)
  })

  test('theme FamilyDrawer is named, changes view state, closes by backdrop and Escape, and restores focus', async ({ page, api }) => {
    await importPublicWallet(page)
    await openSettings(page)
    const trigger = page.getByRole('button').filter({ hasText: 'Theme' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Change theme' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-describedby', /.+/)
    await expect(dialog.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('data-base-ui-swipe-ignore', '')
    await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.locator('[data-slot="drawer-overlay"]').click({ position: { x: 5, y: 5 } })
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(api.submitted).toHaveLength(0)
  })

  test('a real Chromium touch drag on the swipe handle dismisses the drawer', async ({ page, context, api, browserName }) => {
    test.skip(browserName !== 'chromium', 'The deterministic pointer gesture is a Chromium QA case')
    let balanceRequests = 0
    await page.route('**/api/core/v1/wallet/balances**', async route => {
      balanceRequests += 1
      await route.fallback()
    })
    await importPublicWallet(page)
    await openNativeToken(page)
    await page.getByRole('button', { name: 'Receive', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Receive' })
    await expect(dialog).toBeVisible()
    const handle = page.locator('[data-slot="drawer-swipe-handle"]')
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    const before = balanceRequests
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + step * 30 }],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(dialog).toBeHidden()
    expect(balanceRequests).toBe(before)
    expect(api.submitted).toHaveLength(0)
  })
})
