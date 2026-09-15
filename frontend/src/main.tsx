import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/shadcn.css';
import './styles/base.css';
import './styles/layout.css';
import { App } from './App';
import { TooltipProvider } from '@/components/ui/tooltip';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
