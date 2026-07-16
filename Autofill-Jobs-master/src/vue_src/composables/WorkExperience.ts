
import { ref, computed } from 'vue';

const isOn = ref(false);

export function useWorkExperience() {
  const toggleIsOn = () => {
    isOn.value = !isOn.value;
  };
  return {
    isOn: computed(() => isOn.value), 
    toggleIsOn
  };
}
