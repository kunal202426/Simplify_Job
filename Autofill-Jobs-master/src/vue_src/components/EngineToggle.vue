<template>
  <button
    class="engineToggle"
    :class="{ engineToggleOff: !enabled }"
    @click="toggle"
    :title="enabled ? 'Autofill is on — click to pause' : 'Autofill is off — click to resume'"
  >
    <span class="engineToggleTrack">
      <span class="engineToggleKnob"></span>
    </span>
    <span class="engineToggleLabel">{{ enabled ? 'Autofill On' : 'Autofill Off' }}</span>
  </button>
</template>

<script lang="ts">
import { useEngineEnabled } from '@/composables/EngineEnabled';

export default {
  setup() {
    const { enabled, toggle, load } = useEngineEnabled();
    load();
    return { enabled, toggle };
  },
};
</script>

<style scoped>
.engineToggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: #c2b9a9;
  border: 0.15rem solid rgba(0, 0, 0, 0.1);
  border-radius: 0.75rem;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-family: 'Lexend';
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--c1);
  width: fit-content;
}
.engineToggleOff {
  background-color: rgb(219, 209, 192);
  color: rgba(45, 67, 51, 0.55);
}
.engineToggleTrack {
  position: relative;
  width: 1.8rem;
  height: 1rem;
  border-radius: 1rem;
  background-color: var(--c1);
  flex-shrink: 0;
  transition: background-color 0.15s ease;
}
.engineToggleOff .engineToggleTrack {
  background-color: rgba(0, 0, 0, 0.25);
}
.engineToggleKnob {
  position: absolute;
  top: 0.1rem;
  left: 0.9rem;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background-color: rgb(233, 227, 216);
  transition: left 0.15s ease;
}
.engineToggleOff .engineToggleKnob {
  left: 0.1rem;
}
</style>
