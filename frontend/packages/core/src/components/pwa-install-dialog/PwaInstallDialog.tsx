import { Button } from '@project/ui'
import { ArrowDownIcon, EllipsisIcon, EllipsisVerticalIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTimeout } from 'usehooks-ts'
import { getDeviceType, isExtension, isNative, isPwa } from '../../utils/PlatformUtil'
import { PwaSafariIcon } from './PwaSafariIcon'

const DeviceIcon = () => {
  const deviceType = getDeviceType()
  switch (deviceType) {
    case 'samsung':
      return <ArrowDownIcon className='inline-flex h-5 w-5 rounded-[10px] border border-background justify-center items-center p-0.5' />
    case 'safari':
      return <PwaSafariIcon className='h-5 w-5 text-background' />
    case 'safari-26':
      return (
        <div className='flex items-center gap-1'>
          <EllipsisIcon className='h-5 w-5 text-background rounded-[10px] border border-background p-0.5' />
          <span>and then</span>
          <PwaSafariIcon className='h-5 w-5 text-background' />
        </div>
      )
    case 'firefox':
      return <EllipsisVerticalIcon className='h-5 w-5 text-background rounded-[10px] border border-background p-0.5' />
    default:
      return null
  }
}

export const PwaInstallDialog = () => {
  const [opened, setOpened] = useState<boolean>(false)

  useTimeout(() => {
    setOpened(false)
  }, opened ? (60 * 1000) : null)

  useEffect(() => {
    if (isPwa() || getDeviceType() === 'unknown' || isNative() || isExtension()) {
      setOpened(false)
      return
    }

    const pwaClosedDialog = localStorage.getItem('_pwa_closed_dialog_time')
    if (pwaClosedDialog) {
      const timestamp = parseInt(pwaClosedDialog)
      if (timestamp && !isNaN(timestamp)) {
        const age = 86400 * 1000 * 7
        const now = Date.now()
        const diff = now - timestamp
        if (!(diff > age)) {
          setOpened(false)
          return
        }
      }
    }
    setOpened(true)
  }, [])

  const onClose = () => {
    localStorage.setItem('_pwa_closed_dialog_time', Date.now().toString())
    setOpened(false)
  }

  if (!opened) {
    return null
  }

  return (
    <div className='p-2.5 bg-foreground rounded-md border border-border shadow-lg fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full z-50'>
      <div className='flex items-center gap-1 justify-between'>
        <p className='text-xs text-background font-medium flex items-center gap-1'>
          Tap <DeviceIcon /> to add app to home screen
        </p>
        <Button size='icon-sm' onClick={onClose} variant='ghost' className='text-background'>
          <XIcon />
        </Button>
      </div>
    </div>
  )
}
