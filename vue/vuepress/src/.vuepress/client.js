/**
 * Client app enhancement file.
 *
 * https://vuepress.vuejs.org/advanced/cookbook/usage-of-client-config.html
 */

import { defineClientConfig } from 'vuepress/client'

export default defineClientConfig({
  enhance({ app, router, siteData }) {
    // ...apply enhancements for the site.
  },
})
