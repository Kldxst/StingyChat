import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
