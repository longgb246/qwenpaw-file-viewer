/**
 * 文件预览器 v4.0 — 走 QwenPaw 同源路由，不依赖独立后端
 * 
 * 核心变化：不再调用 http://127.0.0.1:39150，而是用 QwenPaw 自带的
 * /api/files/preview/{path} 路由（同源 HTTPS，不受 Mixed Content 阻止）
 * 
 * 文本文件 → fetch GET → 读取文本 → md2html/json/code 渲染
 * PDF     → iframe src="/api/files/preview/xxx.pdf"
 * XLSX    → fetch GET → ArrayBuffer → XLSX.read → Luckysheet
 * PPTX    → fetch GET → ArrayBuffer → PPTXViewer.renderElement
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'file-viewer';
  var STATIC_BASE = '/api/plugins/file-viewer/files/static';
  var PREVIEW_BASE = '/api/files/preview';

  var React, ReactDOM, createElement, useState, useEffect, useRef;

  function waitForHost(cb) {
    var retries = 0;
    (function poll() {
      var w = window.QwenPaw;
      if (w && w.host) {
        React = w.host.React;
        ReactDOM = w.host.ReactDOM;
        createElement = React.createElement;
        useState = React.useState;
        useEffect = React.useEffect;
        useRef = React.useRef;
        cb();
      } else if (retries++ < 200) {
        setTimeout(poll, 200);
      }
    })();
  }

  // ── 状态总线 ──────────────────────────────────────────────
  var bus = [];
  var state = { open: false, path: '', filename: '', ext: '', loading: false, content: '', binary: false, error: '' };

  function emit(patch) { Object.assign(state, patch); bus.forEach(function (fn) { fn(state); }); }

  function usePanel() {
    var s = useState(function () { return Object.assign({}, state); });
    var set = s[1];
    useEffect(function () {
      var fn = function (ns) { set(Object.assign({}, ns)); };
      bus.push(fn);
      return function () { bus = bus.filter(function (x) { return x !== fn; }); };
    }, []);
    return s[0];
  }

  // ── 读取文件（通过 QwenPaw 同源路由）───────────────────────
  function apiRead(path) {
    emit({ open: true, path: path, filename: path.split('/').pop(), ext: (path.split('.').pop() || '').toLowerCase(), loading: true, content: '', binary: false, error: '' });
    var url = PREVIEW_BASE + '/' + path;

    // 根据扩展名决定读取方式
    var ext = state.ext;
    var textExts = ['.md', '.markdown', '.json', '.txt', '.log', '.csv', '.py', '.js', '.ts', '.tsx', '.jsx',
      '.css', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.sql',
      '.java', '.go', '.rs', '.c', '.cpp', '.h', '.rb', '.php', '.html', '.htm'];
    var dotExt = '.' + ext;
    var isText = textExts.indexOf(dotExt) >= 0;

    if (isText) {
      // 文本文件：直接 fetch GET → 读取文本
      fetch(url).then(function (r) {
        if (!r.ok) { emit({ loading: false, error: 'HTTP ' + r.status }); return; }
        return r.text();
      }).then(function (text) {
        if (text === undefined) return; // error case
        emit({ content: text, binary: false, loading: false, error: '' });
      }).catch(function (e) { emit({ loading: false, error: '读取失败: ' + e.message }); });

    } else if (dotExt === '.pdf') {
      // PDF：fetch ArrayBuffer → base64 → data URL iframe（避开 content-disposition: attachment）
      fetch(url).then(function (r) {
        if (!r.ok) { emit({ loading: false, error: 'HTTP ' + r.status }); return; }
        return r.arrayBuffer();
      }).then(function (buf) {
        if (!buf) return;
        var bytes = new Uint8Array(buf);
        var b64 = '';
        for (var i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
        emit({ content: btoa(b64), binary: true, loading: false, error: '' });
      }).catch(function (e) { emit({ loading: false, error: '读取失败: ' + e.message }); });

    } else {
      // 二进制文件（xlsx/pptx 等）：fetch GET → ArrayBuffer
      fetch(url).then(function (r) {
        if (!r.ok) { emit({ loading: false, error: 'HTTP ' + r.status }); return; }
        return r.arrayBuffer();
      }).then(function (buf) {
        if (!buf) return;
        // 转成 base64 方便 XlsxRenderer/PptxRenderer 使用
        var bytes = new Uint8Array(buf);
        var b64 = '';
        for (var i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
        emit({ content: btoa(b64), binary: true, loading: false, error: '' });
      }).catch(function (e) { emit({ loading: false, error: '读取失败: ' + e.message }); });
    }
  }

  // ── 工具函数 ──────────────────────────────────────────────
  function base64ToBytes(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function loadScriptOnce(url, checkFn) {
    return new Promise(function (resolve, reject) {
      if (checkFn()) { resolve(); return; }
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { setTimeout(function () { checkFn() ? resolve() : reject(new Error(url + ' 未就绪')); }, 80); };
      s.onerror = function () { reject(new Error('加载失败: ' + url)); };
      document.head.appendChild(s);
    });
  }

  function xhrEval(url, checkFn) {
    return new Promise(function (resolve, reject) {
      if (checkFn()) { resolve(); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = function () {
        if (xhr.status !== 200) return reject(new Error('HTTP ' + xhr.status));
        try { eval.call(window, xhr.responseText); } catch (e) { return reject(e); }
        setTimeout(function () { checkFn() ? resolve() : reject(new Error(url + ' eval 后未就绪')); }, 200);
      };
      xhr.onerror = function () { reject(new Error('XHR 失败: ' + url)); };
      xhr.send();
    });
  }

  // ── Markdown → HTML ──────────────────────────────────────
  function md2html(text) {
    if (!text) return '';
    var h = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) { return '<pre class="fv-code"><code>' + code.trimEnd() + '</code></pre>'; });
    h = h.replace(/`([^`]+)`/g, '<code class="fv-inline">$1</code>');
    h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/(^\|.+\|\n\|[-:| ]+\|\n((^\|.+\|\n?)+))/gm, function (m) {
      var rows = m.trim().split('\n'), hdr = rows[0], body = rows.slice(2);
      function td(r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return '<td>' + c.trim() + '</td>'; }).join(''); }
      function th(r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return '<th>' + c.trim() + '</th>'; }).join(''); }
      return '<table class="fv-table"><thead><tr>' + th(hdr) + '</tr></thead><tbody>' + body.map(function (r) { return '<tr>' + td(r) + '</tr>'; }).join('') + '</tbody></table>';
    });
    h = h.replace(/^---$/gm, '<hr>');
    h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    h = h.replace(/\n\n+/g, '</p><p>');
    h = '<p>' + h + '</p>';
    h = h.replace(/<p><(h[1-4]|pre|ul|ol|li|hr|table)/g, '<$1');
    h = h.replace(/<\/(h[1-4]|pre|ul|ol|li|hr|table)><\/p>/g, '</$1>');
    h = h.replace(/<p>\s*<\/p>/g, '');
    return h;
  }

  // ── CSV → HTML 表格 ──────────────────────────────────────
  function csv2table(text) {
    if (!text) return '';
    var rows = text.split('\n').filter(function (r) { return r.trim(); });
    if (rows.length === 0) return '';
    function parseRow(row) {
      var cells = [], cur = '', inQ = false;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === '"' && !inQ) { inQ = true; }
        else if (ch === '"' && inQ) { inQ = false; }
        else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
        else { cur += ch; }
      }
      cells.push(cur);
      return cells;
    }
    var html = '<table class="fv-table"><thead><tr>';
    parseRow(rows[0]).forEach(function (c) { html += '<th>' + c.trim() + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.slice(1).forEach(function (r) { html += '<tr>'; parseRow(r).forEach(function (c) { html += '<td>' + c.trim() + '</td>'; }); html += '</tr>'; });
    html += '</tbody></table>';
    return html;
  }

  // ── 文件内容渲染 ─────────────────────────────────────────
  function renderContent(content, ext, binary) {
    switch (ext) {
      case 'md': case 'markdown':
        return createElement('div', { className: 'fv-md', dangerouslySetInnerHTML: { __html: md2html(content) } });
      case 'json':
        try { return createElement('pre', { className: 'fv-code' }, createElement('code', null, JSON.stringify(JSON.parse(content), null, 2))); }
        catch (e) { return createElement('pre', { className: 'fv-code' }, createElement('code', null, content)); }
      case 'csv':
        return createElement('div', { className: 'fv-md', dangerouslySetInnerHTML: { __html: csv2table(content) } });
      case 'html': case 'htm':
        return createElement('iframe', { sandbox: 'allow-same-origin', srcDoc: content, style: { width: '100%', height: '100%', border: 'none', minHeight: 500 } });
      case 'pdf':
        // content 是 base64，转为 data URL iframe（避开 content-disposition: attachment）
        return createElement('iframe', { src: 'data:application/pdf;base64,' + content, style: { width: '100%', height: '100%', border: 'none', minHeight: 600 } });
      case 'xlsx': case 'xls':
        // 当前使用轻量方案（XlsxLiteRenderer），如需切换回 Luckysheet 方案，改为 XlsxLuckysheetRenderer
        return createElement(XlsxLiteRenderer, { content: content });
      case 'pptx': case 'ppt':
        return createElement(PptxRenderer, { content: content });
      default:
        return createElement('pre', { className: 'fv-code' }, createElement('code', null, content));
    }
  }

  // ── Excel 渲染器（轻量方案）── SheetJS sheet_to_html ─────
  // 仅依赖 xlsx.full.min.js（~862KB），无需 jQuery/Luckysheet（~4MB）
  // 如需切换回 Luckysheet 方案，将 renderContent 中 XlsxLiteRenderer 改为 XlsxLuckysheetRenderer
  var XlsxLiteRenderer = function (props) {
    var content = props.content; // base64
    var containerRef = useRef(null);
    var errSt = useState(''); var errMsg = errSt[0]; var setError = errSt[1];
    var ldSt = useState(true); var loading = ldSt[0]; var setLd = ldSt[1];
    var sheetSt = useState(0); var activeSheet = sheetSt[0]; var setActiveSheet = sheetSt[1];
    var dataSt = useState(null); var sheetData = dataSt[0]; var setSheetData = dataSt[1];

    // 加载 SheetJS
    useEffect(function () {
      if (!content) return;
      loadScriptOnce(STATIC_BASE + '/xlsx.full.min.js', function () { return typeof XLSX !== 'undefined'; })
        .then(function () {
          try {
            var bytes = base64ToBytes(content);
            var wb = XLSX.read(bytes, { type: 'array' });
            var sheets = wb.SheetNames.map(function (name) {
              var ws = wb.Sheets[name];
              var html = XLSX.utils.sheet_to_html(ws, { id: 'xlsx-table-' + name.replace(/\s/g, '_') });
              return { name: name, html: html };
            });
            setSheetData(sheets);
            setLd(false);
          } catch (e) { setError('解析 Excel 失败: ' + e.message); setLd(false); }
        })
        .catch(function (e) { setError('加载失败: ' + e.message); setLd(false); });
    }, [content]);

    if (errMsg) return createElement('div', { style: { color: '#ff4d4f', padding: 20 } }, errMsg);
    if (loading) return createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } }, '正在加载 Excel...');
    if (!sheetData || sheetData.length === 0) return createElement('div', { style: { padding: 20, color: '#999' } }, '无数据');

    // Sheet 标签栏
    var tabs = createElement('div', { style: {
      display: 'flex', borderTop: '1px solid #d9d9d9', background: '#f0f0f0',
      overflowX: 'auto', flexShrink: 0
    } },
      sheetData.map(function (s, idx) {
        var isActive = idx === activeSheet;
        return createElement('div', {
          key: idx,
          onClick: function () { setActiveSheet(idx); },
          style: {
            padding: '6px 16px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            borderRight: '1px solid #d9d9d9',
            background: isActive ? '#fff' : '#f0f0f0',
            color: isActive ? '#1890ff' : '#333',
            fontWeight: isActive ? '600' : '400',
            borderBottom: isActive ? '2px solid #1890ff' : '2px solid transparent'
          }
        }, s.name);
      })
    );

    // 表格内容区域
    var tableArea = createElement('div', {
      ref: containerRef,
      style: { flex: 1, overflow: 'auto', background: '#fff' },
      dangerouslySetInnerHTML: { __html: sheetData[activeSheet].html }
    });

    // 内联样式注入
    var styleTag = createElement('style', null, [
      '.xlsx-lite-wrap table { border-collapse: collapse; width: 100%; font-size: 13px; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }',
      '.xlsx-lite-wrap th, .xlsx-lite-wrap td { border: 1px solid #e8e8e8; padding: 6px 10px; text-align: left; white-space: nowrap; }',
      '.xlsx-lite-wrap thead tr:first-child th, .xlsx-lite-wrap tr:first-child td { background: #fafafa; font-weight: 600; position: sticky; top: 0; z-index: 1; }',
      '.xlsx-lite-wrap tbody tr:nth-child(even) { background: #fafbfc; }',
      '.xlsx-lite-wrap tbody tr:hover { background: #e6f7ff; }'
    ].join('\n'));

    return createElement('div', {
      className: 'xlsx-lite-wrap',
      style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4 }
    }, styleTag, tableArea, tabs);
  };

  // ── Excel 渲染器（Luckysheet 方案 - 已停用）────────────────
  // 完整电子表格编辑器，运行时 ~4MB JS（luckysheet + jquery + xlsx）
  // 如需启用，将 renderContent 中 XlsxLiteRenderer 改为 XlsxLuckysheetRenderer
  var XlsxLuckysheetRenderer = function (props) {
    var content = props.content; // base64
    var containerRef = useRef(null);
    var errSt = useState(''); var errMsg = errSt[0]; var setError = errSt[1];
    var ldSt = useState(true); var loading = ldSt[0]; var setLd = ldSt[1];

    useEffect(function () {
      if (!content) return;
      var chain = Promise.resolve();
      chain = chain.then(function () { return loadScriptOnce(STATIC_BASE + '/jquery.min.js', function () { return !!window.jQuery; }); });
      chain = chain.then(function () { return loadScriptOnce(STATIC_BASE + '/jquery.mousewheel.min.js', function () { return typeof jQuery.fn.mousewheel === 'function'; }); });
      chain = chain.then(function () { return loadScriptOnce(STATIC_BASE + '/xlsx.full.min.js', function () { return typeof XLSX !== 'undefined'; }); });
      chain = chain.then(function () {
        if (!document.querySelector('link[href*="luckysheet.css"]')) {
          var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = STATIC_BASE + '/css/luckysheet.css'; document.head.appendChild(link);
        }
        return new Promise(function (r) { setTimeout(r, 100); });
      });
      chain = chain.then(function () { return xhrEval(STATIC_BASE + '/luckysheet.umd.js', function () { return !!window.luckysheet; }); });
      chain.then(function () {
        setLd(false);
        setTimeout(function () {
          try {
            var bytes = base64ToBytes(content);
            var wb = XLSX.read(bytes, { type: 'array' });
            var data = wb.SheetNames.map(function (name, idx) {
              return { name: name, data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }), status: idx === 0 ? 1 : 0, order: idx };
            });
            window.luckysheet.create({
              container: 'luckysheet-container', data: data, lang: 'zh',
              showinfobar: false, showtoolbar: true, allowUpdate: false, sheetBottomConfig: false
            });
          } catch (e) { setError('创建表格失败: ' + e.message); }
        }, 120);
      }).catch(function (e) { setError('加载失败: ' + e.message); setLd(false); });
    }, [content]);

    if (errMsg) return createElement('div', { style: { color: '#ff4d4f', padding: 20 } }, errMsg);
    if (loading) return createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } }, '正在加载 Excel 引擎...');
    return createElement('div', { ref: containerRef, style: { height: 'calc(100vh - 120px)', background: '#fff' },
      dangerouslySetInnerHTML: { __html: '<div id="luckysheet-container" style="width:100%;height:100%;"></div>' } });
  };

  // ── PPTX 渲染器 ──────────────────────────────────────────
  var PptxRenderer = function (props) {
    var content = props.content; // base64
    var containerRef = useRef(null);
    var errSt = useState(''); var errMsg = errSt[0]; var setError = errSt[1];
    var ldSt = useState(true); var loading = ldSt[0]; var setLd = ldSt[1];

    useEffect(function () {
      if (!content) return;
      loadScriptOnce(STATIC_BASE + '/pptx-viewer.js', function () { return typeof window.PPTXViewer !== 'undefined'; })
        .then(function () { setLd(false); })
        .catch(function (e) { setError('加载失败: ' + e.message); setLd(false); });
    }, [content]);

    useEffect(function () {
      if (loading || !containerRef.current || !content) return;
      try {
        var bytes = base64ToBytes(content);
        // PPTXViewer 是 UMD 命名空间，真正的构造函数在 PPTXViewer.PPTXViewer
        var ViewerClass = window.PPTXViewer.PPTXViewer || window.PPTXViewer;
        var viewer = new ViewerClass(containerRef.current, {
          showControls: true,
          keyboardNavigation: true,
          onLoad: function () { console.log('[FileViewer] PPTX loaded'); },
          onError: function (err) { setError('渲染失败: ' + err.message); }
        });
        viewer.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      } catch (e) { setError('渲染失败: ' + e.message); }
    }, [loading, content]);

    if (errMsg) return createElement('div', { style: { color: '#ff4d4f', padding: 20 } }, errMsg);
    if (loading) return createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } }, '正在加载 PPTX 引擎...');
    return createElement('div', { ref: containerRef, style: { height: 'calc(100vh - 120px)', overflow: 'auto', background: '#fff' } });
  };

  // ── 提取文件路径 ──────────────────────────────────────────
  function extractFileInfo(data) {
    var content = data.content || [];
    var first = content[0];
    var second = content[1];
    if (!first || !first.data) return null;
    var fd = first.data;
    var sd = second && second.data;
    var args = fd.arguments || fd.input || fd.args || {};
    var outputStr = sd && sd.output ? sd.output : '';

    // 兼容 write_file (file_path) 和 read_file (relative_workspace_path) 的参数名
    var filePath = args.file_path || args.path || args.filepath
                || args.relative_workspace_path || null;
    if (!filePath && fd.source && fd.source.url) {
      var url = fd.source.url;
      if (url.startsWith('file://')) url = url.slice(7);
      if (url.startsWith('/')) filePath = url;
    }
    if (!filePath && outputStr) {
      try { var obj = JSON.parse(outputStr); filePath = obj.file_path || obj.path || null; } catch (e) {}
    }
    if (!filePath && outputStr) {
      var m = outputStr.match(/\/[^\s"']+\.\w{1,6}/);
      if (m) filePath = m[0].replace(/^\/+/, '/').replace(/[.,;:'")\]>]+$/, '');
    }
    if (!filePath) return null;
    var ext = filePath.split('.').pop().toLowerCase();
    return { path: filePath, filename: filePath.split('/').pop(), ext: ext };
  }

  // ── 可预览扩展名 ──────────────────────────────────────────
  var PREVIEW_EXTS = [
    '.md', '.markdown', '.json', '.txt', '.log', '.csv',
    '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.xml', '.yaml', '.yml',
    '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.sql',
    '.java', '.go', '.rs', '.c', '.cpp', '.h', '.rb', '.php',
    '.html', '.htm', '.pdf', '.xlsx', '.xls', '.pptx', '.ppt'
  ];
  function canPreview(ext) { var n = ext.toLowerCase(); if (n[0] !== '.') n = '.' + n; return PREVIEW_EXTS.indexOf(n) >= 0; }
  function fileIcon(ext) { return {md:'📝',markdown:'📝',json:'📋',csv:'📊',py:'🐍',js:'📜',ts:'📜',sh:'💻',html:'🌐',htm:'🌐',pdf:'📕',xlsx:'📗',xls:'📗',pptx:'📽️',ppt:'📽️'}[ext] || '📄'; }

  // ── FileCard 组件 ────────────────────────────────────────
  // 同时展示预览卡片 + 可折叠的原始工具调用详情
  function FileCard(props) {
    var data = props.data;
    var expandSt = useState(false); var expanded = expandSt[0]; var setExpanded = expandSt[1];

    // 提取工具调用信息
    var content = data.content || [];
    var first = content[0]; var second = content[1];
    var toolName = first && first.data ? first.data.name || '' : '';
    var toolArgs = first && first.data ? (first.data.arguments || first.data.input || first.data.args || {}) : {};
    var toolOutput = second && second.data ? (second.data.output || '') : '';

    var info = extractFileInfo(data);
    if (!info || !info.path) {
      // 无法提取文件路径时，回退显示工具调用原始信息
      return createElement('div', { style: { fontSize: 12, color: '#666', fontFamily: 'monospace' } },
        toolOutput || JSON.stringify(toolArgs, null, 2));
    }

    var previewable = canPreview('.' + info.ext);
    var icon = fileIcon(info.ext);

    // 预览卡片
    var card = createElement('div', {
      className: 'fv-card',
      onClick: previewable ? function () { apiRead(info.path); } : undefined,
      style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 6,
        border: '1px solid #d9d9d9', background: '#fafafa', cursor: previewable ? 'pointer' : 'default',
        fontSize: 13, fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', transition: 'all 0.2s' }
    },
      createElement('span', { style: { fontSize: 18 } }, icon),
      createElement('span', { style: { fontWeight: 500 } }, info.filename),
      previewable ? createElement('span', { style: { color: '#1677ff', fontSize: 11 } }, '点击预览 →')
                  : createElement('span', { style: { color: '#bbb', fontSize: 11 } }, '不可预览')
    );

    // 格式化工具调用参数（简洁显示，过滤掉 file_content 等大字段）
    var displayArgs = {};
    Object.keys(toolArgs).forEach(function (k) {
      var v = toolArgs[k];
      if (k === 'file_content' || k === 'content') {
        displayArgs[k] = typeof v === 'string' ? (v.length > 200 ? v.substring(0, 200) + '...[' + v.length + ' chars]' : v) : v;
      } else {
        displayArgs[k] = v;
      }
    });

    // 格式化输出（截断过长内容）
    var displayOutput = toolOutput;
    if (typeof displayOutput === 'string' && displayOutput.length > 500) {
      displayOutput = displayOutput.substring(0, 500) + '...[' + toolOutput.length + ' chars]';
    } else if (typeof displayOutput === 'object') {
      displayOutput = JSON.stringify(displayOutput, null, 2);
    }

    // 可折叠的工具调用详情
    var detailToggle = createElement('div', {
      onClick: function (e) { e.stopPropagation(); setExpanded(!expanded); },
      style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11,
        color: '#999', cursor: 'pointer', userSelect: 'none', marginTop: 4 }
    },
      createElement('span', { style: { transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' } }, '▶'),
      createElement('span', null, toolName || 'tool_call')
    );

    var detailContent = expanded ? createElement('div', {
      style: { marginTop: 4, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e8e8e8',
        borderRadius: 4, fontSize: 12, fontFamily: 'Menlo,Consolas,monospace', lineHeight: 1.5, overflowX: 'auto' }
    },
      createElement('div', { style: { marginBottom: 6 } },
        createElement('span', { style: { color: '#8250df', fontWeight: 600 } }, 'Input'),
        createElement('pre', { style: { margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' } },
          JSON.stringify(displayArgs, null, 2))
      ),
      toolOutput ? createElement('div', null,
        createElement('span', { style: { color: '#1a7f37', fontWeight: 600 } }, 'Output'),
        createElement('pre', { style: { margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#333' } },
          typeof displayOutput === 'string' ? displayOutput : JSON.stringify(displayOutput, null, 2))
      ) : null
    ) : null;

    return createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' } },
      card, detailToggle, detailContent);
  }

  // ── 下载 ────────────────────────────────────────────────
  function handleDownload() {
    if (!state.path) return;
    window.open(PREVIEW_BASE + '/' + state.path, '_blank');
  }

  // ── 预览面板 ────────────────────────────────────────────
  function PreviewPanel() {
    var s = usePanel();
    if (!s.open) return null;

    var header = createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 16px', borderBottom: '1px solid #e8e8e8', background: '#fff' }},
      createElement('span', { style: { fontWeight: 600, fontSize: 14 } }, s.filename || '文件预览'),
      createElement('div', { style: { display: 'flex', gap: 8 } },
        createElement('button', { onClick: handleDownload, style: { background: '#1677ff', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' } }, '下载'),
        createElement('button', { onClick: function () { emit({ open: false }); }, style: { background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' } }, '关闭 ✕')
      )
    );

    var body;
    if (s.loading) {
      body = createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } }, '正在加载...');
    } else if (s.error) {
      body = createElement('div', { style: { color: '#ff4d4f', padding: 20 } }, s.error);
    } else {
      body = renderContent(s.content, s.ext, s.binary);
    }

    return createElement('div', { style: { position: 'fixed', right: 0, top: 0, width: '50%', height: '100vh',
      background: '#fff', borderLeft: '2px solid #e8e8e8', zIndex: 99999, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', overflow: 'hidden' }},
      header,
      createElement('div', { style: { flex: 1, overflow: 'auto', padding: (s.binary || s.ext === 'pdf') ? 0 : 16 } }, body)
    );
  }

  // ── 面板容器 ────────────────────────────────────────────
  var panelRoot = null;
  function renderPanel() { if (panelRoot) panelRoot.render(createElement(PreviewPanel)); }
  function injectPanel() {
    if (document.getElementById('fv-panel-root')) { panelRoot = ReactDOM.createRoot(document.getElementById('fv-panel-root')); return; }
    var div = document.createElement('div'); div.id = 'fv-panel-root'; document.body.appendChild(div);
    panelRoot = ReactDOM.createRoot(div);
  }

  // ── CSS ────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('fv-styles')) return;
    var s = document.createElement('style'); s.id = 'fv-styles';
    s.textContent = '.fv-card:hover{border-color:#1677ff!important;background:#e6f4ff!important}' +
      '.fv-md{font-size:14px;line-height:1.7}.fv-md h1{font-size:24px;margin:16px 0 8px}.fv-md h2{font-size:20px;margin:14px 0 6px}.fv-md h3{font-size:17px;margin:12px 0 4px}.fv-md h4{font-size:15px;margin:10px 0 4px}.fv-md p{margin:8px 0}.fv-md a{color:#1677ff}.fv-md li{margin:4px 0}.fv-md hr{border:none;border-top:1px solid #e8e8e8;margin:16px 0}' +
      '.fv-code{background:#f6f8fa;border:1px solid #e8e8e8;border-radius:6px;padding:12px 16px;font-size:13px;overflow:auto;margin:8px 0}.fv-code code{font-family:Menlo,Consolas,monospace}' +
      '.fv-inline{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-family:Menlo,Consolas,monospace;font-size:12px}' +
      '.fv-table{border-collapse:collapse;font-size:13px;width:auto}.fv-table th{background:#fafafa;border:1px solid #e8e8e8;padding:8px 12px;font-weight:600;white-space:nowrap}.fv-table td{border:1px solid #e8e8e8;padding:8px 12px;white-space:nowrap}.fv-table tr:hover td{background:#e6f7ff}';
    document.head.appendChild(s);
  }

  // ── 主入口 ──────────────────────────────────────────────
  waitForHost(function () {
    injectCSS();
    injectPanel();
    window.QwenPaw.registerToolRender(PLUGIN_ID, { 'write_file': FileCard, 'send_file_to_user': FileCard, 'read_file': FileCard });
    bus.push(function () { renderPanel(); });
    renderPanel();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) emit({ open: false }); });
    console.log('[FileViewer] ✅ v5.0 已就绪（支持 read_file 预览）');
  });
})();