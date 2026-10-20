import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Suspense fallback={<div role="status" style={{minHeight: "50vh", display: "grid", placeItems: "center", color: "#627991", fontSize: 13}}>Chargement…</div>}><App /></Suspense></BrowserRouter></QueryClientProvider></React.StrictMode>,
);
