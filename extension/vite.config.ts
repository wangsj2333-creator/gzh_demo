import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        results: resolve(__dirname, 'results.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        articleList: resolve(__dirname, 'src/content/articleList.ts'),
        comments: resolve(__dirname, 'src/content/comments.ts'),
        interceptor: resolve(__dirname, 'src/content/interceptor.ts'),
      },
      output: {
        entryFileNames: (_chunk) => {
          return '[name]/index.js'
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
