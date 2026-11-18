"""Check the production bundler's mount, React, lazy modules and CSS in Chromium.

Synthetic public source only; no real accounts, provider calls or private input.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

repo = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix="aus-build-browser-") as folder:
    project = Path(folder)
    (project / "src").mkdir()
    (project / "public/fonts").mkdir(parents=True)
    (project / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)
    (project / "index.html").write_text('<html><head><meta charset="utf-8"><link rel="icon" href="/brand-aa-32.png"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')
    (project / "src/main.jsx").write_text("""
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import './style.css';
window.__base=import.meta.env.BASE_URL;window.__mode=process.env.NODE_ENV;
function App(){const[value,setValue]=useState('Ready');return <><img src="/brand-aa-32.png" width="32"/><button id="load" onClick={async()=>{const module=await import('./lazy.jsx');setValue(module.message);}}>Open lazy panel</button><p id="result" className={value==='Ready'?'':'lazy-panel'}>{value}</p></>;}
createRoot(document.getElementById('root')).render(<App/>);
""")
    (project / "src/style.css").write_text("@font-face{font-family:Vazirmatn;src:url('/fonts/Vazirmatn-Regular.woff2')}body{font-family:Vazirmatn,sans-serif}")
    (project / "src/lazy.jsx").write_text("import './lazy.css';export const message='Lazy module and styles loaded';")
    (project / "src/lazy.css").write_text(".lazy-panel{padding:17px;background:rgb(20,30,40);color:white}")
    shutil.copyfile(repo / "public/fonts/Vazirmatn-Regular.woff2", project / "public/fonts/Vazirmatn-Regular.woff2")
    shutil.copyfile(repo / "public/brand-aa-32.png", project / "public/brand-aa-32.png")
    command = 'import{buildFrontend}from' + json.dumps((repo / "scripts/frontend.mjs").as_uri()) + ';await buildFrontend({root:' + json.dumps(str(project)) + ',base:"/aus/"});'
    subprocess.run(["node", "--input-type=module", "-e", command], cwd=repo, check=True)

    class MountHandler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if not urlsplit(self.path).path.startswith("/aus/"):
                self.send_error(404)
                return
            super().do_GET()

        def translate_path(self, url):
            pathname = urlsplit(url).path
            return super().translate_path(pathname[len("/aus"):])

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(MountHandler, directory=str(project / "dist")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), headless=True, args=["--no-sandbox"])
            page = browser.new_page()
            errors, requests, failures = [], [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url))
            page.on("response", lambda response: failures.append(response.url) if response.status >= 400 else None)
            page.goto("http://127.0.0.1:" + str(server.server_port) + "/aus/")
            expect(page.locator("#result")).to_have_text("Ready")
            assert page.evaluate("window.__base") == "/aus/"
            assert page.evaluate("window.__mode") == "production"
            page.evaluate("document.fonts.ready")
            assert any("/aus/fonts/Vazirmatn-Regular.woff2" in url for url in requests)
            assert page.locator("img").evaluate("image=>image.complete&&image.naturalWidth>0")
            initial_modules = len([url for url in requests if url.endswith(".js")])
            page.locator("#load").click()
            expect(page.locator("#result")).to_have_text("Lazy module and styles loaded")
            assert page.locator("#result").evaluate("element=>getComputedStyle(element).padding") == "17px"
            assert page.locator("#result").evaluate("element=>getComputedStyle(element).backgroundColor") == "rgb(20, 30, 40)"
            assert len([url for url in requests if url.endswith(".js")]) > initial_modules
            assert not errors, errors
            assert not failures, failures
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
print("PASS production build: React, /aus/ mount, local brand/fonts, lazy modules and lazy CSS; no private input or provider calls.")
