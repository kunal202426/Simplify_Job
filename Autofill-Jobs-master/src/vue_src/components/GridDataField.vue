<template>
    <div class="gridFieldDivHolder">
        <h2 style="align-items: center; display: flex; gap:1rem;">{{ label }}</h2>
        <div class="gridFieldDiv">

            <GridDataItem v-for="option in dataRef" :key="option" :value="option" :content="option" :type="label">
            </GridDataItem>
            <GridDataItem :type="label" isLast=true updateData="loadData" />
        </div>


    </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';
import GridDataItem from '@/components/GridDataItem.vue';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {
    props: ['label'],
    components: {
        GridDataItem
    },
    setup(props) {
        // Declare a reactive input value using Vue's ref
        const inputValue = ref('');
        const dataRef = ref([]);
        const { details } = useResumeDetails();

        watch(details, (newData: any) => {
            console.log(newData)
            dataRef.value = props.label == "Work Experience" ? parseExperience(newData.experiences) : newData.skills;
        });
        const parseExperience = (experiences: any) => {
            let returnArr = <string[]>[];
            for (let experience of experiences) {
                returnArr.push(`${experience.jobTitle} @ ${experience.jobEmployer}`)
            }
            return returnArr;
        }

        return {
            inputValue,
            dataRef,
        };
    },
};
</script>