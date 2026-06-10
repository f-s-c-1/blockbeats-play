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
        { name: 'theme-color', content: '#15100a' },
      ],
      link: [
        // 展示字体（站酷快乐体 + Baloo 2）：弱网加载失败时回落系统粗体，不阻塞渲染
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Baloo+2:wght@600;800&display=swap' },
      ],
    },
  },
})
