"""Run critical synthetic-owner workflows; no live provider actions are used."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ['check_sync_continuity.py','check_english_ui.py','check_ui_accessibility_reflow.py',
          'check_research_funding.py','check_team_board.py','check_bulk_opportunity_mail.py']


def run() -> None:
    environment = dict(os.environ)
    with tempfile.TemporaryDirectory(prefix='aus-browser-path-') as temporary:
        # Existing tests resolve 'chromium'. Expose the installed pinned Playwright
        # browser without rewriting individual tests or relying on a machine path.
        system_browser=shutil.which('chromium')
        if system_browser:
            executable=Path(system_browser)
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                executable=Path(playwright.chromium.executable_path)
                if not executable.is_file():
                    raise RuntimeError('Install the pinned Playwright Chromium before browser checks')
                browser=playwright.chromium.launch(headless=True,args=['--no-sandbox'])
                browser.close()
        (Path(temporary)/'chromium').symlink_to(executable)
        environment['PATH'] = temporary + os.pathsep + environment.get('PATH','')
        print('Playwright '+version('playwright'), flush=True)
        for check in CHECKS:
            print('CHECK '+check, flush=True)
            subprocess.run([sys.executable, str(ROOT/'tests/browser'/check)],cwd=ROOT,
                           env=environment,check=True,timeout=240)


if __name__ == '__main__':
    run()
