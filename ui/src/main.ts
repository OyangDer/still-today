import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';
import { app } from './lib/state.svelte';

await app.boot();
mount(App, { target: document.getElementById('app')! });
