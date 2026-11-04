#!/usr/bin/env python3
"""One-load acceptance harness for the run capsule.

Instead of editing → launching a browser → reading a screenshot → fixing →
relaunching, this script opens the Web GUI once and checks the whole contract:

  - the capsule exists and names a real phase
  - it sits above the composer without changing the composer height
  - it reaches the stalled state without waiting the production 15 seconds
  - dark mode and reduced motion degrade correctly
  - the page loads without console errors

The stall threshold is overridden through `window.__DSH_SP_STALL_MS__`, which
the plugin reads at module load. No wall-clock wait.

Usage:
    python3 stream-polish/test/run.py
    python3 stream-polish/test/run.py --shot /tmp/runstrip.png
    python3 stream-polish/test/run.py --stall-ms 800 --session "优化流式输出美观度"
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

DEFAULT_URL = "http://127.0.0.1:8081/"
DEFAULT_COOKIE = "/tmp/dsh-cookie.txt"
DEFAULT_SESSION = "优化流式输出美观度"


def find_chrome() -> str:
    env = os.environ.get("CHROME_PATH")
    if env:
        return env
    matches = sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome")))
    if not matches:
        raise SystemExit("no Chromium found; set CHROME_PATH")
    return matches[-1]


def read_cookie(path: str) -> tuple[str, str]:
    raw = pathlib.Path(path).read_text().strip()
    name, value = raw.split("=", 1)
    return name, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("DSH_URL", DEFAULT_URL))
    parser.add_argument("--cookie", default=os.environ.get("DSH_COOKIE_FILE", DEFAULT_COOKIE))
    parser.add_argument("--session", default=os.environ.get("DSH_SESSION_TITLE", DEFAULT_SESSION))
    parser.add_argument("--stall-ms", type=int, default=800)
    parser.add_argument("--shot", default=None)
    args = parser.parse_args()

    name, value = read_cookie(args.cookie)
    results: list[tuple[bool, str, str]] = []
    errors: list[str] = []

    def check(ok: bool, label: str, detail: str = "") -> None:
        results.append((bool(ok), label, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {label}" + (f" — {detail}" if detail else ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=find_chrome())
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        context.add_cookies([{"name": name, "value": value, "domain": "127.0.0.1", "path": "/"}])
        context.add_init_script(f"window.__DSH_SP_STALL_MS__ = {args.stall_ms};")
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

        page.goto(args.url, wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(1500)
        page.get_by_text(args.session, exact=False).first.click()
        page.wait_for_timeout(2000)

        pill = page.locator(".dshRS_pill")
        try:
            pill.wait_for(state="visible", timeout=10_000)
        except Exception:
            check(False, "capsule mounted", "no .dshRS_pill in the DOM")
            browser.close()
            return 1

        text = pill.inner_text()
        check(any(word in text for word in ("Running", "Thinking", "Writing", "运行", "思考")), "capsule names a phase", text.replace("\n", " "))
        check("·" in text, "capsule has separators", text.replace("\n", " "))

        pill_box = pill.bounding_box()
        seat = page.locator("[data-composer-seat]").bounding_box()
        gap = (seat["y"] - (pill_box["y"] + pill_box["height"])) if pill_box and seat else -1
        check(seat is not None and pill_box is not None and -0.5 <= gap <= 16, "capsule sits above composer", f"gap={gap:.1f}px")

        before = page.locator("[data-composer-seat]").bounding_box()
        page.evaluate("document.querySelector('[data-dsh-run-strip]').style.display='none'")
        hidden = page.locator("[data-composer-seat]").bounding_box()
        page.evaluate("document.querySelector('[data-dsh-run-strip]').style.display=''")
        stable = before and hidden and abs(before["y"] - hidden["y"]) < 0.5 and abs(before["height"] - hidden["height"]) < 0.5
        check(bool(stable), "capsule does not change composer height", f"{before['height'] if before else '?'} vs {hidden['height'] if hidden else '?'}")

        # The overridden threshold makes the stall reachable without a real wait.
        stalled = False
        for _ in range(4):
            page.wait_for_timeout(300)
            if page.locator(".dshRS_pill[data-stalled]").count() > 0:
                stalled = True
                break
        stalled_text = page.locator(".dshRS_pill").inner_text().replace("\n", " ") if page.locator(".dshRS_pill").count() else ""
        check(stalled, "stall state reached without wall-clock wait", stalled_text)

        light_bg = page.evaluate("getComputedStyle(document.querySelector('.dshRS_pill')).backgroundColor")
        page.emulate_media(color_scheme="dark")
        page.wait_for_timeout(200)
        dark_bg = page.evaluate("getComputedStyle(document.querySelector('.dshRS_pill')).backgroundColor")
        check(light_bg != dark_bg, "dark mode uses a different capsule surface", f"{light_bg} -> {dark_bg}")

        page.emulate_media(color_scheme="light", reduced_motion="reduce")
        page.wait_for_timeout(200)
        dot_animation = page.evaluate("getComputedStyle(document.querySelector('.dshRS_dot')).animationName")
        check(dot_animation == "none", "reduced motion disables the dot pulse", dot_animation)

        check(not errors, "no console or page errors", "; ".join(errors[:3]))
        check(page.locator("style[data-plugin='@local/stream-polish']").count() == 1, "plugin stylesheet mounted")

        if args.shot:
            page.screenshot(path=args.shot)
            print(f"[SHOT] {args.shot}")

        browser.close()

    failed = [label for ok, label, _ in results if not ok]
    print(json.dumps({"checks": len(results), "failed": failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
