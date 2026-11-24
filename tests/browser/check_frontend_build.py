"""Check the production bundler's mount, React, lazy modules and CSS in Chromium.

Synthetic public source only; no real accounts, provider calls or private input.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import gzip
import re
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

with tempfile.TemporaryDirectory(prefix="aus-entry-browser-") as folder:
    root = Path(folder)
    for name in ("index.html", "package.json"):
        shutil.copyfile(repo / name, root / name)
    for name in ("src", "public"):
        shutil.copytree(repo / name, root / name)
    for directory, filename in (("cloud", "gp-discovery-sources.json"), ("cloud", "evidence-deadline.mjs"), ("library", "sources.json")):
        (root / directory).mkdir(exist_ok=True)
        shutil.copyfile(repo / directory / filename, root / directory / filename)
    (root / "node_modules").symlink_to(repo / "node_modules", target_is_directory=True)
    command = 'import{buildFrontend}from' + json.dumps((repo / "scripts/frontend.mjs").as_uri()) + ';console.log(JSON.stringify(await buildFrontend({root:' + json.dumps(str(root)) + ',base:"/aus/"})));'
    build = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", command], cwd=repo))
    outputs = build["metafile"]["outputs"]
    assert isinstance(outputs, dict)
    modules = set()

    def visit(name):
        if name in modules:
            return
        modules.add(name)
        for dependency in outputs[name]["imports"]:
            if dependency["kind"] == "import-statement":
                visit(dependency["path"])

    visit(next(name for name, metadata in outputs.items() if metadata.get("entryPoint") == "src/entry.jsx"))
    startup_bytes = sum(len(gzip.compress((root / name).read_bytes(), mtime=0)) for name in modules)
    assert startup_bytes < 95_000, startup_bytes
    assert all(outputs[name].get("entryPoint") not in ("src/main.jsx", "src/ui-translations.mjs") for name in modules)
    assert build["css"]
    html = (root / "dist/index.html").read_text()
    assert len(gzip.compress(html.encode(), mtime=0)) < 2_500
    assert re.search(r'<template id="workspace-styles">\s*<link rel="stylesheet"', html)

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(MountHandler, directory=str(root / "dist")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 390, "height": 780})
            base = "http://127.0.0.1:" + str(server.server_port)
            workspace_requests = []
            requests = []

            def hold_workspace(route):
                workspace_requests.append(route.request.url)
                route.abort()

            page.on("request", lambda request: requests.append(request.url))
            page.route(re.compile(r"/aus/assets/(?:main-.*\.js|.*\.css)$"), hold_workspace)
            page.route("**/api/public-config", lambda route: route.fulfill(json={
                "mode": "cloud", "authRequired": True, "supabaseUrl": "https://auth.example.invalid", "publishableKey": "synthetic",
            }))
            page.route("**/aus/fonts/**", lambda route: route.abort())
            page.route("**/aus/brand-aa-64.png", lambda route: route.abort())
            page.goto(base + "/aus/")
            expect(page.locator("#login-email")).to_be_visible()
            expect(page.get_by_role("button", name="ورود امن")).to_be_enabled()
            assert not workspace_requests, workspace_requests
            assert len([url for url in requests if "/api/" in url]) == 1
            assert not [url for url in requests if "/aus/fonts/" in url]
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            document_only = browser.new_page(viewport={"width": 390, "height": 780})
            document_only.route("**/aus/**", lambda route: route.continue_() if route.request.is_navigation_request() else route.abort())
            document_only.goto(base + "/aus/")
            expect(document_only.get_by_role("heading", name="مسیر")).to_be_visible()
            expect(document_only.get_by_role("link", name="تازه‌سازی صفحه")).to_be_visible()
            assert document_only.locator("#login-email").count() == 0
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"PASS real AUS entry: renderable document, no workspace or font dependency before login, {startup_bytes:,} gzip bytes for required modules.")
