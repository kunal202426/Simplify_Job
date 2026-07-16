import { ref, computed } from 'vue';

const explanationOn = ref(false);
const explanationContent = ref("");
export function useExplanation() {
  const toggleExplanation = () => {
    explanationOn.value = !explanationOn.value;
    if (explanationOn.value == true) {
        document.body.style.overflowY = 'hidden';
    } else {
        document.body.style.overflowY = 'scroll';
    }
  };
  const setExplanation = (value:string) => {
    explanationContent.value = value;
  };
  return {
    explanation: computed(() => explanationOn.value), 
    explanationContent : computed(()=> explanationContent.value),
    toggleExplanation,
    setExplanation
  };
}
