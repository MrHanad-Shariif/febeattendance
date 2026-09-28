"""Turn a browser's User-Agent header into a short, readable device summary
for the system log, e.g. "Chrome 153 · Windows 10/11 · Desktop".

Deliberately small: it only needs to tell staff apart "their phone" from
"a Windows PC in the office", not identify exact models.
"""
import re

# Order matters: Edge, Opera and Samsung Internet also say "Chrome", and
# Chrome also says "Safari".
_BROWSERS = [
    ("Edge", r"Edg(?:e|A|iOS)?/(\d+)"),
    ("Opera", r"(?:OPR|Opera)/(\d+)"),
    ("Samsung Internet", r"SamsungBrowser/(\d+)"),
    ("Firefox", r"(?:Firefox|FxiOS)/(\d+)"),
    ("Chrome", r"(?:Chrome|CriOS)/(\d+)"),
    ("Safari", r"Version/(\d+)[.\d]* (?:Mobile/\S+ )?Safari/"),
]

_OS = [
    ("iOS", r"(?:iPhone|iPad|iPod).*?OS (\d+)"),
    ("Android", r"Android (\d+)"),
    ("Windows", r"Windows NT (\d+\.\d+)"),
    ("ChromeOS", r"CrOS"),
    ("macOS", r"Mac OS X (\d+)[._](\d+)"),
    ("Linux", r"Linux"),
]

_WINDOWS = {"10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7"}

_BOTS = re.compile(r"bot|crawl|spider|curl|wget|python-requests|httpclient|okhttp|postman", re.I)


def describe_device(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    ua = user_agent
    if _BOTS.search(ua):
        return f"Script / bot ({ua[:60]})"

    browser = None
    for name, pattern in _BROWSERS:
        m = re.search(pattern, ua)
        if m:
            browser = f"{name} {m.group(1)}"
            break

    os_name = None
    for name, pattern in _OS:
        m = re.search(pattern, ua)
        if not m:
            continue
        if name == "Windows":
            os_name = f"Windows {_WINDOWS.get(m.group(1), m.group(1))}"
        elif name == "macOS":
            os_name = "macOS"
        elif m.groups():
            os_name = f"{name} {m.group(1)}"
        else:
            os_name = name
        break

    if "iPad" in ua or ("Android" in ua and "Mobile" not in ua) or "Tablet" in ua:
        kind = "Tablet"
    elif "Mobile" in ua or "iPhone" in ua or "iPod" in ua:
        kind = "Phone"
    elif os_name:
        kind = "Desktop"
    else:
        kind = None

    parts = [p for p in (browser, os_name, kind) if p]
    return " · ".join(parts) if parts else ua[:120]
