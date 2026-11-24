import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AccessGate} from './auth';
import {useInterfaceLanguage} from './interface-locale.mjs';

let workspaceStyles;
function loadWorkspaceStyles() {
  if (workspaceStyles) return workspaceStyles;
  const source = document.getElementById('workspace-styles')?.content.querySelector('link');
  if (!source) return Promise.resolve();
  workspaceStyles = new Promise((resolve, reject) => {
    const link = source.cloneNode();
    link.addEventListener('load', resolve, {once: true});
    link.addEventListener('error', reject, {once: true});
    document.head.append(link);
  });
  return workspaceStyles;
}

function Workspace({session}) {
  const [App, setApp] = useState(null);
  const [failed, setFailed] = useState(false);
  const english = useInterfaceLanguage() === 'en';
  useEffect(() => {
    let current = true;
    Promise.all([import('./main.jsx'), loadWorkspaceStyles()]).then(([module]) => {
      if (current) setApp(() => module.default);
    }, () => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, []);
  if (App) return <App {...session} />;
  return <div className="access-screen"><section className="panel access-card">
    <h1>{english ? 'Masir' : 'مسیر'}</h1>
    <p role="status">{failed
      ? (english ? 'The workspace could not load.' : 'فضای کاری باز نشد.')
      : (english ? 'Opening your workspace…' : 'فضای کاری در حال باز شدن است…')}</p>
    <a href={location.href}>{english ? 'Reload page' : 'تازه‌سازی صفحه'}</a>
  </section></div>;
}

createRoot(document.getElementById('root')).render(
  <AccessGate>{session => <Workspace key={JSON.stringify([session.initialPerson, session.workspaceOwnerId])} session={session} />}</AccessGate>,
);
