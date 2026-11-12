#!/usr/bin/env python3
"""WEB-001 本地静态服务 + 豆包/方舟接口代理。

- 同时提供本目录下的网页，避免 file:// 跨域。
- 把浏览器传来的密钥仅用于当次转发，不写磁盘、不打进日志。
- 零第三方依赖，标准库即可运行：  python3 server.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import traceback
from html import unescape as html_unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parent
DEFAULT_ARK = "https://ark.cn-beijing.volces.com/api/v3"
ALLOWED_HOSTS = (
    "ark.cn-beijing.volces.com",
    "ark.volces.com",
    "api-gateway.volcengineapi.com",
)
# 链接解析只放行这四个平台的短链域名、内容页域名与公开接口域名（含子域）。
LINK_HOSTS = (
    "xiaohongshu.com", "xiaohongshu.cn", "xhslink.com", "xhslink.cn",
    "douyin.com", "iesdouyin.com",
    "bilibili.com", "b23.tv",
    "weibo.com", "weibo.cn", "t.cn",
)
SHORT_HOSTS = ("v.douyin.com", "xhslink.com", "xhslink.cn", "b23.tv", "t.cn")
PLATFORM_LABEL = {"xhs": "小红书", "douyin": "抖音", "bilibili": "B站", "weibo": "微博"}
PLATFORM_NEEDS_COOKIE = {"xhs": True, "douyin": True, "bilibili": False, "weibo": True}
MAX_HOPS = 10
LINK_TIMEOUT = 20
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


class _NoRedirect(HTTPRedirectHandler):
    """短链展开由 _resolve_chain 自己控制跳数，禁止 urllib 自动跟随。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = build_opener(_NoRedirect)

def _log(msg: str) -> None:
    print(msg, flush=True)


def _host_ok(url: str, allowed) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    return host in allowed or any(host.endswith("." + h) for h in allowed)


# ---------------- 链接解析（四平台） ----------------
def _platform_of(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return ""
    groups = (
        ("douyin", ("douyin.com", "iesdouyin.com")),
        ("xhs", ("xiaohongshu.com", "xiaohongshu.cn", "xhslink.com", "xhslink.cn")),
        ("bilibili", ("bilibili.com", "b23.tv")),
        ("weibo", ("weibo.com", "weibo.cn", "t.cn")),
    )
    for platform, suffixes in groups:
        for suffix in suffixes:
            if host == suffix or host.endswith("." + suffix):
                return platform
    return ""


def _open(req, timeout: int):
    """单独留出的网络出口，便于离线测试用 mock 上游替换（产品路径不变）。"""
    return _OPENER.open(req, timeout=timeout)


def _http_get(url: str, cookie: str = "", extra_headers: dict | None = None) -> dict:
    """只发 GET，不用 HEAD；带浏览器 UA；从不把 Cookie 放进日志或返回值。"""
    headers = dict(BROWSER_HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    if cookie:
        headers["Cookie"] = cookie
    req = Request(url, headers=headers, method="GET")
    try:
        with _open(req, LINK_TIMEOUT) as resp:
            return {
                "status": getattr(resp, "status", None) or resp.getcode(),
                "url": resp.geturl(),
                "headers": dict(resp.headers.items()) if resp.headers else {},
                "body": resp.read(),
            }
    except HTTPError as e:
        return {
            "status": e.code,
            "url": getattr(e, "url", None) or url,
            "headers": dict(e.headers.items()) if e.headers else {},
            "body": e.read() or b"",
        }
    except URLError as e:
        raise RuntimeError("无法访问该链接：%s" % e.reason)


def _js_redirect(body: bytes, base: str) -> str:
    """短链登录墙常见 200 + JS/meta 跳转；只在短链域或登录墙上用。"""
    text = html_unescape(body.decode("utf-8", "ignore")[:200000])
    patterns = (
        r"""(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']""",
        r"""location\.replace\(\s*["']([^"']+)["']""",
        r"""<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'\s>]+)""",
        r"""https?://[^\s"'<>]*(?:redirectPath=|visitor\?url=)[^\s"'>]+""",
    )
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            target = urljoin(base, m.group(1) if m.lastindex else m.group(0))
            if _host_ok(target, LINK_HOSTS):
                return target
    return ""


def _resolve_chain(start_url: str) -> dict:
    """GET 跟随跳转，上限 10 跳，逐跳校验域名；记录跳转链，不自动跟随。"""
    cur = start_url
    chain = []
    for hop in range(MAX_HOPS + 1):
        if not _host_ok(cur, LINK_HOSTS):
            return {"ok": False, "error": "跳转目标不在允许域名内：%s" % (urlparse(cur).hostname or cur)}
        r = _http_get(cur)
        chain.append({"url": cur, "status": r["status"]})
        location = ""
        for k, v in r["headers"].items():
            if k.lower() == "location" and v:
                location = v
                break
        if r["status"] in (301, 302, 303, 307, 308) and location:
            cur = urljoin(cur, location)
            continue
        # 部分短链返回 200 + JS 跳转；只在短链域/登录墙上跟随，避免误跟内容页脚本
        host = (urlparse(cur).hostname or "").lower()
        if r["status"] == 200 and any(host == s or host.endswith("." + s) for s in SHORT_HOSTS):
            target = _js_redirect(r["body"], cur)
            if target and target != cur:
                cur = target
                continue
        return {
            "ok": True, "finalUrl": r["url"] or cur, "lastUrl": cur,
            "status": r["status"], "chain": chain, "hops": hop, "body": r["body"],
        }
    return {"ok": False, "error": "短链跳转超过 %d 次，已停止" % MAX_HOPS}


def _unwrap_wall(url: str):
    """登录墙 / 访客墙：从 redirectPath（小红书）或 url（微博）解出真实地址。"""
    p = urlparse(url)
    qs = parse_qs(p.query, keep_blank_values=True)
    host = (p.hostname or "").lower()
    if "redirectPath" in qs and (host.endswith("xiaohongshu.com") or host.endswith("xiaohongshu.cn")):
        real = unquote(qs["redirectPath"][0])
        if "%" in real:
            real = unquote(real)
        if real.startswith("/"):
            real = "https://www.xiaohongshu.com" + real
        if _host_ok(real, LINK_HOSTS):
            return real, "redirectPath"
    if "url" in qs and ("weibo" in host or "passport" in host):
        real = unquote(qs["url"][0])
        if "%" in real:
            real = unquote(real)
        if real.startswith("/"):
            real = "https://weibo.com" + real
        if _host_ok(real, LINK_HOSTS):
            return real, "url"
    return url, ""


def _content_id(platform: str, url: str) -> str:
    p = urlparse(url)
    path, qs = p.path or "", parse_qs(p.query)
    if platform == "xhs":
        m = re.search(r"/(?:discovery/item|explore|search_result)/([0-9a-zA-Z_-]{8,})", path)
        return m.group(1) if m else ""
    if platform == "douyin":
        m = re.search(r"/(?:share/)?video/(\d{6,})", path)
        if m:
            return m.group(1)
        return (qs.get("item_ids") or [""])[0]
    if platform == "bilibili":
        m = re.search(r"/(BV[0-9A-Za-z]{8,})", path)
        return m.group(1) if m else (qs.get("bvid") or [""])[0]
    if platform == "weibo":
        m = re.search(r"/\d{5,}/([A-Za-z0-9]{5,})", path)
        if m:
            return m.group(1)
        m = re.search(r"/([A-Za-z0-9]{6,})/?$", path)
        return m.group(1) if m else ""
    return ""


def resolve_link(url: str) -> dict:
    """展开短链并返回 {platform, contentId, finalUrl, realUrl}；不发任何 Cookie。"""
    if not url or not re.match(r"https?://", url, re.I):
        return {"ok": False, "error": "缺少有效链接"}
    platform = _platform_of(url)
    if not platform:
        return {"ok": False, "error": "暂不支持该链接（域名 %s）。目前支持抖音 / 小红书 / B站 / 微博。" % (urlparse(url).hostname or "未知")}
    r = _resolve_chain(url)
    if not r.get("ok"):
        return {"ok": False, "platform": platform, "error": r.get("error") or "短链展开失败"}
    final_url = r["finalUrl"]
    real_url, wall = _unwrap_wall(final_url)
    real_platform = _platform_of(real_url) or platform
    return {
        "ok": True,
        "platform": real_platform,
        "contentId": _content_id(real_platform, real_url),
        "finalUrl": final_url,
        "realUrl": real_url,
        "wall": wall,
        "hops": r["hops"],
        "needCookie": PLATFORM_NEEDS_COOKIE.get(real_platform, True),
    }


def _usable_text(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 8:
        return False
    bad = ("安全验证", "滑块验证", "请登录后", "登录 - 小红书", "抖音 - 记录美好生活", "访问受限")
    return not any(b in t for b in bad)


def _html_text(url: str, cookie: str, label: str) -> dict:
    r = _http_get(url, cookie=cookie)
    if r["status"] != 200:
        return {"ok": False, "error": "%s页面返回 HTTP %s（多半被登录墙拦截）。" % (label, r["status"])}
    html = r["body"].decode("utf-8", "ignore")
    title = _meta(html, "og:title") or _tag(html, "title")
    desc = _meta(html, "og:description") or _meta(html, "description")
    text = _extract_initial_state(html) or "\n".join(t for t in (title, desc) if t)
    if not _usable_text(text):
        return {"ok": False, "error": "已打开%s页面，但没有读到可用正文（多半被登录墙拦截），未编造文案。" % label}
    return {"ok": True, "title": title or "", "text": text[:20000], "source": "html", "finalUrl": r["url"]}


def _bilibili_text(content_id: str) -> dict:
    """B站公开接口，不需要 Cookie。"""
    if not content_id:
        return {"ok": False, "error": "未能从链接里识别出 B站 BV 号。"}
    api = "https://api.bilibili.com/x/web-interface/view?bvid=" + quote(content_id)
    r = _http_get(api)  # 明确不带 Cookie
    if r["status"] == 200:
        try:
            data = json.loads(r["body"].decode("utf-8", "ignore"))
        except Exception:
            data = {}
        d = (data.get("data") or {}) if isinstance(data, dict) else {}
        title, desc = str(d.get("title") or ""), str(d.get("desc") or "")
        if title or desc:
            return {
                "ok": True, "title": title,
                "text": (title + ("\n" + desc if desc else ""))[:20000],
                "source": "bilibili-api", "finalUrl": r["url"],
            }
    page = _http_get("https://www.bilibili.com/video/" + quote(content_id))
    if page["status"] == 200:
        html = page["body"].decode("utf-8", "ignore")
        title = _meta(html, "og:title") or _tag(html, "title")
        desc = _meta(html, "og:description") or _meta(html, "description")
        text = "\n".join(t for t in (title, desc) if t)
        if _usable_text(text):
            return {"ok": True, "title": title, "text": text[:20000], "source": "bilibili-page", "finalUrl": page["url"]}
    return {"ok": False, "error": "B站公开接口与视频页都没取到标题/简介，未编造文案。"}


def _douyin_text(content_id: str, cookie: str) -> dict:
    """页面一路 + iesdouyin iteminfo 一路；两路都不通就明确报错。"""
    if not content_id:
        return {"ok": False, "error": "未能从链接里识别出抖音视频 ID。"}
    page_url = "https://www.douyin.com/video/" + quote(content_id)
    page = _http_get(page_url, cookie=cookie)
    if page["status"] == 200:
        html = page["body"].decode("utf-8", "ignore")
        title = _meta(html, "og:title") or _tag(html, "title")
        desc = _meta(html, "og:description") or _meta(html, "description")
        text = _extract_initial_state(html) or "\n".join(t for t in (title, desc) if t)
        if _usable_text(text):
            return {"ok": True, "title": title or "", "text": text[:20000], "source": "douyin-page", "finalUrl": page["url"]}
    api = "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=" + quote(content_id)
    r = _http_get(api, cookie=cookie)
    if r["status"] == 200:
        try:
            data = json.loads(r["body"].decode("utf-8", "ignore"))
        except Exception:
            data = {}
        items = data.get("item_list") or [] if isinstance(data, dict) else []
        if items:
            item = items[0] or {}
            title = str(item.get("title") or (item.get("share_info") or {}).get("share_title") or "")
            desc = str(item.get("desc") or "")
            text = "\n".join(t for t in (title, desc) if t)
            if _usable_text(text):
                return {"ok": True, "title": title, "text": text[:20000], "source": "douyin-iteminfo", "finalUrl": r["url"]}
    return {"ok": False, "error": "抖音页面与 iteminfo 接口都没取到文案（多半被登录墙/风控拦截）。请改用上传视频/音频文件转写，不要假装已提取成功。"}


def fetch_platform_text(platform: str, content_id: str, real_url: str, cookie: str = "") -> dict:
    if PLATFORM_NEEDS_COOKIE.get(platform, True) and not cookie:
        return {"ok": False, "error": "未配置%s Cookie，未发起该平台的取文案请求。" % PLATFORM_LABEL.get(platform, "该平台")}
    if platform == "bilibili":
        return _bilibili_text(content_id)
    if platform == "xhs":
        if not content_id:
            return {"ok": False, "error": "未能从链接里识别出小红书笔记 ID。"}
        return _html_text("https://www.xiaohongshu.com/discovery/item/" + quote(content_id), cookie, "小红书")
    if platform == "douyin":
        return _douyin_text(content_id, cookie)
    if platform == "weibo":
        return _html_text(real_url, cookie, "微博")
    return {"ok": False, "error": "暂不支持该平台的文案提取。"}


def _read_json(handler) -> dict:
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


def _forward(url: str, method: str, headers: dict, body: bytes, timeout: int):
    req = Request(url, data=body if method != "GET" else None, method=method)
    for k, v in headers.items():
        if v is not None:
            req.add_header(k, v)
    try:
        with urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            return resp.status, resp.headers, data
    except HTTPError as e:
        return e.code, e.headers, e.read() or str(e).encode()
    except URLError as e:
        return 502, {}, json.dumps({"error": {"message": f"无法连接到上游：{e.reason}"}}).encode()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # 不把 Authorization 或请求体打进日志
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Ark-Base, X-XHS-Cookie, X-Douyin-Cookie, X-Weibo-Cookie")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Vary", "Origin")

    def _send(self, code: int, body: bytes, content_type="application/json; charset=utf-8"):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/health":
            self._send_json(200, {"ok": True, "app": "WEB-001", "root": str(ROOT)})
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        routes = {
            "/api/chat": self._proxy_ark,
            "/api/images": self._proxy_ark,
            "/api/resolve-link": self._resolve_link_api,
            "/api/fetch-note": self._fetch_note,
            "/api/transcribe": self._transcribe,
            "/api/parse-table": self._parse_table,
        }
        fn = routes.get(path)
        if not fn:
            self._send_json(404, {"error": {"message": f"未知接口 {path}"}})
            return
        try:
            fn()
        except Exception as e:
            traceback.print_exc()
            self._send_json(500, {"error": {"message": f"本地代理出错：{e}"}})

    def _auth(self):
        return (self.headers.get("Authorization") or "").strip()

    def _ark_base(self):
        base = (self.headers.get("X-Ark-Base") or DEFAULT_ARK).strip().rstrip("/")
        if not base.startswith("https://"):
            return None, "接口地址必须以 https:// 开头"
        if not _host_ok(base, ALLOWED_HOSTS):
            return None, "只允许转发到火山方舟官方域名"
        return base, None

    def _proxy_ark(self):
        auth = self._auth()
        if not auth:
            self._send_json(401, {"error": {"message": "未提供 API 密钥。请先到设置页填写火山方舟 ARK API Key。"}})
            return
        base, err = self._ark_base()
        if err:
            self._send_json(400, {"error": {"message": err}})
            return
        path = self.path.split("?", 1)[0]
        if path == "/api/chat":
            upstream = base + "/chat/completions"
            timeout = 180
        else:
            upstream = base + "/images/generations"
            timeout = 300
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        # 粗略校验 JSON，避免把任意字节转发出去
        try:
            json.loads(body.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": {"message": "请求体不是合法 JSON"}})
            return
        status, headers, data = _forward(
            upstream,
            "POST",
            {
                "Authorization": auth,
                "Content-Type": "application/json",
            },
            body,
            timeout,
        )
        ctype = "application/json; charset=utf-8"
        if headers and headers.get("Content-Type"):
            ctype = headers.get("Content-Type")
        self._send(status, data, ctype)

    def _resolve_link_api(self):
        """只展开短链并识别平台 / 内容 ID，不发任何 Cookie、不取正文。"""
        payload = _read_json(self)
        try:
            res = resolve_link((payload.get("url") or "").strip())
        except Exception as e:
            res = {"ok": False, "error": "短链展开失败：%s" % e}
        self._send_json(200, res)

    def _cookie_for(self, platform: str, payload: dict) -> str:
        """Cookie 只从本次请求取，绝不落盘、不进日志、不回显。"""
        cookie = (payload.get("cookie") or "").strip()
        if cookie:
            return cookie
        header_names = {
            "xhs": "X-XHS-Cookie",
            "douyin": "X-Douyin-Cookie",
            "weibo": "X-Weibo-Cookie",
        }
        name = header_names.get(platform, "X-XHS-Cookie")
        return (self.headers.get(name) or "").strip()

    def _fetch_note(self):
        payload = _read_json(self)
        url = (payload.get("url") or "").strip()
        if not url or not re.match(r"https?://", url, re.I):
            self._send_json(200, {"ok": False, "error": "缺少有效链接"})
            return
        initial_platform = _platform_of(url)
        if not initial_platform:
            self._send_json(200, {
                "ok": False,
                "error": "暂不支持该链接（域名 %s）。目前支持抖音 / 小红书 / B站 / 微博，未发起任何请求。" % (urlparse(url).hostname or "未知"),
            })
            return
        cookie = self._cookie_for(initial_platform, payload)
        # 需要 Cookie 的平台，缺 Cookie 时在任何网络请求之前就返回（短链也不展开）。
        if PLATFORM_NEEDS_COOKIE.get(initial_platform, True) and not cookie:
            label = PLATFORM_LABEL.get(initial_platform, "该平台")
            self._send_json(200, {
                "ok": False,
                "platform": initial_platform,
                "error": "未配置%s Cookie，未向%s发起任何请求。请到设置页填写%s Cookie，或改用上传视频/音频文件转写。" % (label, label, label),
            })
            return
        try:
            r = resolve_link(url)
        except Exception as e:
            self._send_json(200, {"ok": False, "platform": initial_platform, "error": "短链展开失败：%s" % e})
            return
        if not r.get("ok"):
            self._send_json(200, {"ok": False, "platform": initial_platform, "error": r.get("error") or "短链展开失败"})
            return
        platform = r["platform"]
        out = {
            "ok": False,
            "platform": platform,
            "contentId": r["contentId"],
            "finalUrl": r["finalUrl"],
            "realUrl": r["realUrl"],
            "hops": r["hops"],
            "needCookie": r["needCookie"],
        }
        try:
            out.update(fetch_platform_text(platform, r["contentId"], r["realUrl"], cookie))
        except Exception as e:
            out["error"] = "解析失败：%s" % e
        self._send_json(200, out)

    def _transcribe(self):
        length = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type") or ""
        raw = self.rfile.read(length) if length else b""
        # 支持 raw binary 或 JSON {filename, mime, data(base64)}
        filename = "audio.bin"
        if "application/json" in ctype:
            payload = json.loads(raw.decode("utf-8") or "{}")
            import base64
            filename = payload.get("filename") or filename
            raw = base64.b64decode(payload.get("data") or "")
            mime = payload.get("mime") or ""
        else:
            mime = ctype
        if not raw:
            self._send_json(400, {"ok": False, "error": "没有收到文件"})
            return
        # 尝试本地 whisper / faster-whisper，均未安装则明确降级
        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            text, engine = _run_whisper(tmp_path)
            if text is None:
                self._send_json(200, {
                    "ok": False,
                    "engine": None,
                    "error": (
                        "本机未安装可用的免费语音转写引擎。"
                        "可在本目录执行 pip install -U openai-whisper（或 faster-whisper）后重试，"
                        "也可改用页面上的浏览器语音识别（Web Speech）。"
                    ),
                })
                return
            segments = _split_segments(text)
            self._send_json(200, {"ok": True, "engine": engine, "text": text, "segments": segments})
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _parse_table(self):
        payload = _read_json(self)
        name = payload.get("filename") or "import.csv"
        data = payload.get("data") or ""
        import base64
        try:
            raw = base64.b64decode(data)
        except Exception:
            self._send_json(400, {"ok": False, "error": "文件内容无法解码"})
            return
        rows, err = _parse_bytes(name, raw)
        if err:
            self._send_json(200, {"ok": False, "error": err})
            return
        self._send_json(200, {"ok": True, "rows": rows})


def _meta(html: str, name: str) -> str:
    pats = [
        rf'<meta[^>]+property=["\']{re.escape(name)}["\'][^>]+content=["\'](.*?)["\']',
        rf'<meta[^>]+content=["\'](.*?)["\'][^>]+property=["\']{re.escape(name)}["\']',
        rf'<meta[^>]+name=["\']{re.escape(name)}["\'][^>]+content=["\'](.*?)["\']',
        rf'<meta[^>]+content=["\'](.*?)["\'][^>]+name=["\']{re.escape(name)}["\']',
    ]
    for p in pats:
        m = re.search(p, html, re.I | re.S)
        if m:
            return _unescape(m.group(1)).strip()
    return ""


def _tag(html: str, tag: str) -> str:
    m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", html, re.I | re.S)
    return re.sub(r"<[^>]+>", "", _unescape(m.group(1))).strip() if m else ""


def _unescape(s: str) -> str:
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&#39;", "'"))


def _extract_initial_state(html: str) -> str:
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*;?\s*</script>", html, re.S)
    if not m:
        return ""
    raw = m.group(1)
    # 可能包含 undefined
    raw = raw.replace(":undefined", ":null")
    try:
        data = json.loads(raw)
    except Exception:
        # 尽力抽出 note 正文
        texts = re.findall(r'"(?:desc|description|title|content|text)"\s*:\s*"((?:\\.|[^"\\])*)"', raw)
        return "\n".join(_unescape(t.encode("utf-8").decode("unicode_escape")) for t in texts[:8] if t)
    blobs = []

    def walk(obj, depth=0):
        if depth > 8:
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("desc", "description", "title", "content", "text", "name") and isinstance(v, str) and len(v) > 4:
                    blobs.append(v)
                else:
                    walk(v, depth + 1)
        elif isinstance(obj, list):
            for it in obj[:30]:
                walk(it, depth + 1)

    walk(data)
    # 去重保序
    seen = set()
    out = []
    for b in blobs:
        b = b.strip()
        if b and b not in seen:
            seen.add(b)
            out.append(b)
    return "\n\n".join(out)


def _split_segments(text: str):
    parts = re.split(r"(?:\n\s*){2,}|(?<=[。！？!?\n])\s+", text.strip())
    segs = [p.strip() for p in parts if p and p.strip()]
    if not segs:
        segs = [text.strip()]
    return [{"index": i + 1, "text": s} for i, s in enumerate(segs)]


def _run_whisper(path: str):
    try:
        from faster_whisper import WhisperModel  # type: ignore
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, info = model.transcribe(path, language="zh")
        text = "".join(s.text for s in segments).strip()
        return text or None, "faster-whisper-tiny"
    except Exception:
        pass
    try:
        import whisper  # type: ignore
        model = whisper.load_model("tiny")
        result = model.transcribe(path, language="zh")
        text = (result.get("text") or "").strip()
        return text or None, "openai-whisper-tiny"
    except Exception:
        return None, None


def _parse_bytes(name: str, raw: bytes):
    lower = name.lower()
    if lower.endswith(".xlsx"):
        return _parse_xlsx(raw)
    # csv / tsv / txt / xls (xls 不解析，提示另存)
    if lower.endswith(".xls") and not lower.endswith(".xlsx"):
        return None, "暂不支持旧版 .xls，请另存为 .xlsx 或 CSV 后再导入。"
    text = None
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return None, "无法识别文本编码，请另存为 UTF-8 CSV。"
    import csv
    from io import StringIO
    dialect = csv.Sniffer().sniff(text[:2000], delimiters=",\t;|") if text.strip() else csv.excel
    rows = list(csv.reader(StringIO(text), dialect))
    return rows, None


def _parse_xlsx(raw: bytes):
    import zipfile
    from io import BytesIO
    import xml.etree.ElementTree as ET
    try:
        zf = zipfile.ZipFile(BytesIO(raw))
    except zipfile.BadZipFile:
        return None, "不是有效的 Excel 文件"
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
    sheet_name = "xl/worksheets/sheet1.xml"
    if sheet_name not in zf.namelist():
        names = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
        if not names:
            return None, "工作簿里没有工作表"
        sheet_name = names[0]
    root = ET.fromstring(zf.read(sheet_name))
    rows = []
    for row in root.findall("m:sheetData/m:row", ns):
        values = []
        for c in row.findall("m:c", ns):
            typ = c.get("t")
            v = c.find("m:v", ns)
            is_el = c.find("m:is", ns)
            if typ == "s" and v is not None and v.text is not None:
                idx = int(v.text)
                values.append(shared[idx] if 0 <= idx < len(shared) else "")
            elif typ == "inlineStr" and is_el is not None:
                values.append("".join(t.text or "" for t in is_el.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
            elif v is not None:
                values.append(v.text or "")
            else:
                values.append("")
        if any(str(x).strip() for x in values):
            rows.append(values)
    return rows, None


def main():
    parser = argparse.ArgumentParser(description="WEB-001 本地工作台服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    _log(f"WEB-001 工作台已启动：{url}")
    _log("在浏览器打开上面的地址（不要直接双击 HTML，否则调用接口可能被跨域拦截）。")
    _log("按 Ctrl+C 结束。密钥只会从浏览器请求头临时转发，不会写到本机文件。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("\n已停止。")


if __name__ == "__main__":
    main()
