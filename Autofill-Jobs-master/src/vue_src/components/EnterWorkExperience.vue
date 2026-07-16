<template>
    <div v-if='isOn' class="explanationBg">
        <h1 class="explanation">Add work experience</h1>
        <div class="inputFieldDiv">
            <h2>Job Title</h2>
            <input placeholder="Software Engineer I" v-model="jobTitle" />
        </div>
        <div class="inputFieldDiv">
            <h2>Job Employer</h2>
            <input placeholder="JavaScript" v-model="jobEmployer" />
        </div>
        <div class="inputFieldDiv">
            <h2>Start Month</h2>
            <select v-model="startMonth">
                <option v-for="option in [
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December'
                ]" :key="option" :value="option">{{ option }}</option>
            </select>

        </div>
        <div class="inputFieldDiv">
            <h2>Start Year</h2>
            <input placeholder="2024" v-model="startYear" />
        </div>

        <div class="inputFieldDiv">
            <h2>End Month</h2>
            <select v-model="endMonth">
                <option v-for="option in [
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December'
                ]" :key="option" :value="option">{{ option }}</option>
            </select>

        </div>
        <div class="inputFieldDiv">
            <h2>End Year</h2>
            <input placeholder="2024" v-model="endYear" />
        </div>
        <div class="textAreaDiv">
            <h2>Description</h2>
            <textarea
                placeholder="• Spearheaded the development of mobile application pages using React Native, Expo, Figma"
                v-model="roleDescription" />
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
import { ref, watch } from 'vue';
import { useWorkExperience } from '@/composables/WorkExperience.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {

    setup() {
        const { loadDetails } = useResumeDetails();
        const { isOn, toggleIsOn } = useWorkExperience();
        const jobTitle = ref('');
        const jobEmployer = ref('');
        const startMonth = ref('');
        const startYear = ref('');
        const endMonth = ref('');
        const endYear = ref('');
        const roleDescription = ref('');

        const exit = () => {
            jobTitle.value = '';
            jobEmployer.value = '';
            startMonth.value = '';
            startYear.value = '';
            endMonth.value = '';
            endYear.value = '';
            roleDescription.value = '';
            toggleIsOn();
        }
        const saveData = () => {
            let experience = {
                "jobTitle": jobTitle.value,
                "jobEmployer": jobEmployer.value,
                "jobDuration": `${startMonth.value} ${startYear.value} - ${endMonth.value} ${endYear.value}`,
                "isCurrentEmployer": (endYear.value.toLowerCase().includes('present') || endYear.value.toLowerCase().includes('current')),
                "roleBulletsString": roleDescription.value
            };
            if (!chrome.storage) return;
            if (!experience) return;
            chrome.storage.local.get(['Resume_details'], (data) => {
                let jsonData = data['Resume_details'];
                if (jsonData) {
                    jsonData.experiences = [...jsonData.experiences ?? [], experience]
                    chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                        console.log(`'Resume_details' saved:`, data);
                    });
                    loadDetails();
                    toggleIsOn();
                } else {
                    let defaultData = {
                        "skills": [
                            {}
                        ],
                        "experiences": [
                            experience
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
            isOn, exit, jobTitle, jobEmployer, startMonth, startYear,
            endMonth, endYear, roleDescription,
            saveData
        };
    },
};
</script>