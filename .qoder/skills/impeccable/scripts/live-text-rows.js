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
          ref: (el === rootEl) ? tag : refForDescendant(el),
          text: textNodes.map(function (n) { return n.nodeValue; }).join(''),
          textNodes: textNodes,
        });
      }

      for (var j = 0; j < children.length; j++) {
        var c = children[j];
        if (c.nodeType === 1) visit(c);
      }
    }

    function refForDescendant(el) {
      var parent = el.parentElement;
      var tag = el.tagName.toLowerCase();
      if (!parent) return tag;
      var n = 0;
      var sibs = parent.children;
      for (var i = 0; i < sibs.length; i++) {
        if (sibs[i].tagName.toLowerCase() === tag) {
          n++;
          if (sibs[i] === el) break;
        }
      }
      return parent.tagName.toLowerCase() + '>' + tag + '.' + n;
    }

    visit(rootEl);
    return rows;
  }

  root.__IMPECCABLE_LIVE_TEXT_ROWS__ = { collectEditableTextRows: collectEditableTextRows };
})(typeof window !== 'undefined' ? window : globalThis);
