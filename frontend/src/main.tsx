import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App.tsx'
import { ThemeProvider } from './contexts/ThemeContext'
// Loaded before index.css so Tailwind's utility classes (used to style graph
// nodes in KnowledgeGraph.tsx) always win the cascade over ReactFlow's own
// base node/edge styles - same-specificity rules are resolved by import order.
import 'reactflow/dist/style.css'
import './index.css'

// Empty string is a valid (inert) clientId for GoogleOAuthProvider - the Google button
// disables itself gracefully when it isn't set, rather than throwing at startup.
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
