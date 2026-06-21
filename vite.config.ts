import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: ['**/src-tauri/target/**']
    }
  },
  // 明确清理依赖，避免 Tailwind v4 冲突
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
})
