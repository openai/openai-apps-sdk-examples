import asyncio
from pyppeteer import launch
from pyppeteer_stealth import stealth
from urllib.parse import quote
from typing import List, Dict, Any


async def _search_amazon_async(query: str, hits: int = 10) -> List[Dict[str, Any]]:
    """使用 pyppeteer 浏览器抓取 Amazon.co.jp 搜索结果。"""
    encoded = quote(query)
    url = f"https://www.amazon.co.jp/s?k={encoded}"

    browser = await launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-extensions",
            "--disable-gpu",
            "--disable-infobars",
            "--window-size=1280,800",
        ],
        executablePath=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    )
    page = await browser.newPage()
    await stealth(page)

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    )

    await page.goto(url, {"waitUntil": "networkidle2"})
    await asyncio.sleep(3)

    items = await page.querySelectorAll("div.s-result-item[data-component-type='s-search-result']")
    results: List[Dict[str, Any]] = []

    for item in items[:hits]:
        title_el = await item.querySelector("h2 a span")
        link_el = await item.querySelector("h2 a")
        img_el = await item.querySelector("img.s-image")
        price_el = await item.querySelector("span.a-price-whole")

        name = await (await title_el.getProperty("textContent")).jsonValue() if title_el else None
        link = await (await link_el.getProperty("href")).jsonValue() if link_el else None
        img = await (await img_el.getProperty("src")).jsonValue() if img_el else None
        price = await (await price_el.getProperty("textContent")).jsonValue() if price_el else None

        results.append({
            "name": name.strip() if name else None,
            "url": link,
            "image": img,
            "price": price.strip() if price else None,
        })

    await browser.close()
    return results


def _search_amazon(query: str, hits: int = 10) -> List[Dict[str, Any]]:
    import asyncio
    try:
        # Python 3.10+ 推荐写法
        return asyncio.run(_search_amazon_async(query, hits))
    except RuntimeError:
        # 若在已有 event loop（如 FastAPI 环境）中，则使用当前 loop
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(_search_amazon_async(query, hits))

if __name__ == "__main__":
    query = "iphone"
    res = _search_amazon(query, hits=10)
    print(f"✅ 共抓取 {len(res)} 条结果")
    for r in res:
        print(r)
