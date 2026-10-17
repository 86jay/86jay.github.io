/* links — the engine. Plain JavaScript, no libraries, no build step.
   View mode: reads content.json and shows the links. Nothing else.
   Edit mode: open the page with #edit at the end of the address. */
"use strict";
(function () {

  /* ---------- Settings (the only things you might ever change) ---------- */
  var API = "https://api.github.com";
  var API_VERSION = "2026-03-10";          // GitHub REST API version. Bump only if the editor says "410".
  var RECENT_MINUTES = 10;                 // After you save, YOUR device shows the new version right away for this long.
  var TOKEN_RE = /(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/;

  var K = {
    token: "lk.token",
    savedAt: "lk.tokenSavedAt",
    expires: "lk.tokenExpires",
    draft: "lk.draft",
    recent: "lk.recent"
  };

  /* ---------- Small helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var host = location.hostname;
  var isLocal = location.protocol === "file:" || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "";

  function el(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
    }
    return e;
  }

  function store(area, key, val) {
    try { if (val === null || val === undefined) area.removeItem(key); else area.setItem(key, val); } catch (e) { /* private mode */ }
  }
  function read(area, key) { try { return area.getItem(key); } catch (e) { return null; } }
  var LS = (function () { try { return window.localStorage; } catch (e) { return null; } })();
  var SS = (function () { try { return window.sessionStorage; } catch (e) { return null; } })();
  function lsSet(k, v) { if (LS) store(LS, k, v); }
  function lsGet(k) { return LS ? read(LS, k) : null; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function str(v, fallback) { return typeof v === "string" ? v : (fallback || ""); }

  /* ---------- Content ---------- */
  function normalize(raw) {
    var d = raw && typeof raw === "object" ? raw : {};
    var out = {
      schemaVersion: 1,
      title: str(d.title, "links").slice(0, 60),
      mark: str(d.mark, "").slice(0, 12),
      site: {
        owner: str(d.site && d.site.owner),
        repo: str(d.site && d.site.repo),
        branch: str(d.site && d.site.branch, "main") || "main"
      },
      groups: []
    };
    if (Array.isArray(d.groups)) d.groups.forEach(function (g) {
      if (!g || typeof g !== "object") return;
      out.groups.push({
        label: str(g.label, "links").slice(0, 30),
        links: (Array.isArray(g.links) ? g.links : [])
          .filter(function (l) { return l && typeof l === "object"; })
          .map(function (l) { return { name: str(l.name).slice(0, 80), url: str(l.url) }; })
      });
    });
    return out;
  }

  function serialize(d) { return JSON.stringify(d, null, 2) + "\n"; }

  // Only https:// and mailto: links are ever shown or saved.
  function safeUrl(u) {
    try {
      var x = new URL(u);
      if (x.protocol === "https:" || x.protocol === "mailto:") return x.href;
    } catch (e) { /* invalid */ }
    return null;
  }

  // What the person types -> a clean link, or null.
  function cleanUrl(input) {
    var s = (input || "").trim();
    if (!s) return null;
    s = s.replace(/^http:\/\//i, "https://");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      s = (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(s) ? "mailto:" : "https://") + s;
    }
    return safeUrl(s);
  }

  // "https://www.letterboxd.com/ab/" -> "letterboxd.com/ab"
  function address(u) {
    try {
      var x = new URL(u);
      if (x.protocol === "mailto:") return decodeURIComponent(x.pathname);
      var p = x.pathname.replace(/\/+$/, "");
      try { p = decodeURI(p); } catch (e) { /* keep encoded */ }
      return x.hostname.replace(/^www\./, "") + p;
    } catch (e) { return u; }
  }

  function fetchContent() {
    return fetch("content.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("content.json " + r.status);
      return r.json();
    }).then(normalize);
  }

  function arrow() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "arrow");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M7 17L17 7M8.5 7H17v8.5");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.8");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
    return svg;
  }

  function setMark(d) {
    $("mark").textContent = d.mark;
    document.title = d.title || "links";
  }

  /* =====================================================================
     VIEW MODE — what every visitor sees. No GitHub API, no token.
     ===================================================================== */
  function renderView(d) {
    document.body.classList.remove("editing");
    $("bar").hidden = true;
    setMark(d);
    var list = $("list");
    list.replaceChildren();
    d.groups.forEach(function (g) {
      var links = g.links.filter(function (l) { return safeUrl(l.url); });
      if (!links.length) return;
      var ul = el("ul", { class: "rows" });
      links.forEach(function (l) {
        var href = safeUrl(l.url);
        ul.append(el("li", null,
          el("a", { class: "row", href: href, rel: "noopener noreferrer" },
            el("span", { class: "text" },
              el("span", { class: "name", text: l.name || address(href) }),
              el("span", { class: "addr", text: address(href) })),
            arrow())));
      });
      list.append(el("section", { class: "group" }, el("h2", { class: "label", text: g.label }), ul));
    });
  }

  function startView() {
    mode = "view";
    closeDialog();
    return fetchContent().then(function (d) {
      // Right after you save, your own device shows the new version
      // while GitHub Pages is still publishing (about 1 minute).
      var recent = null;
      try { recent = JSON.parse(lsGet(K.recent) || "null"); } catch (e) { recent = null; }
      if (recent) {
        var fresh = Date.now() - recent.at < RECENT_MINUTES * 60000;
        if (fresh && recent.json !== serialize(d)) d = normalize(JSON.parse(recent.json));
        else lsSet(K.recent, null);
      }
      renderView(d);
    }).catch(function () {
      $("list").replaceChildren();
      if (location.protocol === "file:") {
        $("list").append(el("p", { class: "empty-note", text: "Open this through a local server (see SETUP.md), not by double-clicking the file." }));
      }
    });
  }

  /* =====================================================================
     EDIT MODE
     ===================================================================== */
  var mode = "view";
  var adapter = null;   // Local or GitHub
  var data = null;      // what you're editing
  var base = null;      // { commit, tree } the GitHub version you started from
  var savedJSON = "";   // last saved version, to know if there are unsaved changes
  var busy = false;

  /* ---------- Token ---------- */
  function getToken() { return (SS && read(SS, K.token)) || lsGet(K.token); }
  function setToken(t, remember) {
    clearToken();
    if (remember) lsSet(K.token, t); else if (SS) store(SS, K.token, t);
    lsSet(K.savedAt, String(Date.now()));
  }
  function clearToken() {
    if (SS) store(SS, K.token, null);
    lsSet(K.token, null); lsSet(K.savedAt, null); lsSet(K.expires, null);
  }

  function tokenWarning() {
    var exp = lsGet(K.expires);
    if (exp) {
      var t = Date.parse(exp.replace(" UTC", "Z").replace(" ", "T"));
      if (!isNaN(t)) {
        var days = Math.floor((t - Date.now()) / 86400000);
        if (days <= 30) return "Your GitHub token expires in " + Math.max(days, 0) + " days. Make a new one soon (see SETUP.md).";
        return "";
      }
    }
    var saved = Number(lsGet(K.savedAt) || 0);
    if (saved && Date.now() - saved > 335 * 86400000) return "Your token is almost a year old. If it was made with a 1-year expiry, renew it soon.";
    return "";
  }

  /* ---------- GitHub API ---------- */
  function ApiError(status, message) { this.status = status; this.message = message || ""; }

  function api(path, opt) {
    opt = opt || {};
    var method = opt.method || "GET";
    var headers = { "Accept": opt.accept || "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION };
    var token = getToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (opt.body) headers["Content-Type"] = "application/json";
    var attempt = 0;
    function go() {
      return fetch(API + path, {
        method: method, headers: headers, cache: "no-store",
        body: opt.body ? JSON.stringify(opt.body) : undefined
      }).catch(function () { throw new ApiError(0, "offline"); }).then(function (res) {
        var exp = res.headers.get("github-authentication-token-expiration");
        if (exp) lsSet(K.expires, exp);
        if ((res.status === 429 || res.status >= 500) && method === "GET" && attempt < 2) {
          attempt++;
          return sleep(1500 * attempt).then(go);
        }
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            var m = j && j.message ? j.message : "";
            if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") m = "rate limit";
            throw new ApiError(res.status, m);
          });
        }
        if (opt.text) return res.text();
        return res.status === 204 ? null : res.json();
      });
    }
    return go();
  }

  function target(d) {
    var s = (d && d.site) || {};
    var m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
    var owner = s.owner || (m ? m[1] : "");
    var repo = s.repo || (m ? host.toLowerCase() : "");
    var branch = /^[\w.\-\/]+$/.test(s.branch || "") ? s.branch : "main";
    return { owner: owner, repo: repo, branch: branch, path: "/repos/" + owner + "/" + repo };
  }

  var tgt = null;

  var GitHub = {
    verify: function () {
      return api(tgt.path).then(function (r) {
        if (!r.permissions || !r.permissions.push) throw new ApiError(403, "no push");
      });
    },
    load: function () {
      var commit;
      return api(tgt.path + "/git/ref/heads/" + tgt.branch).then(function (ref) {
        commit = ref.object.sha;
        return api(tgt.path + "/git/commits/" + commit);
      }).then(function (c) {
        return api(tgt.path + "/contents/content.json?ref=" + commit, { accept: "application/vnd.github.raw+json", text: true })
          .then(function (text) { return { data: normalize(JSON.parse(text)), base: { commit: commit, tree: c.tree.sha } }; });
      });
    },
    // One commit, and it only lands if nobody else saved in between (force: false).
    save: function (json, b) {
      var tree;
      return api(tgt.path + "/git/trees", { method: "POST", body: {
        base_tree: b.tree,
        tree: [{ path: "content.json", mode: "100644", type: "blob", content: json }]
      } }).then(function (t) {
        tree = t.sha;
        return api(tgt.path + "/git/commits", { method: "POST", body: { message: "Update links", tree: tree, parents: [b.commit] } });
      }).then(function (c) {
        return api(tgt.path + "/git/refs/heads/" + tgt.branch, { method: "PATCH", body: { sha: c.sha, force: false } })
          .then(function () { return { commit: c.sha, tree: tree }; });
      });
    },
    history: function () {
      return api(tgt.path + "/commits?path=content.json&sha=" + encodeURIComponent(tgt.branch) + "&per_page=30");
    },
    at: function (sha) {
      return api(tgt.path + "/contents/content.json?ref=" + sha, { accept: "application/vnd.github.raw+json", text: true })
        .then(function (text) { return normalize(JSON.parse(text)); });
    }
  };

  /* ---------- Drafts (unsaved work survives closing the tab) ---------- */
  function readDraft() { try { return JSON.parse(lsGet(K.draft) || "null"); } catch (e) { return null; } }
  function writeDraft() {
    var json = serialize(data);
    if (json === savedJSON) lsSet(K.draft, null);
    else lsSet(K.draft, JSON.stringify({ json: json, base: base }));
  }

  /* ---------- Enter edit mode ---------- */
  function startEdit() {
    mode = "edit";
    document.body.classList.add("editing");
    $("list").replaceChildren();
    $("bar").hidden = false;
    status("Loading…");
    return fetchContent().catch(function () { return normalize(null); }).then(function (fileData) {
      setMark(fileData);
      if (isLocal) {
        adapter = "local";
        $("b-save").textContent = "Download";
        return enterEditor(fileData, null);
      }
      adapter = "github";
      $("b-save").textContent = "Save";
      tgt = target(fileData);
      if (!tgt.owner || !tgt.repo) {
        return message("Which repo?", "This page isn't on a username.github.io address. Put your GitHub username and repo name in the \"site\" part of content.json (see SETUP.md).", leaveEdit);
      }
      if (!getToken()) return unlockDialog("");
      return loadFromGitHub();
    });
  }

  function loadFromGitHub() {
    status("Loading from GitHub…");
    return GitHub.load().then(function (r) { enterEditor(r.data, r.base); }, handleError);
  }

  function enterEditor(fresh, b) {
    data = fresh; base = b; savedJSON = serialize(fresh);
    var draft = readDraft();
    var restored = false;
    if (draft && draft.json && draft.json !== savedJSON) {
      try { data = normalize(JSON.parse(draft.json)); base = draft.base || b; restored = true; } catch (e) { lsSet(K.draft, null); }
    } else lsSet(K.draft, null);
    renderEdit();
    updateDirty();
    var warn = adapter === "github" ? tokenWarning() : "";
    if (warn) status(warn, true);
    else if (restored) status("Restored your unsaved changes.");
    else if (adapter === "local") status("Local test mode. Nothing goes online.");
  }

  function leaveEdit() {
    history.replaceState(null, "", location.pathname + location.search);
    startView();
  }

  /* ---------- Edit screen ---------- */
  function renderEdit() {
    setMark(data);
    var list = $("list");
    list.replaceChildren();
    if (!data.groups.length) list.append(el("p", { class: "empty-note", text: "No groups yet. Tap “+ Add” to add your first link." }));
    data.groups.forEach(function (g, gi) {
      var ul = el("ul", { class: "rows" });
      g.links.forEach(function (l, li) {
        var shown = safeUrl(l.url) ? address(l.url) : "⚠ invalid link";
        ul.append(el("li", { class: "edit-li" },
          el("button", { class: "row", type: "button", onclick: function () { linkDialog(gi, li); } },
            el("span", { class: "text" },
              el("span", { class: "name", text: l.name || shown }),
              el("span", { class: "addr", text: shown }))),
          el("button", { class: "move", type: "button", "aria-label": "Move up", disabled: li === 0, onclick: function () { move(gi, li, -1); } }, "↑"),
          el("button", { class: "move", type: "button", "aria-label": "Move down", disabled: li === g.links.length - 1, onclick: function () { move(gi, li, 1); } }, "↓")));
      });
      list.append(el("section", { class: "group" },
        el("button", { class: "label-btn", type: "button", text: g.label, onclick: function () { groupDialog(gi); } }),
        ul,
        el("button", { class: "add-row", type: "button", text: "+ add link to " + g.label, onclick: function () { linkDialog(gi, -1); } })));
    });
  }

  function changed() { writeDraft(); renderEdit(); updateDirty(); }

  function move(gi, li, dir) {
    var links = data.groups[gi].links, j = li + dir;
    if (j < 0 || j >= links.length) return;
    var tmp = links[li]; links[li] = links[j]; links[j] = tmp;
    changed();
  }

  function isDirty() { return data && serialize(data) !== savedJSON; }

  function updateDirty() {
    var dirty = isDirty();
    $("b-save").disabled = busy || (adapter === "github" && !dirty);
    $("b-add").disabled = busy;
    $("b-menu").disabled = busy;
    if (dirty) status("Unsaved changes");
    else if (!busy && $("status").textContent === "Unsaved changes") status("");
  }

  function status(text, warn) {
    var s = $("status");
    s.textContent = text || "";
    s.classList.toggle("warn", !!warn);
  }

  /* ---------- Dialogs ---------- */
  var dlg = $("dlg");
  var onCancel = null;
  dlg.addEventListener("cancel", function (e) {
    if (onCancel) { e.preventDefault(); var f = onCancel; onCancel = null; closeDialog(); f(); }
  });

  function openDialog(build, cancelFn) {
    onCancel = cancelFn || null;
    dlg.replaceChildren();
    build(dlg);
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    var first = dlg.querySelector("input, select");
    if (first) first.focus();
  }
  function closeDialog() {
    onCancel = null;
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  }
  function onEnter(input, fn) {
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); fn(); } });
    return input;
  }

  function message(title, text, after) {
    openDialog(function (d) {
      d.append(el("h2", { text: title }), el("p", { text: text }),
        el("div", { class: "actions" }, el("span", { class: "spacer" }),
          el("button", { class: "btn primary", type: "button", text: "OK", onclick: function () { closeDialog(); if (after) after(); } })));
    }, after || function () {});
  }

  function unlockDialog(errText) {
    status("Locked");
    openDialog(function (d) {
      var input = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "github_pat_…" });
      var remember = el("input", { type: "checkbox", checked: true });
      var err = el("p", { class: "err", text: errText || "" });
      var go = function () {
        var t = input.value.trim();
        if (!t) return;
        setToken(t, remember.checked);
        err.textContent = "Checking…";
        GitHub.verify().then(function () {
          closeDialog();
          loadFromGitHub();
        }, function (e) {
          clearToken();
          err.textContent = e.status === 401 ? "GitHub says this token is wrong or expired."
            : e.status === 404 ? "This token can't see the repo " + tgt.owner + "/" + tgt.repo + ". Check “Repository access”."
            : e.status === 403 ? "This token can read but not write. Set “Contents” to “Read and write”."
            : e.status === 0 ? "No internet connection." : "GitHub error " + e.status + ".";
        });
      };
      d.append(
        el("h2", { text: "Unlock edit mode" }),
        el("p", { text: "Paste your GitHub token. It is kept only on this device and sent only to GitHub." }),
        onEnter(input, go),
        el("label", { class: "check" }, remember, "Remember on this device"),
        err,
        el("div", { class: "actions" },
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: function () { closeDialog(); leaveEdit(); } }),
          el("span", { class: "spacer" }),
          el("button", { class: "btn primary", type: "button", text: "Unlock", onclick: go })));
    }, leaveEdit);
  }

  function linkDialog(gi, li) {
    var isNew = li < 0;
    if (gi < 0 || gi >= data.groups.length) gi = 0;
    var link = isNew ? { name: "", url: "" } : data.groups[gi].links[li];
    openDialog(function (d) {
      var name = el("input", { type: "text", value: link.name, maxlength: "80", placeholder: "Letterboxd", autocomplete: "off" });
      var url = el("input", { type: "url", value: link.url, placeholder: "letterboxd.com/yourname", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
      var group = el("select");
      data.groups.forEach(function (g, i) { group.append(el("option", { value: String(i), selected: i === gi, text: g.label })); });
      if (!data.groups.length) group.append(el("option", { value: "0", text: "links" }));
      var err = el("p", { class: "err" });
      var done = function () {
        var u = cleanUrl(url.value);
        var n = name.value.trim();
        if (!u) { err.textContent = "That link doesn't look right. Use a web address (https://…) or an email."; return; }
        if (TOKEN_RE.test(n) || TOKEN_RE.test(u)) { err.textContent = "That looks like a GitHub token. Not saved — never put your token on the page."; return; }
        var item = { name: n, url: u };
        var ng = Number(group.value);
        if (!data.groups.length) data.groups.push({ label: "links", links: [] });
        if (isNew) data.groups[ng].links.push(item);
        else if (ng === gi) data.groups[gi].links[li] = item;
        else { data.groups[gi].links.splice(li, 1); data.groups[ng].links.push(item); }
        closeDialog(); changed();
      };
      d.append(
        el("h2", { text: isNew ? "Add link" : "Edit link" }),
        el("label", { text: "Name" }), onEnter(name, done),
        el("label", { text: "Link" }), onEnter(url, done),
        el("label", { text: "Group" }), group,
        err,
        el("div", { class: "actions" },
          isNew ? null : el("button", { class: "btn danger", type: "button", text: "Delete", onclick: function () {
            data.groups[gi].links.splice(li, 1); closeDialog(); changed();
          } }),
          el("span", { class: "spacer" }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeDialog }),
          el("button", { class: "btn primary", type: "button", text: "Done", onclick: done })));
    });
  }

  function groupDialog(gi) {
    var isNew = gi < 0;
    var g = isNew ? { label: "", links: [] } : data.groups[gi];
    openDialog(function (d) {
      var label = el("input", { type: "text", value: g.label, maxlength: "30", placeholder: "sites", autocomplete: "off" });
      var err = el("p", { class: "err" });
      var done = function () {
        var v = label.value.trim().toLowerCase();
        if (!v) { err.textContent = "Give the group a name."; return; }
        if (TOKEN_RE.test(v)) { err.textContent = "That looks like a GitHub token."; return; }
        if (isNew) data.groups.push({ label: v, links: [] }); else g.label = v;
        closeDialog(); changed();
      };
      var del = function () {
        if (g.links.length && !del.sure) {
          del.sure = true;
          err.textContent = "This group has " + g.links.length + " link(s). Tap Delete again to remove the group and its links.";
          return;
        }
        data.groups.splice(gi, 1); closeDialog(); changed();
      };
      var upDown = isNew ? null : [
        el("button", { class: "btn", type: "button", text: "↑", "aria-label": "Move group up", disabled: gi === 0, onclick: function () {
          data.groups.splice(gi - 1, 0, data.groups.splice(gi, 1)[0]); closeDialog(); changed();
        } }),
        el("button", { class: "btn", type: "button", text: "↓", "aria-label": "Move group down", disabled: gi === data.groups.length - 1, onclick: function () {
          data.groups.splice(gi + 1, 0, data.groups.splice(gi, 1)[0]); closeDialog(); changed();
        } })
      ];
      d.append(
        el("h2", { text: isNew ? "Add group" : "Group" }),
        el("label", { text: "Label" }), onEnter(label, done),
        err,
        el("div", { class: "actions" },
          isNew ? null : el("button", { class: "btn danger", type: "button", text: "Delete", onclick: del }),
          upDown ? upDown[0] : null, upDown ? upDown[1] : null,
          el("span", { class: "spacer" }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeDialog }),
          el("button", { class: "btn primary", type: "button", text: "Done", onclick: done })));
    });
  }

  function markDialog() {
    openDialog(function (d) {
      var mark = el("input", { type: "text", value: data.mark, maxlength: "12", placeholder: "ab", autocomplete: "off" });
      var title = el("input", { type: "text", value: data.title, maxlength: "60", placeholder: "links", autocomplete: "off" });
      var err = el("p", { class: "err" });
      var done = function () {
        var m = mark.value.trim(), t = title.value.trim();
        if (TOKEN_RE.test(m) || TOKEN_RE.test(t)) { err.textContent = "That looks like a GitHub token."; return; }
        data.mark = m; data.title = t || "links";
        closeDialog(); changed();
      };
      d.append(
        el("h2", { text: "Your mark" }),
        el("p", { text: "The tiny text in the bottom-right corner. Leave empty to hide it." }),
        el("label", { text: "Mark" }), onEnter(mark, done),
        el("label", { text: "Browser tab title" }), onEnter(title, done),
        err,
        el("div", { class: "actions" }, el("span", { class: "spacer" }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: closeDialog }),
          el("button", { class: "btn primary", type: "button", text: "Done", onclick: done })));
    });
  }

  function menuDialog() {
    openDialog(function (d) {
      var item = function (text, fn, cls) {
        return el("button", { class: "btn wide" + (cls ? " " + cls : ""), type: "button", text: text, onclick: fn });
      };
      var file = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: function () {
        var f = file.files && file.files[0];
        if (!f) return;
        f.text().then(function (t) {
          data = normalize(JSON.parse(t)); closeDialog(); changed(); status("Loaded " + f.name + " — not saved yet.");
        }).catch(function () { message("Can't read that file", "It isn't a valid content.json."); });
      } });
      d.append(el("h2", { text: "More" }), el("div", { class: "stack" },
        item("Edit mark / tab title", markDialog),
        item("Add group", function () { groupDialog(-1); }),
        adapter === "github" ? item("History (undo)", historyDialog) : null,
        item("Download content.json (backup)", function () { exportFile(); closeDialog(); }),
        item("Load content.json from file", function () { file.click(); }),
        file,
        isDirty() ? item("Discard unsaved changes", discard, "danger") : null,
        item("Done — view the site", function () { closeDialog(); leaveEdit(); }),
        adapter === "github" ? item("Lock (log out on this device)", lock, "danger") : null,
        item("Close", closeDialog)));
    });
  }

  function discard() {
    lsSet(K.draft, null);
    closeDialog();
    if (adapter === "github") loadFromGitHub();
    else startEdit();
  }

  function lock() {
    if (isDirty() && !lock.sure) {
      lock.sure = true;
      status("Unsaved changes will be deleted. Tap Lock again to confirm.", true);
      return;
    }
    lock.sure = false;
    clearToken();
    lsSet(K.draft, null);
    lsSet(K.recent, null);
    closeDialog();
    leaveEdit();
  }

  function historyDialog() {
    openDialog(function (d) {
      var ul = el("ul", { class: "hist" });
      d.append(el("h2", { text: "History" }),
        el("p", { text: "Every save is kept forever. Tap one to load it into the editor, then Save to bring it back." }),
        ul,
        el("div", { class: "actions" }, el("span", { class: "spacer" }),
          el("button", { class: "btn", type: "button", text: "Close", onclick: closeDialog })));
      ul.append(el("li", null, el("small", { text: "Loading…" })));
      GitHub.history().then(function (list) {
        ul.replaceChildren();
        list.forEach(function (c, i) {
          var when = new Date(c.commit.author.date).toLocaleString();
          ul.append(el("li", null, el("button", { type: "button", onclick: function () {
            GitHub.at(c.sha).then(function (old) {
              data = old; closeDialog(); changed();
              status(i === 0 ? "Loaded the latest version." : "Loaded version from " + when + ". Tap Save to restore it.");
            }, handleError);
          } }, c.commit.message.split("\n")[0], el("small", { text: when + " · " + c.sha.slice(0, 7) }))));
        });
      }, function (e) { closeDialog(); handleError(e); });
    });
  }

  function conflictDialog(json) {
    openDialog(function (d) {
      d.append(
        el("h2", { text: "Changed somewhere else" }),
        el("p", { text: "Your site was saved from another device or tab after you opened the editor. Pick one:" }),
        el("div", { class: "stack" },
          el("button", { class: "btn wide", type: "button", text: "Keep mine (replace theirs)", onclick: function () {
            closeDialog();
            status("Saving…");
            GitHub.load().then(function (r) { base = r.base; save(); }, handleError);
          } }),
          el("button", { class: "btn wide", type: "button", text: "Use theirs (drop my changes)", onclick: function () {
            lsSet(K.draft, null); closeDialog(); loadFromGitHub();
          } }),
          el("button", { class: "btn wide", type: "button", text: "Download mine first", onclick: function () { download(json); } }),
          el("button", { class: "btn wide", type: "button", text: "Cancel", onclick: closeDialog })));
    });
  }

  function handleError(e) {
    var s = e && e.status;
    status("");
    if (s === 401) { clearToken(); return unlockDialog("Your token is wrong or has expired. Paste a new one (see SETUP.md → Renew the token)."); }
    var text =
      s === 0 ? "You're offline. Your changes are kept on this device — try again when you're back online." :
      s === 403 && e.message === "rate limit" ? "GitHub says too many requests. Wait a few minutes and try again." :
      s === 403 ? "Your token can't write to this repo. In GitHub, check the token has “Contents: Read and write” for " + tgt.owner + "/" + tgt.repo + "." :
      s === 404 ? "GitHub can't find " + tgt.owner + "/" + tgt.repo + " (or its content.json / " + tgt.branch + " branch). Check the repo name and that the token has access to it." :
      s === 409 ? "The repo looks empty. Upload the site files first (SETUP.md, step 3)." :
      s === 410 ? "GitHub retired the API version this site uses. Change API_VERSION at the top of app.js to the newest one listed in GitHub's REST API docs." :
      s >= 500 || s === 429 ? "GitHub is having trouble right now. Your changes are kept on this device — try again later." :
      "Something went wrong" + (s ? " (GitHub error " + s + ")" : "") + ". Your changes are kept on this device.";
    message("Couldn't reach GitHub", text);
  }

  /* ---------- Save / export ---------- */
  function download(json) {
    var a = el("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: "content.json" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function leakCheck(json) {
    if (!TOKEN_RE.test(json)) return true;
    message("Not saved", "Your content contains something that looks like a GitHub token. Find it and remove it, then save again.");
    return false;
  }

  function exportFile() {
    var json = serialize(data);
    if (leakCheck(json)) download(json);
  }

  function save() {
    if (busy) return;
    var json = serialize(data);
    if (!leakCheck(json)) return;
    if (adapter === "local") {
      download(json);
      savedJSON = json;
      updateDirty();
      status("Downloaded. Replace site/content.json with it, then reload.");
      return;
    }
    busy = true; updateDirty(); status("Saving…");
    GitHub.save(json, base).then(function (b) {
      base = b; savedJSON = json;
      lsSet(K.draft, null);
      lsSet(K.recent, JSON.stringify({ json: json, at: Date.now() }));
      status("Saved ✓ Everyone sees it in about a minute.");
    }, function (e) {
      if (e.status === 422 || e.status === 409) conflictDialog(json);
      else handleError(e);
    }).then(function () { busy = false; updateDirty(); });
  }

  /* ---------- Wire up ---------- */
  $("b-add").addEventListener("click", function () { linkDialog(0, -1); });
  $("b-save").addEventListener("click", save);
  $("b-menu").addEventListener("click", menuDialog);
  $("mark").addEventListener("click", function () { if (mode === "edit" && data) markDialog(); });

  function route() { return location.hash === "#edit" ? startEdit() : startView(); }
  window.addEventListener("hashchange", route);
  route();
})();
