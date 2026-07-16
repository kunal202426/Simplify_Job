<template>
    <div v-if='isOn' class="explanationBg">
        <h1 class="explanation">Add a skill</h1>
        <div class="inputFieldDiv">
            <h2></h2>
            <input placeholder="JavaScript" v-model="inputValue">
        </div>
        <svg style='cursor: pointer;' @click="saveData" xmlns="http://www.w3.org/2000/svg" height="24px"
            viewBox="0 -960 960 960" width="24px" fill="#5f6368">
            <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
        </svg>
        <svg style='cursor: pointer;' @click="exit" xmlns="http://www.w3.org/2000/svg" height="24px"
            viewBox="0 -960 960 960" width="24px" fill="#5f6368">
            <path
                d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
        </svg>
    </div>
</template>

<script lang="ts">
import { ref } from 'vue';
import { useResumeDetails } from '@/composables/ResumeDetails';
import { useSkills } from '@/composables/Skills.ts';
export default {

    setup() {
        const { loadDetails } = useResumeDetails();
        const { isOn, toggleIsOn } = useSkills();
        const inputValue = ref('');
        const exit = () => {
            inputValue.value = '';
            toggleIsOn();
        }
        const saveData = () => {
            let res = inputValue.value;
            if (!chrome.storage) return;
            if (!res) return;
            chrome.storage.local.get(['Resume_details'], (data) => {
                let jsonData = data['Resume_details'];
                if (jsonData) {
                    jsonData.skills = [...jsonData.skills ?? [], res]
                    chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                        console.log(`'Resume_details' saved:`, data);
                    });
                    toggleIsOn();
                    loadDetails();
                } else {
                    let defaultData = {
                        "skills": [
                            res
                        ],
                        "experiences": [
                            {}
                        ]
                    }
                    chrome.storage.local.set({ ['Resume_details']: defaultData }, () => {
                        console.log(`'Resume_details' saved:`, data);
                    });
                    loadDetails();
                    toggleIsOn();
                }
            });
        }
        return {
            isOn, exit, inputValue, saveData
        };
    },
};
</script>