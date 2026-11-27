import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAppearance } from './lib/appearance';
import { initPiano } from './piano';
import './index.css';
import './dark.css';

initAppearance();
initPiano();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
