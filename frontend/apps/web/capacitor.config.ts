import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'global.goldenera.wallet',
  appName: 'GoldenEra',
  webDir: 'dist',
  server: {
    url: 'https://dev-fe-wallet.holaholi.site/',
    cleartext: true
  },
  backgroundColor: '#000000'
};

export default config;
