import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import node from '@astrojs/node';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: node({
	  mode: 'standalone'
	}),

	site: 'https://example.com',
	integrations: [mdx(), sitemap()],
});
