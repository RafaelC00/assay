"""Generate blank packaging plates through the Gemini web UI ($0 lane).

    python scripts/images/generate.py [plate-key ...]

Drives a persistent Chrome profile (log in once, by hand). Every run writes to
its own timestamped folder, runs/<UTC-stamp>/, and nothing is ever
overwritten: the picks are copied to plates/ separately (see build.py).
"""
import asyncio, base64, datetime, json, os, random, sys
from pathlib import Path
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).parent))
from plates import PLATES, SCENE

HERE = Path(__file__).parent
PROFILE = os.environ.get("GEMINI_PROFILE") or str(Path.home() / ".playwright-gemini-profile")

GRAB = """async (el) => {
  const c = document.createElement('canvas');
  c.width = el.naturalWidth; c.height = el.naturalHeight;
  c.getContext('2d').drawImage(el, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}"""

class Blocked(Exception):
    pass

async def generate(page, prompt, timeout=150):
    await page.goto("https://gemini.google.com/app", wait_until="domcontentloaded")
    await asyncio.sleep(5)
    if "/sorry/" in page.url:
        raise Blocked("Google is showing its unusual-traffic check; stop and retry later")
    box = page.locator('div[contenteditable="true"], textarea').first
    await box.wait_for(state="visible", timeout=30000)
    await box.click()
    await page.keyboard.insert_text("Generate an image. " + prompt)
    await asyncio.sleep(1)
    await page.keyboard.press("Enter")
    for _ in range(timeout // 3):
        await asyncio.sleep(3)
        for img in await page.query_selector_all('img[src^="blob:"]'):
            w = await img.evaluate("e => e.naturalWidth")
            if w >= 800:
                await asyncio.sleep(2)
                return base64.b64decode(await img.evaluate(GRAB))
    raise RuntimeError("no image within timeout")

async def main():
    keys = sys.argv[1:] or list(PLATES)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = HERE / "runs" / stamp
    out.mkdir(parents=True, exist_ok=True)
    log = {}
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, headless=False, channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
            viewport={"width": 1280, "height": 1000})
        page = await ctx.new_page()
        for k in keys:
            prompt = f"{PLATES[k]} {SCENE}"
            try:
                data = await generate(page, prompt)
                (out / f"{k}.png").write_bytes(data)
                log[k] = {"prompt": prompt, "bytes": len(data)}
                print("ok  ", k, len(data) // 1024, "KB", flush=True)
            except Blocked as e:
                print("BLOCKED", e, flush=True)
                break
            except Exception as e:
                log[k] = {"prompt": prompt, "error": str(e)}
                print("FAIL", k, e, flush=True)
            (out / "run.json").write_text(json.dumps(log, indent=2))
            # Pace like a person: bursts are what trip the unusual-traffic check.
            await asyncio.sleep(random.uniform(60, 100))
        await ctx.close()
    print(out)

asyncio.run(main())
