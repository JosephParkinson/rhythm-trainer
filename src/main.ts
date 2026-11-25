import './style.css';
import { App } from './app';
import { setupPwa } from './pwa';
import { $ } from './ui/dom';

new App();
setupPwa($<HTMLButtonElement>('install'));
