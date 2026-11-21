/**
 * Puts markup into an element without innerHTML.
 *
 * The panels build their markup as template strings in which every value from outside (dictionary entries, file
 * contents, API answers) already goes through esc(). This helper is the second line of defence: the markup is parsed
 * in an inert <template> (nothing in it runs or loads while parsing), everything that could execute is removed, and
 * only then are the nodes moved into the page. Parsing inside <template> keeps fragments such as <tr>, <td> and
 * <option> that a plain document body would drop.
 */

const EXECUTABLE_ELEMENTS = 'script, iframe, frame, object, embed, base, meta, link';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc']);

/**
 * Replaces the children of el with the nodes parsed from html.
 * @param {Element} el
 * @param {string} html  markup whose dynamic values have already been escaped
 */
export function setSafeHTML(el, html) {
  // DOMParser builds an inert document: nothing in it runs or loads, and it is never attached to the page
  const doc = new DOMParser().parseFromString(`<template>${String(html ?? '')}</template>`, 'text/html');
  const fragment = doc.querySelector('template').content;

  for (const node of fragment.querySelectorAll(EXECUTABLE_ELEMENTS)) node.remove();
  for (const node of fragment.querySelectorAll('*')) {
    for (const { name, value } of Array.from(node.attributes)) {
      const attr = name.toLowerCase();
      if (attr.startsWith('on') || (URL_ATTRIBUTES.has(attr) && /^\s*(javascript|vbscript|data):/i.test(value))) {
        node.removeAttribute(name);
      }
    }
  }
  el.replaceChildren(document.importNode(fragment, true));
}
