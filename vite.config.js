import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig(({ mode }) => {
  const shouldAnalyze = mode === 'analyze'

  return {
    plugins: [
      react(),
      shouldAnalyze &&
        visualizer({
          filename: 'dist/stats.html',
          open: false,
          gzipSize: true,
          brotliSize: true,
        }),
    ].filter(Boolean),
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
              return 'react-vendor'
            }

            if (id.includes('node_modules/recharts')) {
              return 'charts-vendor'
            }

            if (
              id.includes('node_modules/jspdf') ||
              id.includes('node_modules/jspdf-autotable') ||
              id.includes('node_modules/html2canvas') ||
              id.includes('node_modules/xlsx')
            ) {
              return 'export-vendor'
            }
          },
        },
      },
    },
  }
})
