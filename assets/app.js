/* WEB-001 逻辑层：接在豆包前端壳上。密钥只存 localStorage，不上传。 */
(function () {
  "use strict";

  var LS = {
    settings: "web001.settings",
    notes: "web001.notes",
    tpls: "web001.templates",
    extract: "web001.extract",
    product: "web001.product"
  };
  var DEFAULT_TEXT_MODEL = "doubao-seed-2-1-lite-260915";
  var DEFAULT_IMAGE_MODEL = "doubao-seedream-5-0-pro-260628";
  var DEFAULT_BASE = "https://ark.cn-beijing.volces.com/api/v3";
  var MAX_WINDOWS = 10;
  var MAX_IMAGES = 9;
  var MAX_BYTES = 10 * 1024 * 1024;
  var MAX_CHARS = 10000;
  var THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  var BUILTIN_TEMPLATES = [
    { id: "ppt", name: "PPT 美化设计", prompt: "做一张可直接放进演示文稿的封面页。浅色留白背景，左上角一组简洁线性图标，右侧大标题分两行，标题下面一行小字副标题。信息层级清楚：标题最重、副标题次之、角落放页码或章节号。扁平矢量，对齐网格，不要堆装饰、不要假三维、不要水印。中文排版，3:4 竖版。" },
    { id: "notes", name: "手写笔记考点卡片", prompt: "做一张手写风格的考点复习卡片。米白纸色，浅咖啡横线，顶部用深棕色写出「考点」和序号，中间列出 4 到 6 条短句要点，每条前面有手绘圆点或星号。边角略微卷边，像随手拍下的笔记，不要印刷体海报感，不要水印。中文手写字，3:4 竖版。" },
    { id: "mood", name: "纯色底大字情绪卡", prompt: "一张纯色背景的大字情绪卡片。背景用单一高饱和色，中央排两到三行短句，字号很大、居中、行距疏朗，只保留一句很小的落款。不要插画、不要照片、不要渐变杂讯、不要水印。中文，1:1 或 3:4 皆可，默认 3:4。" },
    { id: "exam", name: "手写字考试封面设计", prompt: "做一份考试笔记封面。浅灰或淡蓝纸纹，中央用楷书感手写字写上科目和「期末复习」一类标题，下方一行较小的日期或班级留白。四周多留白，像一本刚合上的练习本封面，不要堆贴纸、不要卡通吉祥物、不要水印。中文，3:4 竖版。" },
    { id: "ghibli", name: "吉卜力美学对比图", prompt: "一张左右对比图，吉卜力动画常见的柔光与手绘质感：左边是改造前的日常小景，右边是同一机位改造后的样子，中间用细线或浅色缝分开。草地、暖色屋檐、清透空气感，人物若出现只需侧影。不要真人照片质感，不要Logo，不要水印。中文小标题可写「改造前 / 改造后」，16:9 或 3:4。" },
    { id: "hotpot", name: "火锅店场景替换去重", prompt: "重新构思一张火锅店用餐场景，避免常见网红机位。从斜侧 45 度看一张四人铜锅，蒸汽真实、红汤反光、桌上有少量碟盘和一壶茶，背景是被虚化的店内暖灯，不要大面积招牌文字。写实摄影风格，自然光加一点暖色灯，不要滤镜过度、不要水印。3:4 竖版。" },
    { id: "model", name: "真实模特衣服穿搭", prompt: "街拍风格的上身穿搭图：一位真实感亚洲模特，自然站姿，身着指定衣服（若未指定则是一件剪裁干净的春季外套配阔腿裤），在街角门口，侧逆光，肤色与布料质感真实，浅景深。不要过度美颜、不要假体塑形、不要水印。全身或七分身，3:4 竖版。" },
    { id: "ink", name: "水墨山水商业产品海报", prompt: "水墨山水风格的商业产品海报。宣纸底色，远山用淡墨晕染，近处留白，画面正中静置一件产品（若未指定则是一瓶深色玻璃器皿），墨色与产品边缘干净，右下角可有一枚很小的朱红印章，不要现代电脑字堆满、不要水印。中文，3:4 竖版。" }
  ];

  var state = {
    settings: loadSettings(),
    notes: loadJson(LS.notes, []),
    tplStore: loadJson(LS.tpls, { selectedId: "", custom: [], order: "default" }),
    extract: loadJson(LS.extract, []),
    product: loadJson(LS.product, []),
    rwWindows: [],
    rwActive: 0,
    rwImgFiles: [],
    rwGoodsFiles: [],
    genCount: 1,
    genRef: null,
    session: null,
    sessionPick: 0,
    sessionBase: 0,
    pubFilter: "all",
    pubBatch: false,
    pubQuery: "",
    pubSort: "最近创建",
    extractActive: null,
    productActive: null,
    selected: {}
  };

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJson(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function loadSettings() {
    var s = loadJson(LS.settings, {});
    return {
      apiKey: s.apiKey || "",
      cookie: s.cookie || "",
      douyinCookie: s.douyinCookie || "",
      weiboCookie: s.weiboCookie || "",
      textModel: s.textModel || DEFAULT_TEXT_MODEL,
      imageModel: s.imageModel || DEFAULT_IMAGE_MODEL,
      baseUrl: s.baseUrl || DEFAULT_BASE
    };
  }
  function persistSettings() { saveJson(LS.settings, state.settings); }
  function persistNotes() { saveJson(LS.notes, state.notes); }
  function persistTpl() { saveJson(LS.tpls, state.tplStore); }
  function persistExtract() { saveJson(LS.extract, state.extract); }
  function persistProduct() { saveJson(LS.product, state.product); }

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function nowTs() { return Date.now(); }
  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fmtShort(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function show(el, on) {
    if (!el) return;
    el.classList.toggle("is-hidden", !on);
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }
  function setError(el, msg) {
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; el.removeAttribute("hidden"); }
    else { el.textContent = ""; el.hidden = true; }
  }
  function toast(msg) {
    var n = document.createElement("div");
    n.className = "toast-mini";
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 2200);
  }
  function copyText(text) {
    text = text == null ? "" : String(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast("已复制"); return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("已复制"); return true; }
    catch (e) { toast("复制失败，请手动选择"); return false; }
    finally { ta.remove(); }
  }
  function goTab(id) {
    var el = $(id);
    if (el) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  function truncate(s, n) {
    s = s || "";
    if (s.length <= n) return { text: s, clipped: false };
    return { text: s.slice(0, n), clipped: true };
  }
  function allTemplates() {
    return BUILTIN_TEMPLATES.concat(state.tplStore.custom || []);
  }
  function findTpl(id) {
    var list = allTemplates();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------- API ---------------- */
  function apiOrigin() {
    if (location.protocol === "http:" || location.protocol === "https:") return "";
    return "http://127.0.0.1:8787";
  }
  function hasKey() { return !!(state.settings.apiKey && state.settings.apiKey.trim()); }
  function needKeyOrExplain() {
    if (hasKey()) return true;
    openModal("还没有填写密钥",
      "<p>改写和生图需要火山引擎方舟的 ARK API Key。请到「设置」里自行填写，密钥只保存在本机浏览器，不会写入代码或上传。</p><p>本地的切页、校验、模板、发布列表、导出等功能不需要密钥，现在就能用。</p>",
      [{ label: "去设置", primary: true, onClick: function () { goTab("tab-settings"); } }, { label: "关闭" }]);
    return false;
  }
  function apiPost(path, body, extraHeaders) {
    var headers = { "Content-Type": "application/json" };
    if (hasKey()) headers.Authorization = "Bearer " + state.settings.apiKey.trim();
    if (state.settings.baseUrl) headers["X-Ark-Base"] = state.settings.baseUrl.trim();
    // Cookie 不再挂全局请求头：只在解析链接的请求体里按平台带对应平台的那一份。
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
    var url = apiOrigin() + path;
    return fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) })
      .then(function (res) {
        return res.text().then(function (t) {
          var data = {};
          try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { raw: t }; }
          if (!res.ok) {
            var msg = (data.error && (data.error.message || data.error.code)) || data.message || ("接口返回 HTTP " + res.status);
            var err = new Error(msg);
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      })
      .catch(function (err) {
        if (err && err.status) throw err;
        var hint = apiOrigin()
          ? "无法连上本地代理。请在成品目录执行 python3 server.py，再用浏览器打开它提示的地址。"
          : "当前是直接打开的 HTML。调用豆包接口会被浏览器跨域拦截，请先运行 python3 server.py 再访问本地地址。";
        if (String(err && err.message || "").indexOf("Failed to fetch") >= 0 || (err && err.name === "TypeError")) {
          var e2 = new Error(hint);
          e2.cause = err;
          throw e2;
        }
        throw err;
      });
  }

  function chat(messages, opts) {
    opts = opts || {};
    var body = {
      model: state.settings.textModel || DEFAULT_TEXT_MODEL,
      messages: messages,
      temperature: opts.temperature != null ? opts.temperature : 0.8
    };
    if (opts.json) {
      body.response_format = { type: "json_object" };
    }
    // 关闭深度思考以加快改写（若模型支持）
    body.thinking = { type: "disabled" };
    return apiPost("/api/chat", body).then(function (data) {
      var choice = data.choices && data.choices[0];
      var content = choice && choice.message && choice.message.content;
      if (typeof content !== "string") content = JSON.stringify(content || "");
      return { text: content, raw: data };
    });
  }

  function parseJsonContent(text) {
    if (!text) return null;
    var s = String(text).trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var start = s.indexOf("{");
    var end = s.lastIndexOf("}");
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* ---------------- Modal / lightbox ---------------- */
  function openModal(title, bodyHtml, actions) {
    $("modal-title").textContent = title;
    $("modal-body").innerHTML = bodyHtml;
    var box = $("modal-actions");
    box.innerHTML = "";
    (actions || [{ label: "关闭" }]).forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = a.primary ? "btn btn-primary" : "btn btn-ghost";
      b.textContent = a.label;
      b.addEventListener("click", function () {
        closeModal();
        if (a.onClick) a.onClick();
      });
      box.appendChild(b);
    });
    show($("modal-root"), true);
  }
  function closeModal() { show($("modal-root"), false); }
  function openLightbox(src) {
    $("lightbox-img").src = src;
    show($("lightbox"), true);
  }
  function closeLightbox() { show($("lightbox"), false); $("lightbox-img").src = ""; }

  /* ---------------- Settings ---------------- */
  function fillSettingsForm() {
    $("set-apikey").value = state.settings.apiKey || "";
    $("set-cookie").value = state.settings.cookie || "";
    $("set-douyin-cookie").value = state.settings.douyinCookie || "";
    $("set-weibo-cookie").value = state.settings.weiboCookie || "";
    $("set-text-model").value = state.settings.textModel || DEFAULT_TEXT_MODEL;
    $("set-image-model").value = state.settings.imageModel || DEFAULT_IMAGE_MODEL;
    $("set-base-url").value = state.settings.baseUrl || DEFAULT_BASE;
  }
  function saveSettingsFromForm() {
    state.settings.apiKey = ($("set-apikey").value || "").trim();
    state.settings.cookie = ($("set-cookie").value || "").trim();
    state.settings.douyinCookie = ($("set-douyin-cookie").value || "").trim();
    state.settings.weiboCookie = ($("set-weibo-cookie").value || "").trim();
    state.settings.textModel = ($("set-text-model").value || "").trim() || DEFAULT_TEXT_MODEL;
    state.settings.imageModel = ($("set-image-model").value || "").trim() || DEFAULT_IMAGE_MODEL;
    state.settings.baseUrl = ($("set-base-url").value || "").trim() || DEFAULT_BASE;
    persistSettings();
    $("set-hint").textContent = "已保存到本机。密钥未写入代码，也未上传。";
    toast("设置已保存");
    refreshExtractCookieTip();
  }

  /* ---------------- Links：四平台通用抠链 + 域名识别 ---------------- */
  // 分享文本里链接永远是一个完整的 https?:// 词；只按空白/引号/中文标点切，不再只认小红书。
  var URL_RE = /https?:\/\/[^\s<>"'）】、，。；]+/gi;
  var PLATFORM_LABEL = { xhs: "小红书", douyin: "抖音", bilibili: "B站", weibo: "微博" };
  var PLATFORM_NEEDS_COOKIE = { xhs: true, douyin: true, bilibili: false, weibo: true };
  var HOST_SUFFIXES = [
    ["douyin", ["douyin.com", "iesdouyin.com"]],
    ["xhs", ["xiaohongshu.com", "xiaohongshu.cn", "xhslink.com", "xhslink.cn"]],
    ["bilibili", ["bilibili.com", "b23.tv"]],
    ["weibo", ["weibo.com", "weibo.cn", "t.cn"]]
  ];
  function urlHost(url) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(String(url || ""));
    if (!m) return "";
    return m[1].replace(/^.*@/, "").split(":")[0].toLowerCase();
  }
  function detectPlatform(url) {
    var host = urlHost(url);
    if (!host) return "";
    for (var i = 0; i < HOST_SUFFIXES.length; i++) {
      var list = HOST_SUFFIXES[i][1];
      for (var j = 0; j < list.length; j++) {
        var s = list[j];
        if (host === s || host.slice(-(s.length + 1)) === "." + s) return HOST_SUFFIXES[i][0];
      }
    }
    return "";
  }
  function platformLabel(p) { return PLATFORM_LABEL[p] || "未知平台"; }
  function platformNeedsCookie(p) { return !!PLATFORM_NEEDS_COOKIE[p]; }
  function cookieForPlatform(p) {
    if (p === "xhs") return (state.settings.cookie || "").trim();
    if (p === "douyin") return (state.settings.douyinCookie || "").trim();
    if (p === "weibo") return (state.settings.weiboCookie || "").trim();
    return "";
  }
  function missingCookieMessage(p) {
    return "未配置" + platformLabel(p) + " Cookie，请到「设置」页填写" + platformLabel(p) +
      " Cookie 后重试。本条未向任何站点提交请求。";
  }
  function extractLinks(text) {
    var m = String(text || "").match(URL_RE) || [];
    return m.map(function (u) {
      // 去掉行尾中英文标点；短链结尾的 "/" 必须保留
      return u.replace(/[)\]}>，。；、！？!?,.;:~]+$/, "");
    }).filter(Boolean);
  }
  function unique(arr) {
    var s = {}, out = [];
    arr.forEach(function (x) { if (!s[x]) { s[x] = 1; out.push(x); } });
    return out;
  }

  /* ---------------- Rewrite ---------------- */
  function currentRwMode() {
    if ($("rw-img") && $("rw-img").checked) return "img";
    if ($("rw-goods") && $("rw-goods").checked) return "goods";
    return "link";
  }

  function renderUploadList(listEl, files, kind) {
    listEl.innerHTML = "";
    files.forEach(function (f, i) {
      var wrap = document.createElement("div");
      wrap.className = "upload-item";
      var img = document.createElement("img");
      img.alt = f.name;
      var url = URL.createObjectURL(f);
      img.src = url;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        URL.revokeObjectURL(url);
        if (kind === "img") state.rwImgFiles.splice(i, 1);
        else state.rwGoodsFiles.splice(i, 1);
        renderUploadList(listEl, kind === "img" ? state.rwImgFiles : state.rwGoodsFiles, kind);
      });
      wrap.appendChild(img); wrap.appendChild(btn);
      listEl.appendChild(wrap);
    });
  }

  function acceptImages(fileList, already, errEl) {
    var incoming = Array.prototype.slice.call(fileList || []);
    var errors = [];
    var accepted = already.slice();
    incoming.forEach(function (f) {
      var type = (f.type || "").toLowerCase();
      var name = (f.name || "").toLowerCase();
      var okType = type === "image/jpeg" || type === "image/png" || type === "image/webp" ||
        /\.(jpe?g|png|webp)$/.test(name);
      if (!okType) { errors.push(f.name + "：只接受 JPG / PNG / WEBP"); return; }
      if (f.size > MAX_BYTES) { errors.push(f.name + "：超过 10MB"); return; }
      if (accepted.length >= MAX_IMAGES) { errors.push("最多 9 张"); return; }
      accepted.push(f);
    });
    setError(errEl, errors.join("；"));
    return accepted.slice(0, MAX_IMAGES);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function bindUpload(zoneId, fileId, listId, errId, kind) {
    var zone = $(zoneId), file = $(fileId);
    zone.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      file.click();
    });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
    });
    zone.addEventListener("dragover", function (e) { e.preventDefault(); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      var arr = kind === "img" ? state.rwImgFiles : state.rwGoodsFiles;
      arr = acceptImages(e.dataTransfer.files, arr, $(errId));
      if (kind === "img") state.rwImgFiles = arr; else state.rwGoodsFiles = arr;
      renderUploadList($(listId), arr, kind);
    });
    file.addEventListener("change", function () {
      var arr = kind === "img" ? state.rwImgFiles : state.rwGoodsFiles;
      arr = acceptImages(file.files, arr, $(errId));
      if (kind === "img") state.rwImgFiles = arr; else state.rwGoodsFiles = arr;
      renderUploadList($(listId), arr, kind);
      file.value = "";
    });
  }

  function makeWindow(partial) {
    return Object.assign({
      id: uid("rw"),
      source: "改写",
      mode: "link",
      status: "生成中",
      title: "",
      body: "",
      tags: [],
      rawInput: "",
      saved: false,
      error: "",
      createdAt: nowTs(),
      updatedAt: nowTs()
    }, partial);
  }

  function renderWinBar() {
    var bar = $("rw-win-bar");
    if (state.rwWindows.length <= 1) { show(bar, false); return; }
    show(bar, true);
    bar.innerHTML = "";
    state.rwWindows.forEach(function (w, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rw-win-tab" + (i === state.rwActive ? " is-on" : "");
      b.textContent = "窗口 " + (i + 1) + (w.title ? " · " + w.title.slice(0, 8) : "");
      b.addEventListener("click", function () { state.rwActive = i; paintRwResult(); });
      var x = document.createElement("button");
      x.type = "button"; x.textContent = "×"; x.title = "关闭";
      x.addEventListener("click", function (e) {
        e.stopPropagation();
        state.rwWindows.splice(i, 1);
        if (state.rwActive >= state.rwWindows.length) state.rwActive = Math.max(0, state.rwWindows.length - 1);
        paintRwResult();
      });
      b.appendChild(x);
      bar.appendChild(b);
    });
  }

  function paintRwResult() {
    renderWinBar();
    var card = $("rw-result");
    if (!state.rwWindows.length) { show(card, false); return; }
    show(card, true);
    var w = state.rwWindows[state.rwActive];
    $("rw-result-meta").textContent = "独立改写窗口 #" + (state.rwActive + 1) + " · 共 " + state.rwWindows.length + " 个";
    var chip = $("rw-status-chip");
    chip.innerHTML = '<i class="d"></i>' + (w.saved ? "已保存" : (w.error ? "失败" : (w.title || w.body ? "草稿 · 未保存" : "生成中")));
    $("rw-title").value = w.title || "";
    $("rw-body").value = w.body || (w.error ? "" : "");
    renderTags(w.tags || []);
    updateRwCounts();
    if (w.error) setError($("rw-fetch-hint"), w.error);
    else setError($("rw-fetch-hint"), "");
  }

  function renderTags(tags) {
    var box = $("rw-tags");
    box.innerHTML = "";
    tags.forEach(function (t, i) {
      var s = document.createElement("span");
      s.className = "tag";
      s.textContent = t;
      s.title = "点击删除";
      s.addEventListener("click", function () {
        var w = state.rwWindows[state.rwActive];
        if (!w) return;
        w.tags.splice(i, 1); w.updatedAt = nowTs();
        renderTags(w.tags); updateRwCounts();
      });
      box.appendChild(s);
    });
    var add = document.createElement("span");
    add.className = "tag-add"; add.id = "rw-tag-add"; add.textContent = "＋ 添加标签";
    add.addEventListener("click", function () {
      var v = window.prompt("添加话题标签（不用写 #）");
      if (!v) return;
      var w = state.rwWindows[state.rwActive];
      if (!w) return;
      v = v.replace(/^#/, "").trim();
      if (v && w.tags.indexOf(v) < 0) { w.tags.push(v); w.updatedAt = nowTs(); renderTags(w.tags); updateRwCounts(); }
    });
    box.appendChild(add);
  }
  function updateRwCounts() {
    var title = $("rw-title").value || "";
    var body = $("rw-body").value || "";
    var w = state.rwWindows[state.rwActive];
    var nTags = w ? (w.tags || []).length : 0;
    $("rw-title-count").textContent = title.length + " 字";
    $("rw-body-count").textContent = "含 " + (body.split(/\n+/).filter(Boolean).length) + " 段 · 可直接编辑";
    $("rw-tag-count").textContent = nTags + " 个";
  }
  function syncActiveFromFields() {
    var w = state.rwWindows[state.rwActive];
    if (!w) return;
    w.title = $("rw-title").value;
    w.body = $("rw-body").value;
    w.updatedAt = nowTs();
    updateRwCounts();
  }

  function rewriteSystemPrompt() {
    return "你是小红书笔记改写助手。先把材料读懂，压缩成一句中文要点，再重新组织成一篇可发布的笔记。输出必须是 JSON 对象，键为 title（20-30字左右的标题，不要书名号）、body（分段正文，口语自然，不要标题党堆砌）、tags（4-8个话题词数组，不要#号）。不要解释，不要输出 JSON 以外的文字。";
  }

  function buildUserPayload(job) {
    var parts = [];
    parts.push("来源方式：" + job.modeLabel);
    if (job.productName) parts.push("商品名称：" + job.productName);
    if (job.productUrl) parts.push("商品/笔记链接（只作信息核对，不要在正文里硬贴推广话术）：" + job.productUrl);
    if (job.sourceUrl) parts.push("原笔记链接：" + job.sourceUrl);
    if (job.clipped) parts.push("原文超过一万字，已裁剪后面部分。");
    parts.push("待改写内容：\n" + (job.text || "（无文字，请结合图片理解）"));
    return parts.join("\n");
  }

  function runRewriteJobs(jobs) {
    if (!jobs.length) return;
    if (state.rwWindows.length + jobs.length > MAX_WINDOWS) {
      openModal("超过窗口上限", "<p>最多同时开 10 个独立改写窗口。请先关闭一部分再提交。</p>");
      return;
    }
    if (!needKeyOrExplain()) return;
    jobs.forEach(function (job) {
      var w = makeWindow({ mode: job.mode, rawInput: job.text, sourceUrl: job.sourceUrl });
      state.rwWindows.push(w);
    });
    state.rwActive = state.rwWindows.length - jobs.length;
    paintRwResult();
    jobs.forEach(function (job, j) {
      var idx = state.rwWindows.length - jobs.length + j;
      rewriteOne(state.rwWindows[idx], job);
    });
  }

  function rewriteOne(win, job) {
    win.error = "";
    win.status = "生成中";
    paintRwResult();
    var messages = [{ role: "system", content: rewriteSystemPrompt() }];
    var userContent = buildUserPayload(job);
    if (job.images && job.images.length) {
      var content = [{ type: "text", text: userContent }];
      return Promise.all(job.images.map(fileToDataUrl)).then(function (urls) {
        urls.forEach(function (u) {
          content.push({ type: "image_url", image_url: { url: u } });
        });
        messages.push({ role: "user", content: content });
        return chat(messages, { json: true });
      }).then(function (res) { applyRewrite(win, res.text); })
        .catch(function (err) { failRewrite(win, err); });
    }
    messages.push({ role: "user", content: userContent });
    return chat(messages, { json: true }).then(function (res) { applyRewrite(win, res.text); })
      .catch(function (err) { failRewrite(win, err); });
  }
  function applyRewrite(win, text) {
    var obj = parseJsonContent(text) || {};
    win.title = obj.title || "";
    win.body = obj.body || (obj.title ? "" : String(text || "").trim());
    win.tags = Array.isArray(obj.tags) ? obj.tags.map(function (t) { return String(t).replace(/^#/, "").trim(); }).filter(Boolean) : [];
    win.status = "草稿";
    win.error = "";
    win.updatedAt = nowTs();
    paintRwResult();
  }
  function failRewrite(win, err) {
    win.status = "失败";
    win.error = "改写失败：" + (err && err.message ? err.message : String(err));
    win.updatedAt = nowTs();
    paintRwResult();
  }

  function submitLinkRewrite() {
    setError($("rw-link-error"), "");
    setError($("rw-fetch-hint"), "");
    var raw = ($("rw-link-input").value || "").trim();
    var plain = ($("rw-plain-input").value || "").trim();
    var links = unique(extractLinks(raw));
    // 改写边界：只支持小红书链接，别平台链接明确提示，不静默当小红书处理。
    var nonXhs = links.filter(function (u) { return detectPlatform(u) !== "xhs"; });
    if (nonXhs.length) {
      setError($("rw-link-error"), "改写目前只支持小红书链接。检测到 " +
        nonXhs.map(function (u) {
          var p = detectPlatform(u);
          return p ? platformLabel(p) + "链接" : "暂不支持的链接（" + (urlHost(u) || "未知域名") + "）";
        }).join("、") + "；四平台链接请到「提取视频文案」页处理。");
      $("rw-link-input").classList.add("is-invalid");
      return;
    }
    if (!links.length && !plain) {
      setError($("rw-link-error"), "链接格式不对，请粘贴小红书笔记链接");
      $("rw-link-input").classList.add("is-invalid");
      return;
    }
    $("rw-link-input").classList.remove("is-invalid");
    if (!links.length && plain) {
      var cut = truncate(plain, MAX_CHARS);
      runRewriteJobs([{ mode: "link", modeLabel: "直接粘贴原文", text: cut.text, clipped: cut.clipped }]);
      return;
    }
    if (!needKeyOrExplain()) return;
    // 先尝试抓取；失败则引导原文兜底
    var jobsP = links.slice(0, MAX_WINDOWS).map(function (url) {
      return apiPost("/api/fetch-note", { url: url, platform: "xhs", cookie: state.settings.cookie || "" })
        .then(function (res) {
          if (res && res.ok && (res.text || res.title)) {
            var t = ((res.title || "") + "\n" + (res.text || "")).trim();
            var cut = truncate(t, MAX_CHARS);
            return { mode: "link", modeLabel: "小红书链接", sourceUrl: url, text: cut.text, clipped: cut.clipped };
          }
          return { fail: true, url: url, message: (res && res.error) || "抓取失败" };
        })
        .catch(function (err) {
          return { fail: true, url: url, message: err.message || "抓取失败" };
        });
    });
    Promise.all(jobsP).then(function (results) {
      var jobs = [];
      var fails = [];
      results.forEach(function (r) {
        if (r.fail) fails.push(r);
        else jobs.push(r);
      });
      if (fails.length) {
        var msg = fails.map(function (f) { return f.url + "：" + f.message; }).join("\n");
        if (plain) {
          setError($("rw-fetch-hint"), "部分链接没抓到正文，已改用你贴的原文兜底。详情：\n" + msg);
          var cut = truncate(plain, MAX_CHARS);
          jobs.push({ mode: "link", modeLabel: "直接粘贴原文（抓取失败兜底）", text: cut.text, clipped: cut.clipped });
        } else {
          setError($("rw-fetch-hint"), "没有抓到笔记正文，请打开「没有链接？直接把原文贴进来」，把正文粘进去再改写。不要假装已经改写成功。\n" + msg);
        }
      }
      if (jobs.length) runRewriteJobs(jobs);
    });
  }

  function submitImageRewrite(kind) {
    var isGoods = kind === "goods";
    var nameEl = $(isGoods ? "rw-goods-name" : "rw-img-name");
    var errName = $(isGoods ? "rw-goods-name-error" : "rw-img-name-error");
    var errUp = $(isGoods ? "rw-goods-error" : "rw-img-error");
    var files = isGoods ? state.rwGoodsFiles : state.rwImgFiles;
    var name = (nameEl.value || "").trim();
    setError(errName, "");
    if (!name) { setError(errName, "请填写商品名称"); nameEl.classList.add("is-invalid"); return; }
    nameEl.classList.remove("is-invalid");
    var url = (($(isGoods ? "rw-goods-url" : "rw-img-url").value) || "").trim();
    var cut = truncate(name + (url ? "\n链接：" + url : ""), MAX_CHARS);
    var job = {
      mode: isGoods ? "goods" : "img",
      modeLabel: isGoods ? "商品笔记" : "上传图片",
      productName: name,
      productUrl: url,
      text: cut.text,
      clipped: cut.clipped,
      images: files.slice()
    };
    setError(errUp, files.length ? "" : "未上传图片也可以只凭商品名称改写；有图时会结合画面信息。");
    runRewriteJobs([job]);
  }

  function saveActiveToPublish() {
    var w = state.rwWindows[state.rwActive];
    if (!w) return;
    syncActiveFromFields();
    if (!(w.title || w.body)) { toast("还没有可保存的内容"); return; }
    var note = {
      id: uid("note"),
      title: w.title || "未命名笔记",
      body: w.body || "",
      tags: (w.tags || []).slice(),
      status: "draft",
      source: "改写",
      mode: w.mode,
      createdAt: nowTs(),
      updatedAt: nowTs()
    };
    state.notes.unshift(note);
    persistNotes();
    w.saved = true;
    paintRwResult();
    toast("已保存到发布列表");
    renderPublish();
  }


  /* ---------------- Image generation ---------------- */
  function modelIs50ProFlash(id) {
    id = (id || "").toLowerCase();
    return /seedream-5-0-(pro|flash)/.test(id) || /seedream-5\.0-(pro|flash)/.test(id);
  }
  function modelSupportsSequential(id) {
    id = (id || "").toLowerCase();
    if (modelIs50ProFlash(id)) return false;
    return /seedream/.test(id);
  }
  function resolveSize(resLabel, model) {
    var notice = "";
    var size = resLabel;
    if (resLabel === "4K" && modelIs50ProFlash(model)) {
      size = "2K";
      notice = "当前生图模型不支持 4K，已降为 2K。";
    }
    return { size: size, notice: notice };
  }
  function ratioHint(ratio) {
    var map = { "1:1": "正方形 1:1", "3:4": "竖版 3:4", "4:3": "横版 4:3", "16:9": "宽屏横版 16:9", "9:16": "手机竖版 9:16" };
    return map[ratio] || ratio;
  }
  function updateGenButtons() {
    var on = !!( $("gen-prompt").value || "" ).trim();
    ["gen-optimize", "gen-submit"].forEach(function (id) {
      var b = $(id);
      b.disabled = !on;
      b.classList.toggle("is-disabled", !on);
    });
  }
  function setRef(file) {
    if (state.genRef && state.genRef.url) URL.revokeObjectURL(state.genRef.url);
    if (!file) { state.genRef = null; show($("gen-ref-area"), false); return; }
    var url = URL.createObjectURL(file);
    state.genRef = { file: file, url: url };
    var thumb = $("gen-ref-thumb");
    thumb.classList.add("has-img");
    thumb.innerHTML = "";
    var img = document.createElement("img");
    img.src = url; img.alt = "参考图";
    thumb.appendChild(img);
    show($("gen-ref-area"), true);
  }
  function applyTemplate(tpl, fromRestore) {
    if (!tpl) return;
    $("gen-prompt").value = tpl.prompt || "";
    updateGenButtons();
    qsa(".tpl[data-tpl-id]").forEach(function (el) {
      el.classList.toggle("is-on", el.getAttribute("data-tpl-id") === tpl.id);
    });
    state.tplStore.selectedId = tpl.id;
    persistTpl();
    if (tpl.refDataUrl && !state.genRef) {
      // 自定义模板可带参考图 dataURL
    }
    if (!fromRestore) {
      $("tpl-toast-text").textContent = "已选择「" + tpl.name + "」模板，自动填入对话框";
      show($("tpl-toast"), true);
    }
  }
  function renderCustomTemplates() {
    // 移除旧的自定义卡（保留内置 8 + 新建）
    qsa(".tpl[data-custom='1']").forEach(function (el) { el.remove(); });
    var grid = $("tpl-grid");
    var newBtn = $("tpl-new");
    (state.tplStore.custom || []).forEach(function (tpl) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tpl";
      btn.setAttribute("data-tpl-id", tpl.id);
      btn.setAttribute("data-custom", "1");
      btn.innerHTML = '<div class="tpl-thumb tpl-3"><span class="big">' + escapeHtml(tpl.name).slice(0, 8) + '</span><span class="small">我的模板</span></div><div class="tpl-name">' + escapeHtml(tpl.name) + "</div>";
      btn.addEventListener("click", function () { applyTemplate(tpl); });
      grid.insertBefore(btn, newBtn);
    });
    if (state.tplStore.selectedId) {
      var t = findTpl(state.tplStore.selectedId);
      if (t) applyTemplate(t, true);
    }
  }
  function sortTemplates() {
    var grid = $("tpl-grid");
    var cards = qsa(".tpl:not(.tpl-new)", grid);
    var order = state.tplStore.order === "name-desc" ? "name-asc" : "name-desc";
    state.tplStore.order = order;
    persistTpl();
    cards.sort(function (a, b) {
      var na = (qs(".tpl-name", a) || a).textContent.trim();
      var nb = (qs(".tpl-name", b) || b).textContent.trim();
      return order === "name-asc" ? na.localeCompare(nb, "zh") : nb.localeCompare(na, "zh");
    });
    cards.forEach(function (c) { grid.insertBefore(c, $("tpl-new")); });
    toast(order === "name-asc" ? "已按名称排序" : "已按名称倒序");
  }
  function openNewTemplate() {
    openModal("新建模板",
      '<div class="field-label">模板名称</div><input id="nt-name" class="field field-one" type="text" placeholder="给我的模板起个名字">' +
      '<div class="field-label" style="margin-top:10px">完整提示词</div><textarea id="nt-prompt" class="field" style="min-height:140px" placeholder="把你常用的描述完整写在这里"></textarea>',
      [
        { label: "保存", primary: true, onClick: function () {
            var name = (document.getElementById("nt-name") || {}).value || "";
            var prompt = (document.getElementById("nt-prompt") || {}).value || "";
            name = name.trim(); prompt = prompt.trim();
            if (!name || !prompt) { toast("名称和提示词都要填"); return; }
            var tpl = { id: uid("tpl"), name: name, prompt: prompt };
            state.tplStore.custom = state.tplStore.custom || [];
            state.tplStore.custom.push(tpl);
            persistTpl();
            renderCustomTemplates();
            applyTemplate(tpl);
            toast("模板已保存");
          } },
        { label: "取消" }
      ]);
    setTimeout(function () { var el = document.getElementById("nt-name"); if (el) el.focus(); }, 0);
  }

  function paintSession() {
    var s = state.session;
    show($("gen-session"), !!s);
    if (!s) return;
    $("ss-prompt").textContent = s.prompt;
    $("ss-id").textContent = s.id;
    $("ss-count").textContent = s.count + " 张";
    $("ss-ratio").textContent = s.ratio;
    $("ss-res").textContent = s.res + (s.sizeNotice ? "（" + s.sizeNotice + "）" : "");
    $("ss-status").textContent = s.status;
    $("ss-progress").textContent = s.done + " / " + s.count;
    $("ss-time").textContent = fmtTime(s.createdAt);
    $("ss-credit").textContent = "本地模式，无积分消耗";
    $("ss-gallery-note").textContent = "本次 " + s.images.length + " 张 · 标为基准的图用于后续对比 · 本地模式，无积分消耗";
    var box = $("ss-shots");
    box.innerHTML = "";
    s.images.forEach(function (img, i) {
      var shot = document.createElement("div");
      shot.className = "shot" + (i === state.sessionPick ? " is-picked" : "");
      shot.style.aspectRatio = s.ratio.replace(":", " / ");
      if (i === state.sessionBase) {
        var tag = document.createElement("span");
        tag.className = "base-tag"; tag.textContent = "当前基准";
        shot.appendChild(tag);
      }
      if (img.url) {
        var im = document.createElement("img");
        im.className = "shot-img"; im.src = img.url; im.alt = "生成图 " + (i + 1);
        shot.appendChild(im);
      } else {
        var ph = document.createElement("div");
        ph.className = "ph";
        ph.innerHTML = "<b>" + escapeHtml(img.error || "生成中") + "</b><i>" + s.ratio + " · " + s.res + "</i>";
        shot.appendChild(ph);
      }
      shot.addEventListener("click", function () { state.sessionPick = i; $("ss-pick").value = String(i); paintSession(); });
      box.appendChild(shot);
    });
    var pick = $("ss-pick");
    pick.innerHTML = "";
    s.images.forEach(function (_, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "第 " + (i + 1) + " 张";
      if (i === state.sessionPick) opt.selected = true;
      pick.appendChild(opt);
    });
  }
  function currentShot() {
    if (!state.session) return null;
    return state.session.images[state.sessionPick] || null;
  }
  async function generateImages(opts) {
    opts = opts || {};
    var prompt = ($("gen-prompt").value || "").trim();
    if (!prompt) { updateGenButtons(); return; }
    if (!needKeyOrExplain()) return;
    var ratio = $("gen-ratio").value;
    var res = $("gen-res").value;
    var count = state.genCount;
    var model = state.settings.imageModel || DEFAULT_IMAGE_MODEL;
    var sized = resolveSize(res, model);
    if (sized.notice) setError($("gen-error"), sized.notice);
    else setError($("gen-error"), "");
    var finalPrompt = prompt;
    if (finalPrompt.indexOf(ratio) < 0) finalPrompt += "。请按" + ratioHint(ratio) + "构图生成。";
    var session = {
      id: uid("img"),
      prompt: prompt,
      count: count,
      ratio: ratio,
      res: res,
      sizeUsed: sized.size,
      sizeNotice: sized.notice,
      status: "生成中",
      done: 0,
      createdAt: nowTs(),
      images: []
    };
    for (var i = 0; i < count; i++) session.images.push({ url: "", error: "" });
    state.session = session;
    state.sessionPick = 0;
    state.sessionBase = 0;
    paintSession();
    $("gen-session").scrollIntoView({ behavior: "smooth", block: "start" });

    var imageField = null;
    if (state.genRef) {
      imageField = await fileToDataUrl(state.genRef.file);
    }
    function oneRequest(n) {
      var body = {
        model: model,
        prompt: n > 1 ? (finalPrompt + " 请生成 " + n + " 张内容相关、互不相同的图。") : finalPrompt,
        size: sized.size,
        watermark: false,
        response_format: "url"
      };
      if (imageField) body.image = imageField;
      // 5.0 pro/flash 完全不支持 sequential_image_generation 字段：
      // 只要字段出现就报错，哪怕值是 "disabled"。单张请求也不需要组图。
      // 因此仅当「多张 + 模型支持组图」时才带该字段，其余情况整个字段不发
      // （不发即默认不启用组图，与 "disabled" 等价，且是 flash 唯一接受的形式）。
      // 5.0 pro/flash 的多张由下方外部循环逐张单图请求完成。
      if (n > 1 && modelSupportsSequential(model)) {
        body.sequential_image_generation = "auto";
        body.sequential_image_generation_options = { max_images: n };
      }
      return apiPost("/api/images", body).then(function (data) {
        var items = (data.data || []).map(function (it) {
          return { url: it.url || (it.b64_json ? ("data:image/png;base64," + it.b64_json) : ""), error: (it.error && it.error.message) || "" };
        }).filter(function (it) { return it.url || it.error; });
        return items;
      });
    }

    try {
      var items = [];
      if (count > 1 && !modelSupportsSequential(model)) {
        for (var k = 0; k < count; k++) {
          var part = await oneRequest(1);
          items = items.concat(part);
          session.done = items.length;
          paintSession();
        }
      } else {
        items = await oneRequest(count);
      }
      if (!items.length) throw new Error("接口没有返回图片");
      session.images = items.slice(0, count);
      while (session.images.length < count) session.images.push({ url: "", error: "未生成" });
      session.done = session.images.filter(function (x) { return x.url; }).length;
      session.status = session.done === session.count ? "全部完成" : (session.done ? "部分完成" : "失败");
      if (sized.notice) session.sizeNotice = sized.notice;
    } catch (err) {
      session.status = "失败";
      session.images = session.images.map(function (im) { return im.url ? im : { url: "", error: err.message || "生成失败" }; });
      setError($("gen-error"), err.message || "生成失败");
    }
    paintSession();
  }

  function downloadUrl(url, name) {
    if (!url) return;
    if (url.slice(0, 5) === "data:") {
      var a = document.createElement("a");
      a.href = url; a.download = name || "image.png";
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    // 走代理同源或直接打开
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      var u = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = u; a.download = name || "image.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    }).catch(function () {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.download = name || "image.jpg";
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  /* ---------------- Publish list ---------------- */
  var FILTER_TO_STATUS = {
    all: null,
    pending: "pending",
    generating: "generating",
    draft: "draft",
    copied: "copied",
    published: "published",
    failed: "failed"
  };
  var STATUS_LABEL = {
    pending: "待生成",
    generating: "生成中",
    draft: "生成完成",
    copied: "已复制",
    published: "已发布",
    failed: "失败"
  };
  // 筛选项「已同步飞书」映射本地「已复制」；「已生成二维码」映射「已发布」

  function noteMatches(n) {
    var want = FILTER_TO_STATUS[state.pubFilter];
    if (want && n.status !== want) return false;
    var q = (state.pubQuery || "").trim().toLowerCase();
    if (q) {
      var blob = (n.title + " " + (n.body || "") + " " + (n.tags || []).join(" ")).toLowerCase();
      if (blob.indexOf(q) < 0) return false;
    }
    return true;
  }
  function sortedNotes() {
    var list = state.notes.filter(noteMatches).slice();
    if (state.pubSort === "最近更新") list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    else if (state.pubSort === "标题首字") list.sort(function (a, b) { return (a.title || "").localeCompare(b.title || "", "zh"); });
    else list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list;
  }
  function countBy(status) {
    if (!status) return state.notes.length;
    return state.notes.filter(function (n) { return n.status === status; }).length;
  }
  function renderPublish() {
    qsa("#pub-filters .filter-btn").forEach(function (btn) {
      var f = btn.getAttribute("data-filter");
      btn.classList.toggle("is-on", f === state.pubFilter);
      var c = qs(".count", btn);
      if (c) c.textContent = String(countBy(FILTER_TO_STATUS[f]));
    });
    var list = sortedNotes();
    var box = $("pub-list");
    box.innerHTML = "";
    list.forEach(function (n) {
      var row = document.createElement("div");
      row.className = "card record";
      row.setAttribute("data-id", n.id);
      var check = state.pubBatch ? '<input class="rec-check" type="checkbox" data-id="' + n.id + '"' + (state.selected[n.id] ? " checked" : "") + ">" : '<span></span>';
      row.innerHTML =
        check +
        '<div><div class="rec-title"></div><div class="rec-sub"></div></div>' +
        '<div class="rec-time"></div>' +
        '<div><span class="chip"><i class="d"></i>' + escapeHtml(STATUS_LABEL[n.status] || n.status) + '</span></div>' +
        '<div class="rec-source"><span class="chip grey"></span></div>' +
        '<div class="rec-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="view">查看</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="copy">复制</button>' +
        '<button class="btn btn-quiet btn-sm" type="button" data-act="del">删除</button>' +
        "</div>";
      qs(".rec-title", row).textContent = n.title;
      qs(".rec-sub", row).textContent = (n.title || "").length + " 字 · " + ((n.tags || []).length) + " 个标签 · 来自「" + (n.source || "改写") + "」";
      qs(".rec-time", row).textContent = fmtShort(n.updatedAt || n.createdAt);
      qs(".rec-source .chip", row).textContent = n.source || "改写";
      if (qs(".rec-check", row)) {
        qs(".rec-check", row).addEventListener("change", function (e) {
          if (e.target.checked) state.selected[n.id] = true; else delete state.selected[n.id];
        });
      }
      qsa("[data-act]", row).forEach(function (b) {
        b.addEventListener("click", function () {
          var act = b.getAttribute("data-act");
          if (act === "view") viewNote(n);
          else if (act === "copy") copyNote(n);
          else if (act === "del") deleteNote(n.id);
        });
      });
      box.appendChild(row);
    });
    show($("pub-empty"), list.length === 0);
    if (list.length === 0) {
      qs("#pub-empty .empty-title").textContent = state.notes.length ? "没有符合筛选的笔记" : "这里还没有保存的笔记";
    }
    show($("pub-sample"), false);
    show($("pub-batch-del"), state.pubBatch);
  }
  function viewNote(n) {
    var tags = (n.tags || []).map(function (t) { return "#" + t; }).join(" ");
    openModal(n.title || "笔记",
      "<p style='white-space:pre-wrap'>" + escapeHtml(n.body || "") + "</p>" +
      "<p style='margin-top:10px;color:var(--ink-3)'>" + escapeHtml(tags) + "</p>" +
      "<p class='field-note'>状态：" + escapeHtml(STATUS_LABEL[n.status] || n.status) + " · 本地记录</p>",
      [
        { label: "复制标题", onClick: function () { copyText(n.title || ""); markCopied(n.id); } },
        { label: "复制正文", onClick: function () { copyText(n.body || ""); markCopied(n.id); } },
        { label: "复制标签", onClick: function () { copyText((n.tags || []).map(function (t) { return "#" + t; }).join(" ")); markCopied(n.id); } },
        { label: "标记已发布", onClick: function () { setNoteStatus(n.id, "published"); } },
        { label: "关闭", primary: true }
      ]);
  }
  function copyNote(n) {
    var text = (n.title || "") + "\n\n" + (n.body || "") + "\n\n" + (n.tags || []).map(function (t) { return "#" + t; }).join(" ");
    copyText(text);
    markCopied(n.id);
  }
  function markCopied(id) { setNoteStatus(id, "copied"); }
  function setNoteStatus(id, status) {
    state.notes.forEach(function (n) {
      if (n.id === id) { n.status = status; n.updatedAt = nowTs(); }
    });
    persistNotes();
    renderPublish();
  }
  function deleteNote(id) {
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    delete state.selected[id];
    persistNotes();
    renderPublish();
    toast("已删除");
  }

  /* ---------------- Extract ---------------- */
  function refreshExtractCookieTip() {
    var missing = ["xhs", "douyin", "weibo"].filter(function (p) { return !cookieForPlatform(p); });
    var txt = missing.length
      ? "未配置 " + missing.map(platformLabel).join(" / ") +
        " Cookie：对应平台链接不会发起请求；B站链接不需要 Cookie，可直接解析。可改用上传视频/音频文件转写。"
      : "已在本机保存小红书 / 抖音 / 微博 Cookie（B站不需要 Cookie），只用于尝试解析你提交的链接，不会上传到本工作台以外的服务器。失效后请到设置里更新。";
    $("ex-cookie-text").textContent = txt;
    return txt;
  }
  // 按当前粘贴的链接所属平台显示提示：B站不提示 Cookie，未配的平台点名提示。
  function updateExtractTipForText(raw) {
    var links = extractLinks(raw || "");
    if (!links.length) { refreshExtractCookieTip(); return; }
    var notes = [];
    var unsupported = 0;
    var seen = {};
    links.forEach(function (u) {
      var p = detectPlatform(u);
      if (!p) { unsupported++; return; }
      if (seen[p]) return;
      seen[p] = 1;
      if (!platformNeedsCookie(p)) notes.push("B站链接不需要 Cookie，可直接解析");
      else if (!cookieForPlatform(p)) notes.push("未配置" + platformLabel(p) + " Cookie，该链接不会发起请求");
      else notes.push(platformLabel(p) + " Cookie 已在本机保存");
    });
    if (unsupported) notes.push("有 " + unsupported + " 条链接的域名暂不支持");
    $("ex-cookie-text").textContent = notes.length ? notes.join("；") + "。" : refreshExtractCookieTip();
  }
  function renderExtractSide() {
    var box = $("ex-records");
    box.innerHTML = "";
    $("ex-count").textContent = String(state.extract.length);
    show($("ex-empty"), state.extract.length === 0);
    state.extract.forEach(function (rec) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "side-item" + (state.extractActive === rec.id ? " is-on" : "");
      b.innerHTML = "<b></b><span></span><span class='st " + (rec.status === "完成" ? "ok" : rec.status === "失败" ? "fail" : "") + "'><i class='d'></i>" + escapeHtml(rec.status) + "</span>";
      qs("b", b).textContent = rec.title || "提取任务";
      qs("span", b).textContent = fmtShort(rec.createdAt);
      b.addEventListener("click", function () { state.extractActive = rec.id; paintExtractResult(); renderExtractSide(); });
      box.appendChild(b);
    });
  }
  function paintExtractResult() {
    var rec = state.extract.filter(function (r) { return r.id === state.extractActive; })[0];
    if (!rec) { show($("ex-result"), false); return; }
    show($("ex-result"), true);
    $("ex-result-note").textContent = (rec.status || "") + (rec.engine ? " · " + rec.engine : "") + (rec.segments ? " · " + rec.segments.length + " 段" : "");
    var box = $("ex-segments");
    box.innerHTML = "";
    (rec.segments || []).forEach(function (seg) {
      var item = document.createElement("div");
      item.className = "seg-item";
      item.innerHTML = '<div class="seg-top"><span class="seg-no"></span><button class="btn btn-quiet" type="button">复制某段</button></div><p class="seg-text"></p>';
      qs(".seg-no", item).textContent = "第 " + String(seg.index).padStart(2, "0") + " 段";
      qs(".seg-text", item).textContent = seg.text;
      qs("button", item).addEventListener("click", function () { copyText(seg.text); });
      box.appendChild(item);
    });
    if (rec.error && !(rec.segments && rec.segments.length)) {
      var p = document.createElement("p");
      p.className = "field-error"; p.textContent = rec.error;
      box.appendChild(p);
    }
  }
  function addExtractRecord(partial) {
    var rec = Object.assign({
      id: uid("ex"),
      title: "提取任务",
      status: "排队中",
      segments: [],
      text: "",
      error: "",
      engine: "",
      createdAt: nowTs()
    }, partial);
    state.extract.unshift(rec);
    persistExtract();
    state.extractActive = rec.id;
    renderExtractSide();
    paintExtractResult();
    return rec;
  }
  function updateExtract(rec) {
    rec.updatedAt = nowTs();
    persistExtract();
    renderExtractSide();
    paintExtractResult();
  }
  function submitExtractLinks() {
    setError($("ex-error"), "");
    var raw = ($("ex-links").value || "").trim();
    if (!raw) { setError($("ex-error"), "请先粘贴链接，每行一条；或改用下方上传文件转写。"); return; }
    var lines = raw.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    updateExtractTipForText(raw);
    lines.forEach(function (line) {
      var links = extractLinks(line);
      if (!links.length) {
        var emptyRec = addExtractRecord({ title: line.slice(0, 24), status: "失败", source: line });
        emptyRec.error = "这一行里没有识别到链接，未假装提取成功。";
        updateExtract(emptyRec);
        return;
      }
      // 每行可含多条链接，逐条处理（覆盖四平台）。
      links.forEach(function (url) {
        var platform = detectPlatform(url);
        var rec = addExtractRecord({
          title: url, status: "提取中", source: line, platform: platform, sourceUrl: url
        });
        if (!platform) {
          rec.status = "失败";
          rec.error = "暂不支持该链接（域名 " + (urlHost(url) || "未知") +
            "）。目前支持抖音 / 小红书 / B站 / 微博，未假装提取成功。";
          updateExtract(rec);
          return;
        }
        var cookie = cookieForPlatform(platform);
        // 按平台门控：需要 Cookie 却没配时，明确点名平台，且完全不发请求。
        if (platformNeedsCookie(platform) && !cookie) {
          rec.status = "失败";
          rec.error = missingCookieMessage(platform);
          updateExtract(rec);
          return;
        }
        apiPost("/api/fetch-note", { url: url, platform: platform, cookie: cookie }).then(function (res) {
          rec.platform = (res && res.platform) || platform;
          rec.contentId = (res && res.contentId) || "";
          rec.realUrl = (res && res.realUrl) || "";
          rec.finalUrl = (res && res.finalUrl) || "";
          if (res && res.ok && res.text) {
            rec.status = "完成";
            rec.title = res.title || rec.title;
            rec.text = res.text;
            rec.segments = splitText(res.text);
            rec.engine = "链接解析";
          } else {
            rec.status = "失败";
            rec.error = (res && res.error) || "链接未能解析出文案，请改用上传视频/音频文件转写。";
          }
          updateExtract(rec);
        }).catch(function (err) {
          rec.status = "失败";
          rec.error = err.message || "解析失败";
          updateExtract(rec);
        });
      });
    });
  }
  function splitText(text) {
    var parts = String(text || "").split(/\n\s*\n|(?<=[。！？!?])\s+/);
    var segs = parts.map(function (s) { return s.trim(); }).filter(Boolean);
    if (!segs.length && text) segs = [String(text).trim()];
    return segs.map(function (t, i) { return { index: i + 1, text: t }; });
  }
  function transcribeFile(file) {
    if (!file) return;
    var rec = addExtractRecord({ title: file.name, status: "转写中", source: "file" });
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result || "";
      var base64 = String(dataUrl).split(",")[1] || "";
      apiPost("/api/transcribe", { filename: file.name, mime: file.type, data: base64 }).then(function (res) {
        if (res && res.ok) {
          rec.status = "完成";
          rec.text = res.text || "";
          rec.segments = res.segments && res.segments.length ? res.segments : splitText(rec.text);
          rec.engine = res.engine || "本地转写";
        } else {
          rec.status = "失败";
          rec.error = (res && res.error) || "转写失败";
          offerSpeechFallback(rec);
        }
        updateExtract(rec);
      }).catch(function (err) {
        rec.status = "失败";
        rec.error = err.message || "转写失败（若未启动本地代理，请先运行 python3 server.py）。也可改用浏览器语音识别。";
        updateExtract(rec);
        offerSpeechFallback(rec);
      });
    };
    reader.readAsDataURL(file);
  }
  function offerSpeechFallback(rec) {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return;
    openModal("改用浏览器语音识别？",
      "<p>本地免费语音转写引擎不可用。可以用浏览器自带的 Web Speech 识别：请播放这段音视频，或对着麦克风口述，识别结果会写进当前记录。</p>",
      [
        { label: "开始识别", primary: true, onClick: function () { startWebSpeech(rec); } },
        { label: "取消" }
      ]);
  }
  function startWebSpeech(rec) {
    var Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recog) { toast("当前浏览器不支持 Web Speech"); return; }
    var r = new Recog();
    r.lang = "zh-CN"; r.continuous = true; r.interimResults = true;
    var buf = "";
    r.onresult = function (ev) {
      var t = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      buf = t;
    };
    r.onerror = function (e) {
      rec.error = "浏览器语音识别失败：" + (e.error || "unknown");
      rec.status = "失败";
      updateExtract(rec);
    };
    r.onend = function () {
      if (buf.trim()) {
        rec.status = "完成";
        rec.engine = "Web Speech";
        rec.text = (rec.text ? rec.text + "\n" : "") + buf.trim();
        rec.segments = splitText(rec.text);
        rec.error = "";
        updateExtract(rec);
        toast("语音识别已写入记录");
      }
    };
    r.start();
    toast("正在听，说完后稍等片刻");
    setTimeout(function () { try { r.stop(); } catch (e) {} }, 30000);
  }

  /* ---------------- Product ---------------- */
  function cleanupProduct() {
    var cut = nowTs() - THIRTY_DAYS;
    var before = state.product.length;
    state.product = state.product.filter(function (j) { return (j.createdAt || 0) >= cut; });
    if (state.product.length !== before) persistProduct();
  }
  function renderProductSide() {
    cleanupProduct();
    var box = $("pd-records");
    box.innerHTML = "";
    $("pd-count").textContent = String(state.product.length);
    show($("pd-empty"), state.product.length === 0);
    state.product.forEach(function (job) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "side-item" + (state.productActive === job.id ? " is-on" : "");
      b.innerHTML = "<b></b><span></span>";
      qs("b", b).textContent = job.keyword || "采集任务";
      qs("span", b).textContent = fmtShort(job.createdAt) + " · " + (job.rows ? job.rows.length : 0) + " 条 · 到期自动清理";
      b.addEventListener("click", function () { state.productActive = job.id; paintProductResult(); renderProductSide(); });
      box.appendChild(b);
    });
  }
  function paintProductResult() {
    var job = state.product.filter(function (j) { return j.id === state.productActive; })[0];
    var tbody = qs("#pd-table tbody");
    tbody.innerHTML = "";
    $("pd-kw-downloads").innerHTML = "";
    if (!job) {
      $("pd-result-note").textContent = "尚未采集";
      $("pd-sum-kw").textContent = "0";
      $("pd-sum-ok").textContent = "0";
      $("pd-sum-fail").textContent = "0";
      return;
    }
    var ok = 0, fail = 0;
    var kws = {};
    (job.rows || []).forEach(function (row) {
      kws[row.keyword || job.keyword || ""] = 1;
      if (row.status === "成功") ok++; else fail++;
      var tr = document.createElement("tr");
      if (row.status !== "成功") tr.className = "row-fail";
      var cells = [
        row.keyword || "",
        row.title || "",
        row.url || "",
        row.price || "—",
        row.sales || "—",
        row.shop || "—",
        row.fans || "—",
        row.shopSales || "—",
        row.ratio || "—",
        row.status || "失败",
        row.reason || "",
        row.url || ""
      ];
      cells.forEach(function (val, i) {
        var td = document.createElement("td");
        if (i === 1) td.className = "title-cell";
        if ([3, 4, 6, 7, 8].indexOf(i) >= 0) td.className = "num";
        if (i === 2 && val && val !== "—") {
          var a = document.createElement("a"); a.href = val; a.target = "_blank"; a.rel = "noopener"; a.textContent = "商品页";
          td.appendChild(a);
        } else if (i === 9) {
          var st = document.createElement("span");
          st.className = "st " + (val === "成功" ? "ok" : "fail");
          st.innerHTML = "<i class='d'></i>" + escapeHtml(val);
          td.appendChild(st);
        } else if (i === 11) {
          if (row.url) {
            var a2 = document.createElement("a"); a2.href = row.url; a2.target = "_blank"; a2.rel = "noopener"; a2.textContent = "查看";
            td.appendChild(a2);
          } else td.textContent = "—";
        } else {
          td.textContent = val || "—";
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    $("pd-result-note").textContent = (job.note || ("记录保留 30 天 · " + (job.rows || []).length + " 条"));
    $("pd-sum-kw").textContent = String(Object.keys(kws).length || (job.keyword ? 1 : 0));
    $("pd-sum-ok").textContent = String(ok);
    $("pd-sum-fail").textContent = String(fail);
    Object.keys(kws).forEach(function (kw) {
      if (!kw) return;
      var btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-sm"; btn.type = "button";
      btn.textContent = kw + " · 下载";
      btn.addEventListener("click", function () { exportJobExcel(job, kw); });
      $("pd-kw-downloads").appendChild(btn);
    });
  }
  function updateQtyBadge() {
    var n = parseInt($("pd-qty").value, 10) || 0;
    $("pd-badge").textContent = "预计采集 " + n + " 条";
    qsa(".quick-btn[data-qty]").forEach(function (b) {
      b.classList.toggle("is-on", String(n) === b.getAttribute("data-qty"));
    });
  }
  function updatePdSubmit() {
    var on = !!($("pd-keyword").value || "").trim() || !!($("pd-paste").value || "").trim();
    $("pd-submit").disabled = !on;
    $("pd-submit").classList.toggle("is-disabled", !on);
  }
  function startProductJob() {
    setError($("pd-error"), "");
    var keyword = ($("pd-keyword").value || "").trim();
    var paste = ($("pd-paste").value || "").trim();
    var qty = parseInt($("pd-qty").value, 10) || 100;
    if (!keyword && !paste) { updatePdSubmit(); return; }
    var rows = paste ? parsePastedProducts(paste, keyword, qty) : [];
    var job = {
      id: uid("pd"),
      keyword: keyword || "导入整理",
      qty: qty,
      createdAt: nowTs(),
      rows: rows,
      note: ""
    };
    if (!rows.length) {
      // 无免费搜索接口：如实记一条失败，不编造商品
      job.rows = [{
        keyword: keyword,
        title: "",
        url: "",
        price: "—",
        sales: "—",
        shop: "—",
        fans: "—",
        shopSales: "—",
        ratio: "—",
        status: "失败",
        reason: "未找到可用的免费商品搜索接口。本工具不会假装采到数据。请在下方粘贴商品链接或导入表格后，再点「开始采集」。"
      }];
      job.note = "已按失败如实记录。记录保留 30 天，超时自动清理。";
    } else {
      job.note = "来自粘贴/导入整理，不是在线搜索结果。记录保留 30 天，超时自动清理。";
    }
    state.product.unshift(job);
    persistProduct();
    state.productActive = job.id;
    renderProductSide();
    paintProductResult();
    toast(rows.length ? "已整理 " + rows.length + " 条" : "没有采到数据，原因已写入结果表");
  }
  function parsePastedProducts(text, keyword, qty) {
    var lines = text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var rows = [];
    lines.slice(0, qty).forEach(function (line) {
      var parts = line.split(/\s*\|\s*/);
      var urlMatch = line.match(/https?:\/\/\S+/);
      var row = emptyRow(keyword);
      if (parts.length >= 2) {
        row.title = parts[0];
        row.url = parts[1] || "";
        row.price = parts[2] || "—";
        row.sales = parts[3] || "—";
        row.shop = parts[4] || "—";
        row.fans = parts[5] || "—";
        row.shopSales = parts[6] || "—";
      } else if (urlMatch) {
        row.url = urlMatch[0];
        row.title = line.replace(urlMatch[0], "").trim();
      } else {
        row.title = line;
      }
      completeRow(row);
      rows.push(row);
    });
    return rows;
  }
  function emptyRow(keyword) {
    return { keyword: keyword || "", title: "", url: "", price: "—", sales: "—", shop: "—", fans: "—", shopSales: "—", ratio: "—", status: "失败", reason: "" };
  }
  function completeRow(row) {
    row.ratio = fanSaleRatio(row.fans, row.shopSales);
    var hasCore = !!(row.title || row.url);
    if (!hasCore) {
      row.status = "失败";
      row.reason = row.reason || "缺少商品标题或链接";
    } else {
      row.status = "成功";
      row.reason = row.reason || "";
    }
  }
  function fanSaleRatio(fans, sales) {
    var f = parseNumber(fans), s = parseNumber(sales);
    if (!f || !s) return "—";
    return (s / f).toFixed(2);
  }
  function parseNumber(v) {
    if (v == null) return 0;
    var s = String(v).replace(/,/g, "").trim();
    var m = s.match(/([\d.]+)\s*万/);
    if (m) return parseFloat(m[1]) * 10000;
    var n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isFinite(n) ? n : 0;
  }
  var COL_ALIASES = {
    keyword: ["关键词", "关键字", "keyword"],
    title: ["商品标题", "标题", "商品名称", "title", "name"],
    url: ["商品链接", "链接", "url", "link"],
    price: ["价格", "price"],
    sales: ["商品销量", "销量", "sales"],
    shop: ["店铺名称", "店铺", "shop"],
    fans: ["店铺粉丝数", "粉丝", "fans"],
    shopSales: ["店铺累计销量", "累计销量", "shop_sales"],
    status: ["采集状态", "状态", "status"],
    reason: ["失败原因", "原因", "reason"]
  };
  function mapHeader(h) {
    h = String(h || "").trim().toLowerCase();
    for (var k in COL_ALIASES) {
      if (COL_ALIASES[k].some(function (a) { return a.toLowerCase() === h; })) return k;
    }
    return null;
  }
  function rowsFromTable(table, keyword) {
    if (!table || !table.length) return [];
    var header = table[0].map(function (x) { return String(x || "").trim(); });
    var mapped = header.map(mapHeader);
    var hasHeader = mapped.filter(Boolean).length >= 2;
    var start = hasHeader ? 1 : 0;
    var out = [];
    for (var i = start; i < table.length; i++) {
      var cells = table[i];
      var row = emptyRow(keyword);
      if (hasHeader) {
        mapped.forEach(function (key, idx) {
          if (key && cells[idx] != null) row[key] = String(cells[idx]).trim();
        });
      } else {
        row.title = cells[0] || "";
        row.url = cells[1] || "";
        row.price = cells[2] || "—";
        row.sales = cells[3] || "—";
        row.shop = cells[4] || "—";
      }
      if (!row.keyword) row.keyword = keyword || "";
      completeRow(row);
      if (row.title || row.url) out.push(row);
    }
    return out;
  }
  function importProductTable(file) {
    if (!file) return;
    var name = file.name || "import";
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      if (/\.xlsx$/i.test(name)) {
        var b64 = arrayBufferToBase64(buf);
        apiPost("/api/parse-table", { filename: name, data: b64 }).then(function (res) {
          if (!res.ok) { setError($("pd-error"), res.error || "导入失败"); return; }
          applyImportedRows(rowsFromTable(res.rows, ($("pd-keyword").value || "").trim()));
        }).catch(function (err) {
          setError($("pd-error"), err.message || "导入 Excel 需要先启动 python3 server.py；也可另存为 CSV 在本地导入。");
        });
      } else {
        var text = typeof buf === "string" ? buf : new TextDecoder("utf-8").decode(buf);
        var table = parseCsv(text);
        applyImportedRows(rowsFromTable(table, ($("pd-keyword").value || "").trim()));
      }
    };
    if (/\.xlsx$/i.test(name)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }
  function applyImportedRows(rows) {
    if (!rows.length) { setError($("pd-error"), "表格里没有读到商品行"); return; }
    var job = {
      id: uid("pd"),
      keyword: ($("pd-keyword").value || "").trim() || "导入整理",
      qty: rows.length,
      createdAt: nowTs(),
      rows: rows,
      note: "来自导入表格整理。记录保留 30 天，超时自动清理。"
    };
    state.product.unshift(job);
    persistProduct();
    state.productActive = job.id;
    renderProductSide();
    paintProductResult();
    toast("已导入 " + rows.length + " 条");
  }
  function parseCsv(text) {
    var rows = [], row = [], cur = "", inQ = false;
    text = text.replace(/^\ufeff/, "");
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === "," || ch === "\t" || ch === ";") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch !== "\r") cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  }
  function arrayBufferToBase64(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  var XLSX_HEADERS = ["关键词","商品标题","商品链接","价格","商品销量","店铺名称","店铺粉丝数","店铺累计销量","店铺粉销比","采集状态","失败原因","查看"];
  function jobToMatrix(job, onlyKw) {
    var rows = [["关键词","商品标题","商品链接","价格","商品销量","店铺名称","店铺粉丝数","店铺累计销量","店铺粉销比","采集状态","失败原因","查看"]];
    (job.rows || []).forEach(function (r) {
      if (onlyKw && (r.keyword || job.keyword) !== onlyKw) return;
      rows.push([r.keyword || job.keyword || "", r.title || "", r.url || "", r.price || "", r.sales || "", r.shop || "", r.fans || "", r.shopSales || "", r.ratio || "", r.status || "", r.reason || "", r.url || ""]);
    });
    return rows;
  }
  function exportJobExcel(job, onlyKw) {
    var rows = jobToMatrix(job, onlyKw);
    var name = "商品采集-" + (onlyKw || job.keyword || "全部") + ".xlsx";
    downloadXlsx(rows, name);
  }
  function downloadXlsx(rows, filename) {
    var sheet = buildSheetXml(rows);
    var files = {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
      "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="采集结果" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>",
      "xl/worksheets/sheet1.xml": sheet
    };
    var blob = zipStore(files);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "export.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function buildSheetXml(rows) {
    var out = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach(function (row, r) {
      out += '<row r="' + (r + 1) + '">';
      row.forEach(function (val, c) {
        var ref = colName(c) + (r + 1);
        var v = escapeXml(String(val == null ? "" : val));
        out += '<c r="' + ref + '" t="inlineStr"><is><t>' + v + "</t></is></c>";
      });
      out += "</row>";
    });
    return out + "</sheetData></worksheet>";
  }
  function colName(i) {
    var s = "";
    i += 1;
    while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function zipStore(files) {
    function u32(n) { return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]); }
    function u16(n) { return new Uint8Array([n & 255, (n >> 8) & 255]); }
    function enc(s) { return new TextEncoder().encode(s); }
    var parts = [], central = [], offset = 0, count = 0;
    Object.keys(files).forEach(function (name) {
      var data = enc(files[name]);
      var n = enc(name);
      var crc = crc32(data);
      var local = concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(n.length), u16(0), n, data);
      parts.push(local);
      var cen = concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n);
      central.push(cen);
      offset += local.length;
      count++;
    });
    var cenBlob = concat.apply(null, central);
    var end = concat(u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(cenBlob.length), u32(offset), u16(0));
    return new Blob([concat.apply(null, parts.concat([cenBlob, end]))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function concat() {
    var args = Array.prototype.slice.call(arguments);
    var len = 0; args.forEach(function (a) { len += a.length; });
    var out = new Uint8Array(len), o = 0;
    args.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function crc32(buf) {
    var table = crc32.t || (crc32.t = (function () {
      var t = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
      }
      return t;
    })());
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 255];
    return (crc ^ (-1)) >>> 0;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------------- Bind events ---------------- */
  function bind() {
    bindUpload("rw-img-upload", "rw-img-file", "rw-img-list", "rw-img-error", "img");
    bindUpload("rw-goods-upload", "rw-goods-file", "rw-goods-list", "rw-goods-error", "goods");
    $("rw-link-submit").addEventListener("click", submitLinkRewrite);
    $("rw-img-submit").addEventListener("click", function () { submitImageRewrite("img"); });
    $("rw-goods-submit").addEventListener("click", function () { submitImageRewrite("goods"); });
    $("rw-title").addEventListener("input", syncActiveFromFields);
    $("rw-body").addEventListener("input", syncActiveFromFields);
    $("rw-regen").addEventListener("click", function () {
      var w = state.rwWindows[state.rwActive];
      if (!w) return;
      if (!needKeyOrExplain()) return;
      rewriteOne(w, { mode: w.mode, modeLabel: "重新生成", text: w.rawInput || (w.title + "\n" + w.body), images: [] });
    });
    $("rw-copy-title").addEventListener("click", function () { copyText($("rw-title").value); });
    $("rw-copy-body").addEventListener("click", function () { copyText($("rw-body").value); });
    $("rw-copy-tags").addEventListener("click", function () {
      var w = state.rwWindows[state.rwActive];
      copyText(((w && w.tags) || []).map(function (t) { return "#" + t; }).join(" "));
    });
    $("rw-save").addEventListener("click", saveActiveToPublish);

    $("gen-prompt").addEventListener("input", updateGenButtons);
    qsa("[data-count]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.genCount = parseInt(b.getAttribute("data-count"), 10);
        qsa("[data-count]").forEach(function (x) { x.classList.toggle("is-on", x === b); });
      });
    });
    $("gen-ref-btn").addEventListener("click", function () { $("gen-ref-file").click(); });
    $("gen-ref-file").addEventListener("change", function () {
      var f = $("gen-ref-file").files && $("gen-ref-file").files[0];
      if (!f) return;
      if (f.size > MAX_BYTES) { setError($("gen-error"), "参考图不能超过 10MB"); return; }
      setRef(f);
      $("gen-ref-file").value = "";
    });
    $("gen-ref-del").addEventListener("click", function () { setRef(null); });
    $("gen-ref-view").addEventListener("click", function () { if (state.genRef) openLightbox(state.genRef.url); });
    $("gen-optimize").addEventListener("click", function () {
      var p = ($("gen-prompt").value || "").trim();
      if (!p || !needKeyOrExplain()) return;
      $("gen-optimize").disabled = true;
      chat([
        { role: "system", content: "你是提示词优化助手。把用户的生图描述写得更具体、可画，保留原意，不要改变主体。只输出优化后的提示词正文，不要解释。" },
        { role: "user", content: p }
      ]).then(function (res) {
        $("gen-prompt").value = (res.text || p).trim();
        updateGenButtons();
        toast("已优化提示词");
      }).catch(function (err) {
        setError($("gen-error"), err.message || "优化失败");
      }).then(function () { updateGenButtons(); });
    });
    $("gen-submit").addEventListener("click", function () { generateImages(); });
    $("tpl-toast-close").addEventListener("click", function () { show($("tpl-toast"), false); });
    $("tpl-sort").addEventListener("click", sortTemplates);
    $("tpl-new").addEventListener("click", openNewTemplate);
    qsa(".tpl[data-tpl-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tpl = findTpl(btn.getAttribute("data-tpl-id"));
        applyTemplate(tpl);
      });
    });
    $("ss-view").addEventListener("click", function () { var s = currentShot(); if (s && s.url) openLightbox(s.url); });
    $("ss-regen").addEventListener("click", function () { generateImages({ again: true }); });
    $("ss-unbase").addEventListener("click", function () { state.sessionBase = -1; paintSession(); });
    $("ss-download").addEventListener("click", function () {
      var s = currentShot(); if (s && s.url) downloadUrl(s.url, (state.session && state.session.id || "img") + "-" + (state.sessionPick + 1) + ".jpg");
    });
    $("ss-select").addEventListener("click", function () { paintSession(); toast("已选中第 " + (state.sessionPick + 1) + " 张"); });
    $("ss-pick").addEventListener("change", function () { state.sessionPick = parseInt($("ss-pick").value, 10) || 0; paintSession(); });

    qsa("#pub-filters .filter-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { state.pubFilter = btn.getAttribute("data-filter"); renderPublish(); });
    });
    $("pub-search").addEventListener("input", function () { state.pubQuery = $("pub-search").value; renderPublish(); });
    $("pub-sort").addEventListener("change", function () { state.pubSort = $("pub-sort").value; renderPublish(); });
    $("pub-batch").addEventListener("click", function () {
      state.pubBatch = !state.pubBatch;
      if (!state.pubBatch) state.selected = {};
      $("pub-batch").textContent = state.pubBatch ? "取消批量" : "批量选择";
      renderPublish();
    });
    $("pub-batch-del").addEventListener("click", function () {
      var ids = Object.keys(state.selected);
      if (!ids.length) { toast("还没有勾选"); return; }
      state.notes = state.notes.filter(function (n) { return !state.selected[n.id]; });
      state.selected = {};
      persistNotes();
      renderPublish();
      toast("已删除所选");
    });

    $("ex-submit").addEventListener("click", submitExtractLinks);
    $("ex-links").addEventListener("input", function () { updateExtractTipForText($("ex-links").value || ""); });
    $("ex-new").addEventListener("click", function () {
      $("ex-links").value = "";
      state.extractActive = null;
      show($("ex-result"), false);
      $("ex-links").focus();
    });
    $("ex-file-btn").addEventListener("click", function () { $("ex-file").click(); });
    $("ex-file").addEventListener("change", function () {
      var f = $("ex-file").files && $("ex-file").files[0];
      if (f) transcribeFile(f);
      $("ex-file").value = "";
    });
    $("ex-copy-all").addEventListener("click", function () {
      var rec = state.extract.filter(function (r) { return r.id === state.extractActive; })[0];
      if (rec) copyText(rec.text || (rec.segments || []).map(function (s) { return s.text; }).join("\n\n"));
    });

    $("pd-keyword").addEventListener("input", updatePdSubmit);
    $("pd-paste").addEventListener("input", updatePdSubmit);
    $("pd-qty").addEventListener("input", updateQtyBadge);
    qsa(".quick-btn[data-qty]").forEach(function (b) {
      b.addEventListener("click", function () {
        $("pd-qty").value = b.getAttribute("data-qty");
        updateQtyBadge();
      });
    });
    $("pd-submit").addEventListener("click", startProductJob);
    $("pd-new").addEventListener("click", function () {
      $("pd-keyword").value = ""; $("pd-paste").value = ""; state.productActive = null;
      updatePdSubmit(); paintProductResult(); $("pd-keyword").focus();
    });
    $("pd-import-btn").addEventListener("click", function () { $("pd-import-file").click(); });
    $("pd-import-file").addEventListener("change", function () {
      var f = $("pd-import-file").files && $("pd-import-file").files[0];
      if (f) importProductTable(f);
      $("pd-import-file").value = "";
    });
    $("pd-download").addEventListener("click", function () {
      var job = state.product.filter(function (j) { return j.id === state.productActive; })[0];
      if (!job) { toast("还没有可下载的结果"); return; }
      exportJobExcel(job);
    });

    $("set-save").addEventListener("click", saveSettingsFromForm);
    $("modal-close").addEventListener("click", closeModal);
    $("modal-root").addEventListener("click", function (e) { if (e.target.id === "modal-root") closeModal(); });
    $("lightbox-close").addEventListener("click", closeLightbox);
    $("lightbox").addEventListener("click", function (e) { if (e.target.id === "lightbox") closeLightbox(); });
  }

  function init() {
    fillSettingsForm();
    updateGenButtons();
    updateQtyBadge();
    updatePdSubmit();
    refreshExtractCookieTip();
    renderCustomTemplates();
    renderPublish();
    renderExtractSide();
    paintExtractResult();
    renderProductSide();
    paintProductResult();
    show($("rw-result"), false);
    show($("gen-session"), false);
    show($("gen-ref-area"), false);
    bind();
  }

  window.Workbench = {
    state: state,
    goTab: goTab,
    extractLinks: extractLinks,
    urlHost: urlHost,
    detectPlatform: detectPlatform,
    platformLabel: platformLabel,
    platformNeedsCookie: platformNeedsCookie,
    cookieForPlatform: cookieForPlatform,
    missingCookieMessage: missingCookieMessage,
    refreshExtractCookieTip: refreshExtractCookieTip,
    updateExtractTipForText: updateExtractTipForText,
    submitExtractLinks: submitExtractLinks,
    fillSettingsForm: fillSettingsForm,
    saveSettingsFromForm: saveSettingsFromForm,
    applyTemplate: applyTemplate,
    allTemplates: allTemplates,
    renderPublish: renderPublish,
    saveActiveToPublish: saveActiveToPublish,
    addExtractRecord: addExtractRecord,
    startProductJob: startProductJob,
    parsePastedProducts: parsePastedProducts,
    jobToMatrix: jobToMatrix,
    downloadXlsx: downloadXlsx,
    splitText: splitText,
    cleanupProduct: cleanupProduct,
    setNoteStatus: setNoteStatus
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
