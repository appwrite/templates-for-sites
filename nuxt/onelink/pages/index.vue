<template>
  <div>
    <homepage :acc="account" />
  </div>
</template>
<script setup>
const account = {
  name: "John Doe",
  description: "Im John Doe, the very first user of Appwrite.",
  photo: "https://cloud.appwrite.io/v1/avatars/initials?name=John%20Doe",
  facebook: "https://www.facebook.com/appwrite_john_doe",
  twitter: "https://twitter.com/appwrite_john_doe",
  instagram: "https://www.instagram.com/appwrite_john_doe",
  email: "john@appwrite.io",
  github: "https://github.com/appwrite_john_doe",
  telegram: "https://t.me/appwrite_john_doe",
  phone: "+4930901820",
  youtube: "https://youtube.com/@appwrite_john_doe",
  linkedin: "https://linkedin.com/appwrite_john_doe",
  // For link icons, see: https://nuxt.com/modules/icon
  links: [
    {
      title: "My Website",
      icon: "ph:facebook-logo-duotone",
      url: "https://appwrite.io",
    },
    {
      title: "Amazon wishlist",
      icon: "ant-design:amazon-outlined",
      url: "https://amazon.in",
    },
    {
      title: "React JS course",
      icon: "grommet-icons:reactjs",
      url: "https://reactjs.org/",
    },
    {
      title: "Donate for good cause",
      icon: "iconoir:donate",
      url: "https://who.int",
    },
  ],
};
</script>
