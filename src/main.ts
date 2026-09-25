import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import Popout from './lib/components/Popout.svelte'

// Dispatch : #popout=… dans le hash → la fenêtre secondaire rend le panneau demandé,
// sinon c'est l'app principale (châssis IDE complet).
const isPopout = new URLSearchParams(location.hash.slice(1)).has('popout')

const app = mount(isPopout ? Popout : App, { target: document.getElementById('app')! })

export default app
