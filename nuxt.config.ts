// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  srcDir: 'app',
  serverDir: 'server',
  alias: {
    '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
  },
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },
  nitro: {
    // 开启 Nitro 实验性 WebSocket（crossws）
    experimental: {
      websocket: true,
    },
    // better-sqlite3 是原生模块，不打包
    externals: {
      external: ['better-sqlite3'],
    },
  },
  app: {
    head: {
      title: '草原杯',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
        { name: 'theme-color', content: '#0f172a' },
      ],
    },
  },
})
