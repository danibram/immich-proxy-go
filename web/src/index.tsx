/* @refresh reload */
import { Route, Router } from '@solidjs/router';
import { render } from 'solid-js/web';
import App from './App';
import './index.css';
import HomePage from './pages/HomePage';
import SharePage from './pages/SharePage';

const root = document.getElementById('root');

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
