import './styles/base.css';
import './styles/trainer.css';
import './styles/practice.css';
import { App } from './app';
import { setupUpdate } from './platform/desktop';
import { setupPwa } from './platform/pwa';
import { $ } from './ui/dom';

new App();
setupPwa($<HTMLButtonElement>('install'));
void setupUpdate($<HTMLButtonElement>('update'));
