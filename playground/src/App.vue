<script setup lang="ts">
/* eslint-disable vue/dot-location */
import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { animateImage } from '../../src'

const baseUrl = import.meta.url
const images = [
  new URL('../public/1.png', baseUrl).href,
  new URL('../public/2.png', baseUrl).href,
  new URL('../public/3.png', baseUrl).href,
  new URL('../public/4.png', baseUrl).href,
  new URL('../public/5.png', baseUrl).href,
  new URL('../public/6.png', baseUrl).href,
  new URL('../public/7.png', baseUrl).href,
  new URL('../public/8.png', baseUrl).href,
  new URL('../public/9.png', baseUrl).href,
  new URL('../public/10.png', baseUrl).href,
  new URL('../public/11.png', baseUrl).href,
]

const ui = reactive({
  colorSampling: 'scaled' as const,
  compositeOperation: 'lighter' as GlobalCompositeOperation,
  fade: 0.92,
  pointShape: 'circle' as const,
})

let cleanup: (() => void) | undefined
let runSeq = 0

async function start() {
  const seq = ++runSeq
  cleanup?.()
  const stop = await animateImage({
    images,
    container: '.main',
    infinity: true,
    isUpdateFromLastPosition: true,
    easing: 'ease-in-out',
    fit: 'contain',
    compositeOperation: ui.compositeOperation,
    fade: ui.fade,
    pointSize: 1,
    pointShape: ui.pointShape,
    jitter: 0.2,
    interaction: true,
    colorSampling: ui.colorSampling,
  })
  if (seq !== runSeq) {
    stop()
    return
  }
  cleanup = stop
}

function presetAccurate() {
  ui.colorSampling = 'scaled'
  ui.compositeOperation = 'source-over'
  ui.fade = 1
  ui.pointShape = 'square'
}

function presetFancy() {
  ui.colorSampling = 'scaled'
  ui.compositeOperation = 'lighter'
  ui.fade = 0.92
  ui.pointShape = 'circle'
}

watch(ui, start, { deep: true })
onMounted(start)
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div class="main" w-full h-full relative>
    <div
      class="panel"
      absolute left-4 top-4 z-10
      p-3 rounded-lg text-sm
      bg="black/55" text="white/90"
      backdrop-blur
    >
      <div class="row">
        <span class="label">Color</span>
        <select v-model="ui.colorSampling" class="select">
          <option value="scaled">
            scaled (match fit)
          </option>
          <option value="source">
            source (raw)
          </option>
        </select>
      </div>

      <div class="row">
        <span class="label">Composite</span>
        <select v-model="ui.compositeOperation" class="select">
          <option value="source-over">
            source-over
          </option>
          <option value="lighter">
            lighter
          </option>
        </select>
      </div>

      <div class="row">
        <span class="label">Fade</span>
        <select v-model="ui.fade" class="select">
          <option :value="1">
            1.00 (no trails)
          </option>
          <option :value="0.96">
            0.96
          </option>
          <option :value="0.92">
            0.92
          </option>
        </select>
      </div>

      <div class="row">
        <span class="label">Shape</span>
        <select v-model="ui.pointShape" class="select">
          <option value="circle">
            circle
          </option>
          <option value="square">
            square
          </option>
        </select>
      </div>

      <div class="row mt-2">
        <button class="panel-btn" @click="presetFancy">
          Preset: Fancy
        </button>
        <button class="panel-btn" @click="presetAccurate">
          Preset: Accurate
        </button>
      </div>

      <div class="hint mt-2">
        Move pointer to interact, click to burst.
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  min-width: 240px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
}
.label {
  opacity: 0.85;
}
.select {
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 6px 8px;
  outline: none;
}
.panel-btn {
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}
.panel-btn:hover {
  border-color: rgba(255, 255, 255, 0.35);
}
.hint {
  opacity: 0.8;
  font-size: 12px;
}
</style>
