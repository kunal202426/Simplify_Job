<template>
    <div v-if='isOn' class="explanationBg">
        <h1 class="explanation">{{explanationContent}}</h1>
        <svg style='cursor: pointer;' @click="toggleExplanation" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
       
    </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';
import { useExplanation } from '@/composables/Explanation.ts';
export default {

    setup() {

        const { explanation, explanationContent, toggleExplanation, setExplanation } = useExplanation();

        const isOn = ref(false);
        const content = ref("");
        watch(explanation, (newVal) => {
            isOn.value = newVal;
        });
        watch(explanationContent, (newVal) => {
            content.value = newVal;
        });
        return {
            isOn, toggleExplanation, explanationContent
        };
    },
};
</script>