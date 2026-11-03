<template>
  <img :src="src" alt="">
  <img v-bind:src="src" alt="">
  <img :src="" alt="">
  <img v-bind:src.prop="src" alt="">
  <img v-bind="props" alt="">
  <img alt=":src" data-note="v-bind:src">
  <img src="#" alt="">
  <img
    :src="src"
    alt="">
  <img :srcset="set" alt="">
</template>
