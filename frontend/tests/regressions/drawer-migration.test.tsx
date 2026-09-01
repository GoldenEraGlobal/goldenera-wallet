// @vitest-environment jsdom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '../../packages/ui/src/components/ui/drawer'
import {
  FamilyDrawerAnimatedWrapper,
  FamilyDrawerButton,
  FamilyDrawerClose,
  FamilyDrawerContent,
  FamilyDrawerOverlay,
  FamilyDrawerPortal,
  FamilyDrawerRoot,
  FamilyDrawerTrigger,
  FamilyDrawerViewContent,
  useFamilyDrawer,
  type ViewsRegistry,
} from '../../packages/ui/src/components/ui/family-drawer'
import { PullToRefresh } from '../../packages/ui/src/components/ui/pull-to-refresh'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => cleanup())

function ControlledDrawer({ onChange = () => {} }: { onChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Drawer open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); onChange(nextOpen) }}>
      <DrawerTrigger>Open wallet drawer</DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Wallet details</DrawerTitle>
        <DrawerDescription>Inspect this wallet</DrawerDescription>
        <input aria-label="Drawer input" defaultValue="editable" />
        <DrawerClose>Close wallet drawer</DrawerClose>
      </DrawerContent>
    </Drawer>
  )
}

async function openControlledDrawer() {
  const trigger = screen.getByRole('button', { name: 'Open wallet drawer' })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger, dialog: await screen.findByRole('dialog', { name: 'Wallet details' }) }
}

describe('Base UI drawer wrapper', () => {
  it('renders the complete anatomy, accessible name and description', async () => {
    render(<ControlledDrawer />)
    const { dialog } = await openControlledDrawer()

    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Inspect this wallet').id).toBe(dialog.getAttribute('aria-describedby'))
    for (const slot of ['drawer-portal', 'drawer-overlay', 'drawer-viewport', 'drawer-popup', 'drawer-content', 'drawer-swipe-handle']) {
      expect(document.querySelector(`[data-slot="${slot}"]`)).not.toBeNull()
    }
    expect(document.querySelector('[data-slot="drawer-popup"]')?.getAttribute('data-swipe-direction')).toBe('down')
    expect(document.querySelector('[data-slot="drawer-popup"]')?.getAttribute('data-swipe-axis')).toBe('y')
  })

  it('reports controlled changes once, closes with Escape and restores trigger focus', async () => {
    const changes = vi.fn()
    render(<ControlledDrawer onChange={changes} />)
    const { trigger, dialog } = await openControlledDrawer()
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wallet details' })).toBeNull())
    expect(changes).toHaveBeenCalledTimes(2)
    expect(changes).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes through the wrapper Close and an outside press', async () => {
    const changes = vi.fn()
    render(<ControlledDrawer onChange={changes} />)
    await openControlledDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Close wallet drawer' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wallet details' })).toBeNull())

    await openControlledDrawer()
    const backdrop = document.querySelector<HTMLElement>('[data-slot="drawer-overlay"]')!
    fireEvent.pointerDown(backdrop, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(backdrop, { button: 0 })
    fireEvent.click(backdrop)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wallet details' })).toBeNull())
    expect(changes.mock.calls.map(([open]) => open)).toEqual([true, false, true, false])
  })

  it('keeps an input editable and marks horizontal direction without changing wrapper API', async () => {
    render(
      <Drawer defaultOpen swipeDirection="left" showSwipeHandle={false}>
        <DrawerContent>
          <DrawerTitle>Edit payment</DrawerTitle>
          <DrawerDescription>Enter an amount</DrawerDescription>
          <input aria-label="Amount" />
        </DrawerContent>
      </Drawer>
    )
    const input = await screen.findByRole('textbox', { name: 'Amount' })
    fireEvent.change(input, { target: { value: '12.34' } })
    expect((input as HTMLInputElement).value).toBe('12.34')
    const popup = document.querySelector('[data-slot="drawer-popup"]')
    expect(popup?.getAttribute('data-swipe-direction')).toBe('left')
    expect(popup?.getAttribute('data-swipe-axis')).toBe('x')
    expect(document.querySelector('[data-slot="drawer-swipe-handle"]')).toBeNull()
  })

  it('closes a nested drawer without closing its parent', async () => {
    render(
      <Drawer defaultOpen>
        <DrawerContent>
          <DrawerTitle>Parent drawer</DrawerTitle>
          <DrawerDescription>Parent content</DrawerDescription>
          <Drawer>
            <DrawerTrigger>Open nested drawer</DrawerTrigger>
            <DrawerContent>
              <DrawerTitle>Nested drawer</DrawerTitle>
              <DrawerDescription>Nested content</DrawerDescription>
              <DrawerClose>Close nested drawer</DrawerClose>
            </DrawerContent>
          </Drawer>
        </DrawerContent>
      </Drawer>
    )
    const parent = await screen.findByRole('dialog', { name: 'Parent drawer' })
    fireEvent.click(screen.getByRole('button', { name: 'Open nested drawer' }))
    const nested = await screen.findByRole('dialog', { name: 'Nested drawer' })
    expect(document.querySelectorAll('[data-slot="drawer-popup"]')).toHaveLength(2)
    expect(parent.closest('[data-slot="drawer-popup"]')?.hasAttribute('data-nested-drawer-open')).toBe(true)
    fireEvent.keyDown(document.activeElement ?? nested, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nested drawer' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Parent drawer' })).toBe(parent)
  })
})

function DefaultFamilyView() {
  const { setView } = useFamilyDrawer()
  return <FamilyDrawerButton onClick={() => setView('detail')}>Show details</FamilyDrawerButton>
}

function DetailFamilyView() {
  return <div><input aria-label="Family input" /><FamilyDrawerClose>Close family drawer</FamilyDrawerClose></div>
}

const familyViews: ViewsRegistry = { default: DefaultFamilyView, detail: DetailFamilyView }

function FamilyHarness({ controlled = false, onOpenChange = () => {} }: { controlled?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const body = (
    <>
      <button onClick={() => setOpen(true)}>Open family drawer</button>
      <FamilyDrawerRoot
        {...(controlled ? { open, onOpenChange: (nextOpen: boolean) => { setOpen(nextOpen); onOpenChange(nextOpen) } } : { defaultOpen: false, onOpenChange })}
        views={familyViews}
        title="Family options"
        description="Choose a family view"
      >
        <button onClick={() => setOpen(true)}>Detached family trigger</button>
        <FamilyDrawerPortal>
          <FamilyDrawerOverlay />
          <FamilyDrawerContent>
            <FamilyDrawerAnimatedWrapper><FamilyDrawerViewContent /></FamilyDrawerAnimatedWrapper>
          </FamilyDrawerContent>
        </FamilyDrawerPortal>
      </FamilyDrawerRoot>
    </>
  )
  return body
}

function UncontrolledFamilyHarness({ onOpenChange = () => {} }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <FamilyDrawerRoot defaultOpen={false} onOpenChange={onOpenChange} views={familyViews} title="Family options" description="Choose a family view">
      <FamilyDrawerPortal>
        <FamilyDrawerOverlay />
        <FamilyDrawerContent>
          <FamilyDrawerAnimatedWrapper><FamilyDrawerViewContent /></FamilyDrawerAnimatedWrapper>
        </FamilyDrawerContent>
      </FamilyDrawerPortal>
      <FamilyDrawerTrigger>Open uncontrolled family</FamilyDrawerTrigger>
    </FamilyDrawerRoot>
  )
}

describe('FamilyDrawer', () => {
  it('keeps controlled state, names the dialog and resets the selected view on close', async () => {
    const changes = vi.fn()
    render(<FamilyHarness controlled onOpenChange={changes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open family drawer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Family options' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(await screen.findByRole('textbox', { name: 'Family input' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close family drawer' }).hasAttribute('data-base-ui-swipe-ignore')).toBe(true)
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Family options' })).toBeNull())
    expect(changes).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open family drawer' }))
    await screen.findByRole('dialog', { name: 'Family options' })
    expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy()
  })

  it('keeps family buttons out of the swipe gesture and closes on outside press', async () => {
    render(<FamilyHarness controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Open family drawer' }))
    await screen.findByRole('dialog', { name: 'Family options' })
    expect(screen.getByRole('button', { name: 'Show details' }).hasAttribute('data-base-ui-swipe-ignore')).toBe(true)
    const backdrop = document.querySelector<HTMLElement>('[data-slot="drawer-overlay"]')!
    fireEvent.pointerDown(backdrop, { pointerType: 'mouse', button: 0 })
    fireEvent.click(backdrop)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Family options' })).toBeNull())
  })

  it('updates uncontrolled state and emits one callback per trigger/close action', async () => {
    const changes = vi.fn()
    render(<UncontrolledFamilyHarness onOpenChange={changes} />)
    const trigger = screen.getByRole('button', { name: 'Open uncontrolled family' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Family options' })
    expect(changes.mock.calls.map(([open]) => open)).toEqual([true])
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close family drawer' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Family options' })).toBeNull())
    expect(changes.mock.calls.map(([open]) => open)).toEqual([true, false])
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})

function touch(clientY: number) {
  return [{ clientY }] as unknown as React.TouchList
}

describe('PullToRefresh drawer isolation', () => {
  it('ignores a full pull gesture started in the new Base UI popup selector', async () => {
    const refresh = vi.fn(async () => {})
    render(
      <PullToRefresh onRefresh={refresh} threshold={40}>
        <div data-slot="drawer-popup"><button>Inside drawer</button></div>
        <button>Outside drawer</button>
      </PullToRefresh>
    )
    const container = screen.getByRole('button', { name: 'Outside drawer' }).parentElement!
    Object.defineProperty(container, 'scrollTop', { configurable: true, value: 0 })
    const inside = screen.getByRole('button', { name: 'Inside drawer' })
    fireEvent.touchStart(inside, { touches: touch(0) })
    fireEvent.touchMove(inside, { touches: touch(120) })
    fireEvent.touchEnd(inside)
    await act(async () => Promise.resolve())
    expect(refresh).not.toHaveBeenCalled()
  })
})
