import { createRoot } from 'react-dom/client';
import '@fontsource/suez-one/hebrew-400.css';
import '@fontsource/suez-one/latin-400.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-400.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-500.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-600.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-400.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-600.css';
import './styles.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(<App />);
