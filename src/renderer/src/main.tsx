import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MiniApp from './MiniApp'
import './app.css'

// user-picked accent (settings): apply saved value; storage events sync the
// other window live
const applyAccent = () => {
  try {
    const a = JSON.parse(localStorage.getItem('accent') ?? 'null')
    if (a) document.documentElement.style.setProperty('--accent', a)
    else document.documentElement.style.removeProperty('--accent')
  } catch {
    /* bad value: keep the css default */
  }
}
applyAccent()
window.addEventListener('storage', applyAccent)

const isMini = new URLSearchParams(location.search).has('mini')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isMini ? <MiniApp /> : <App />}</React.StrictMode>
)
