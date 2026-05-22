import { useRunsUpdated } from './hooks/useRunsUpdated.js';
import Header from './components/layout/Header.js';
import Overview from './tabs/Overview.js';
import Cards from './tabs/Cards.js';
import Relics from './tabs/Relics.js';
import Synergies from './tabs/Synergies.js';
import Deaths from './tabs/Deaths.js';
import HpGold from './tabs/HpGold.js';
import RunLog from './tabs/RunLog.js';
import Potions from './tabs/Potions.js';
import { useStore } from './store.js';

const TABS = ['Overview', 'Cards', 'Relics', 'Potions', 'Synergies', 'Deaths', 'HP & Gold', 'Run Log'] as const;
type TabName = (typeof TABS)[number];

const TAB_COMPONENTS: Record<TabName, React.ComponentType> = {
  Overview,
  Cards,
  Relics,
  Synergies,
  Deaths,
  'HP & Gold': HpGold,
  'Run Log': RunLog,
  Potions,
};

export default function App() {
  useRunsUpdated();
  const { activeTab, setActiveTab } = useStore();
  const ActiveTab = TAB_COMPONENTS[activeTab as TabName] ?? Overview;

  return (
    <div className="app">
      <Header />
      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1 }}>
        <ActiveTab />
      </main>
    </div>
  );
}
