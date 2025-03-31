export default ({
    modules: ['@nuxtjs/tailwindcss', 'nuxt-icon', '@vueuse/nuxt'],
    build: {
        transpile: ["@headlessui/vue"],
    },
    colorMode: {
        classSuffix: '',
    },
    app: {
        head: {
          bodyAttrs: {
            class: 'bg-white dark:bg-neutral-900',
          },
        },
      },
})
