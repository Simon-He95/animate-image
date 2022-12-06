<script setup lang="ts">
import { animateImage } from "../../src";

animateImage({
  images: [
    new URL("../public/1.png", import.meta.url).href,
    new URL("../public/2.png", import.meta.url).href,
    new URL("../public/3.png", import.meta.url).href,
    new URL("../public/4.png", import.meta.url).href,
    new URL("../public/5.png", import.meta.url).href,
    new URL("../public/6.png", import.meta.url).href,
    new URL("../public/7.png", import.meta.url).href,
    new URL("../public/8.png", import.meta.url).href,
    new URL("../public/9.png", import.meta.url).href,
    new URL("../public/10.png", import.meta.url).href,
    new URL("../public/11.png", import.meta.url).href,
  ],
  container: ".main",
  infinity: true,
});
</script>

<template>
  <div class="main" w-full h-full />
</template>

<style scoped></style>
