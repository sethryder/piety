import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MiniApp from './MiniApp'
import './app.css'

const isMini = new URLSearchParams(location.search).has('mini')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isMini ? <MiniApp /> : <App />}</React.StrictMode>
)
