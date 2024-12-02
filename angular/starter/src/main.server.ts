import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

// TODO: @Meldiron Ensure SSR works

const bootstrap = () => bootstrapApplication(AppComponent, config);

export default bootstrap;
