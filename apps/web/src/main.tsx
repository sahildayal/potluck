import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { applyTheme, readStoredTheme } from './lib/theme.ts';
import './styles/app.css';

// Applied before first paint so an installed app does not flash light before
// settling into dark.
applyTheme(readStoredTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend can be cold or the kitchen wifi flaky; retrying once is
      // helpful, retrying five times just delays the error message.
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
