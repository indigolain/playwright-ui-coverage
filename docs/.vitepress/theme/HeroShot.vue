<script setup lang="ts">
// The report screenshot in the home page's hero, light and dark variants.
// Imported (not from public/) so the images stay in docs/images/ only.
import light from '../../images/report-overview.png';
import dark from '../../images/report-dark.png';
</script>

<template>
  <div class="hero-shot">
    <img class="hero-shot-light" :src="light" alt="The UI coverage report: views with coverage %, and a screenshot of the /users page with green boxes on tested elements and red boxes on untested ones" />
    <img class="hero-shot-dark" :src="dark" alt="The UI coverage report in dark mode" />
  </div>
</template>
