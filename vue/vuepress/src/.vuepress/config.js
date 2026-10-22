import { viteBundler } from '@vuepress/bundler-vite'
import { registerComponentsPlugin } from '@vuepress/plugin-register-components'
import { searchPlugin } from '@vuepress/plugin-search'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'
import { getDirname, path } from 'vuepress/utils'
import packageJson from '../../package.json' with { type: 'json' }

const __dirname = getDirname(import.meta.url)

export default defineUserConfig({
  /**
   * Ref：https://vuepress.vuejs.org/reference/config.html#title
   */
  title: 'Vuepress Docs Boilerplate',
  /**
   * Ref：https://vuepress.vuejs.org/reference/config.html#description
   */
  description: packageJson.description,

  /**
   * Extra tags to be injected to the page HTML `<head>`
   *
   * ref：https://vuepress.vuejs.org/reference/config.html#head
   */
  head: [
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }]
  ],

  bundler: viteBundler(),

  /**
   * Theme configuration, here is the default theme configuration for VuePress.
   * It already includes the back-to-top and medium-zoom plugins.
   *
   * ref：https://ecosystem.vuejs.press/themes/default/config.html
   */
  theme: defaultTheme({
    repo: '',
    editLink: false,
    docsDir: '',
    lastUpdated: false,
    contributors: false,
    navbar: [
      {
        text: 'Guide',
        link: '/guide/',
      },
      {
        text: 'Config',
        link: '/config/'
      },
      {
        text: 'VuePress',
        link: 'https://vuepress.vuejs.org'
      }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          collapsible: false,
          children: [
            '/guide/',
            '/guide/using-vue.md',
          ]
        }
      ],
    }
  }),

  /**
   * Apply plugins，ref：https://ecosystem.vuejs.press/plugins/
   */
  plugins: [
    registerComponentsPlugin({
      componentsDir: path.resolve(__dirname, './components'),
    }),
    searchPlugin(),
  ]
})
