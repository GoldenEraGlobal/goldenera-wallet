import { createApp } from '@project/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/index.css'

const init = async () => {
  const { App } = await createApp({ isExtension: true })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="h-full w-full bg-background overflow-hidden">
        <App />
      </div>
    </StrictMode>,
  )
}

init()
  .then(() => console.log('Wallet APP initialized'))
  .catch(console.error)
