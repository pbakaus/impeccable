/**
 * Browser-side walker that surfaces editable text rows for the manual text-edit
 * popover under the Live-Bar. Served before live-browser.js and attached to
 * window.__IMPECCABLE_LIVE_TEXT_ROWS__.
 *
 * Rule: emit a row for an element iff every direct child is a Text node AND at
 * least one of those text nodes has non-whitespace content. Mixed-content
 * elements (text interleaved with element children) do not emit their own row;
 * pure-text leaves deeper in the subtree still emit.
 */
(function (root) {
  'use strict';

  var SKIP_SUBTREE_TAGS = {
    script: 1, style: 1, template: 1, noscript: 1, svg: 1, code: 1, pre: 1,
  };

  function collectEditableTextRows(rootEl, opts) {
    if (!rootEl || rootEl.nodeType !== 1) return [];
    var isOwn = (opts && opts.isOwn) || function () { return false; };
    var rows = [];

    function visit(el) {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName.toLowerCase();
      if (SKIP_SUBTREE_TAGS[tag]) return;
      if (el.hasAttribute && el.hasAttribute('contenteditable')) return;
      if (el !== rootEl && isOwn(el)) return;

      var children = el.childNodes;
      var hasChild = children.length > 0;
      var allText = hasChild;
      var hasNonWs = false;
      var textNodes = [];
      for (var i = 0; i < children.length; i++) {
        var node = children[i];
        if (node.nodeType === 3) {
          textNodes.push(node);
          if (node.nodeValue && /\S/.test(node.nodeValue)) hasNonWs = true;
        } else {
          allText = false;
        }
      }
      if (allText && hasNonWs) {
        rows.push({
          el: el,
          ref: refForElement(el, rootEl),
          text: textNodes.map(function (n) { return n.nodeValue; }).join(''),
          textNodes: textNodes,
        });
      }

      for (var j = 0; j < children.length; j++) {
        var c = children[j];
        if (c.nodeType === 1) visit(c);
      }
    }

    function refForElement(el, rootEl) {
      return documentRefPath(el) || el.tagName.toLowerCase();
    }

    function documentRefPath(el) {
      var parts = [];
      var cur = el;
      while (cur && cur.nodeType === 1) {
        var tag = cur.tagName.toLowerCase();
        if (tag === 'html') break;
        if (tag === 'body') {
          parts.unshift('body');
          break;
        }
        parts.unshift(refSegment(cur));
        cur = cur.parentElement;
      }
      return parts.join('>');
    }

    function refSegment(el) {
      var tag = el.tagName.toLowerCase();
      return tag + stableIdSuffix(el) + stableClassSuffix(el) + ':nth-of-type(' + indexAmongSameTag(el) + ')';
    }

    function stableIdSuffix(el) {
      if (!el.id) return '';
      return '#' + normalizeRefToken(el.id);
    }

    function stableClassSuffix(el) {
      if (!el.classList || el.classList.length === 0) return '';
      var classes = [];
      for (var i = 0; i < el.classList.length; i++) {
        var cls = el.classList[i];
        if (!cls || cls.indexOf('impeccable-') === 0) continue;
        classes.push(normalizeRefToken(cls));
        if (classes.length === 2) break;
      }
      return classes.length ? '.' + classes.join('.') : '';
    }

    function normalizeRefToken(value) {
      return String(value || '').replace(/[>\s]+/g, '_');
    }

    function indexAmongSameTag(el) {
      var parent = el.parentElement;
      if (!parent) return 1;
      var tag = el.tagName.toLowerCase();
      var n = 0;
      var sibs = parent.children;
      for (var i = 0; i < sibs.length; i++) {
        if (sibs[i].tagName.toLowerCase() === tag) {
          n++;
          if (sibs[i] === el) return n;
        }
      }
      return 1;
    }

    visit(rootEl);
    return rows;
  }

  root.__IMPECCABLE_LIVE_TEXT_ROWS__ = { collectEditableTextRows: collectEditableTextRows };
})(typeof window !== 'undefined' ? window : globalThis);
