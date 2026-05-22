import { useRunsUpdated } from './hooks/useRunsUpdated.js';
import Overview from './tabs/Overview.js';
import Cards from './tabs/Cards.js';
import Relics from './tabs/Relics.js';
import Synergies from './tabs/Synergies.js';
import Deaths from './tabs/Deaths.js';
import HpGold from './tabs/HpGold.js';
import RunLog from './tabs/RunLog.js';
import { useStore } from './store.js';

const TABS = ['Overview', 'Cards', 'Relics', 'Synergies', 'Deaths', 'HP & Gold', 'Run Log'] as const;
type TabName = (typeof TABS)[number];

const TAB_COMPONENTS: Record<TabName, React.ComponentType> = {
  Overview,
  Cards,
  Relics,
  Synergies,
  Deaths,
  'HP & Gold': HpGold,
  'Run Log': RunLog,
};

export default function App() {
  useRunsUpdated();
  const { activeTab, setActiveTab } = useStore();
  const ActiveTab = TAB_COMPONENTS[activeTab as TabName] ?? Overview;

  return (
    <div className="app">
      <header>
        <h1>Spire Codex</h1>
        <nav>
          {TABS.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <ActiveTab />
      </main>
    </div>
  );
}
