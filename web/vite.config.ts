import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
	plugins: [solidPlugin()],
	resolve: {
		alias: {
			'~': path.resolve(__dirname, './src'),
		},
	},
	build: {
		target: 'esnext',
		outDir: 'dist',
	},
	server: {
		proxy: {
			'/share': {
				target: 'http://localhost:3000',
				changeOrigin: true,
			},
		},
	},
});
