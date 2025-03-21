<template>
  <main
    class="p-4 bg-white dark:bg-neutral-900 h-full w-full space-y-8 pt-12 max-w-sm mx-auto"
  >
    <div class="text-center">
      <div
        v-if="acc.photo"
        class="mb-6 h-20 w-20 rounded-full overflow-hidden ring ring-neutral-200 dark:ring-neutral-800 mx-auto"
      >
        <img :src="acc.photo" alt="name" class="h-full w-full object-cover" />
      </div>
      <h1
        v-if="acc.name"
        class="text-2xl font-bold mt-4 text-neutral-800 dark:text-neutral-100"
      >
        {{ acc.name }}
      </h1>
      <p v-if="acc.d" class="text-sm mt-2 text-neutral-600">
        {{ acc.description }}
      </p>
    </div>
    <div
      class="flex items-center justify-center flex-wrap text-black dark:text-neutral-300"
    >
      <span v-if="acc.facebook" class="p-1">
        <a :href="acc.facebook" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:facebook-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.twitter" class="p-1">
        <a :href="acc.twitter" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:twitter-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.instagram" class="p-1">
        <a :href="acc.instagram" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:instagram-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.email" class="p-1">
        <a :href="acc.email" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:envelope-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.telegram" class="p-1">
        <a :href="acc.telegram" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:telegram-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.phone" class="p-1">
        <a
          :href="`https://wa.me/${acc.w}`"
          target="_blank"
          rel="noopener | noreferrer"
        >
          <Icon name="ph:whatsapp-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.youtube" class="p-1">
        <a :href="acc.youtube" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:youtube-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.email" class="p-1">
        <a
          :href="`mailto:${acc.email}`"
          target="_blank"
          rel="noopener | noreferrer"
        >
          <Icon name="ph:envelope-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.github" class="p-1">
        <a :href="acc.github" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:github-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
      <span v-if="acc.linkedin" class="p-1">
        <a :href="acc.linkedin" target="_blank" rel="noopener | noreferrer">
          <Icon name="ph:linkedin-logo-duotone" class="h-6 w-6" />
        </a>
      </span>
    </div>
    <ul class="space-y-2">
      <ExternalLink
        v-for="(link, id) in acc.links"
        :label="link.title"
        :icon="link.icon"
        :url="link.url"
        :key="id"
      />
    </ul>
  </main>
</template>
<script setup>
const props = defineProps({
  acc: {
    type: Object,
    required: true,
  },
});
</script>
