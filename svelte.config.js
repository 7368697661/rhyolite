import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-static compiles to HTML/JS directly
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // essential for Tauri SPA
			precompress: false,
			strict: true
		})
	}
};

export default config;
