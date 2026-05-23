import { create } from 'zustand';

interface AppStore {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedCharacter: string;
  setSelectedCharacter: (char: string) => void;
  ascension: string;
  setAscension: (asc: string) => void;
  lastN: string;
  setLastN: (n: string) => void;
}

export const useStore = create<AppStore>((set) => ({
  activeTab: 'Overview',
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectedCharacter: '',
  setSelectedCharacter: (char) => set({ selectedCharacter: char }),
  ascension: '',
  setAscension: (asc) => set({ ascension: asc }),
  lastN: '',
  setLastN: (n) => set({ lastN: n }),
}));
