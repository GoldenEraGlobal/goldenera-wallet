// Background service worker for GoldenEra Wallet extension
// Opens sidepanel on extension icon click (Chrome 114+)
// Falls back to popup for browsers without sidepanel support

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: Error) => {
    // Sidepanel not supported in this browser, popup will be used instead
    console.log('Sidepanel not available, using popup fallback:', error.message)
  })

// Optional: Listen for installation/update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('GoldenEra Wallet extension installed')
  } else if (details.reason === 'update') {
    console.log('GoldenEra Wallet extension updated')
  }
})
