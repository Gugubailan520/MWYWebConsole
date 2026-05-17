// public/site-style.js - 运行期加载站点样式与功能开关
// 由所有页面引入，在 DOMContentLoaded 前拉取并注入到 head
(function () {
  function applySite(site) {
    if (!site) return;
    var isAdmin = !!window.__ADMIN_PAGE__;

    // 1. 标题
    if (site.site_name) {
      document.title = site.site_name;
    }

    // 2. Favicon
    if (site.site_favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = site.site_favicon;
    }

    // 管理后台页面只应用标题和 favicon，跳过视觉覆盖
    if (isAdmin) return;

    // 3. 背景图 — 替换 body 的 background
    if (site.site_background) {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.style.backgroundImage = "url('" + site.site_background + "')";
      });
      // 如果 body 已经存在（脚本在 body 末尾加载的情况），立即应用
      if (document.body) {
        document.body.style.backgroundImage = "url('" + site.site_background + "')";
      }
    }

    // 4. Logo — 替换 .topbar .logo img 和 .topbar-icon img
    if (site.site_logo) {
      document.addEventListener('DOMContentLoaded', function () {
        var logoImgs = document.querySelectorAll('.topbar .logo img, .topbar-icon img[src*="logo"]');
        logoImgs.forEach(function (img) { img.src = site.site_logo; });
      });
      if (document.body) {
        var logoImgs = document.querySelectorAll('.topbar .logo img, .topbar-icon img[src*="logo"]');
        logoImgs.forEach(function (img) { img.src = site.site_logo; });
      }
    }

    // 5. 品牌名 — 替换 .brand-name 文本
    if (site.site_name) {
      document.addEventListener('DOMContentLoaded', function () {
        var brandNames = document.querySelectorAll('.brand-name');
        brandNames.forEach(function (el) { el.textContent = site.site_name; });
      });
      if (document.body) {
        var brandNames = document.querySelectorAll('.brand-name');
        brandNames.forEach(function (el) { el.textContent = site.site_name; });
      }
    }

    // 5b. 副标题 — 替换 .brand-sub 文本
    if (site.site_subtitle !== undefined) {
      document.addEventListener('DOMContentLoaded', function () {
        var brandSubs = document.querySelectorAll('.brand-sub');
        brandSubs.forEach(function (el) { el.textContent = site.site_subtitle || ''; el.style.display = site.site_subtitle ? '' : 'none'; });
      });
      if (document.body) {
        var brandSubs = document.querySelectorAll('.brand-sub');
        brandSubs.forEach(function (el) { el.textContent = site.site_subtitle || ''; el.style.display = site.site_subtitle ? '' : 'none'; });
      }
    }

    // 6. 主题色 CSS 变量
    var root = document.documentElement;
    if (site.primary_color) {
      root.style.setProperty('--accent', site.primary_color);
      // 尝试衍生 lighter / glow 版本
      root.style.setProperty('--accent-glow', site.primary_color + '40');
      root.style.setProperty('--accent-gradient', 'linear-gradient(135deg, ' + site.primary_color + ', ' + lighten(site.primary_color, 40) + ')');
    }

    // 公共 CSS 变量（兼容旧逻辑）
    if (site.site_background) root.style.setProperty('--site-bg-image', "url('" + site.site_background + "')");
    if (site.site_logo) root.style.setProperty('--site-logo', "url('" + site.site_logo + "')");

    // 暴露到 window
    window.__SITE__ = site;
    document.dispatchEvent(new CustomEvent('site-info-ready', { detail: site }));
  }

  function applyFlags(flags) {
    window.__FEATURES__ = flags || {};
    document.dispatchEvent(new CustomEvent('site-features-ready', { detail: flags }));
  }

  // 简易颜色变亮函数
  function lighten(hex, amount) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var r = Math.min(255, parseInt(hex.substr(0, 2), 16) + amount);
    var g = Math.min(255, parseInt(hex.substr(2, 2), 16) + amount);
    var b = Math.min(255, parseInt(hex.substr(4, 2), 16) + amount);
    return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  fetch('/api/site/info', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.success) {
        applySite(j.site);
        applyFlags(j.features);
      }
    })
    .catch(function () { /* 忽略，使用默认样式 */ });
})();
