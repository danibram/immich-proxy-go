/* @refresh reload */
import { Route, Router } from '@solidjs/router';
import { render } from 'solid-js/web';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/bricolage-grotesque/500.css';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/700.css';
import { initAnalytics } from './analytics';
import App from './App';
import './index.css';
import HomePage from './pages/HomePage';
import SharePage from './pages/SharePage';

const root = document.getElementById('root');

initAnalytics();

render(
  () => (
    <Router root={App}>
      <Route path="/" component={HomePage} />
      <Route path="/share/:key/*" component={SharePage} />
      <Route path="/s/:key/*" component={SharePage} />
    </Router>
  ),
  root!
);
