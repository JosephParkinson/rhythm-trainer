import './style.css';
import { App } from './app';
import { setupUpdate } from './desktop';
import { setupPwa } from './pwa';
import { $ } from './ui/dom';

new App();
setupPwa($<HTMLButtonElement>('install'));
void setupUpdate($<HTMLButtonElement>('update'));
