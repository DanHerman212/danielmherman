/* esm.sh - lit-html@3.3.3/directives/style-map */
import{noChange as l}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";import{directive as c,Directive as a,PartType as u}from"./lit-html_3.3.3_es2022_directive.mjs.js";var o="important",d=" !"+o,h=c(class extends a{constructor(s){if(super(s),s.type!==u.ATTRIBUTE||s.name!=="style"||s.strings?.length>2)throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.")}render(s){return Object.keys(s).reduce((n,t)=>{let e=s[t];return e==null?n:n+`${t=t.includes("-")?t:t.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g,"-$&").toLowerCase()}:${e};`},"")}update(s,[n]){let{style:t}=s.element;if(this.ft===void 0)return this.ft=new Set(Object.keys(n)),this.render(n);for(let e of this.ft)n[e]==null&&(this.ft.delete(e),e.includes("-")?t.removeProperty(e):t[e]=null);for(let e in n){let r=n[e];if(r!=null){this.ft.add(e);let i=typeof r=="string"&&r.endsWith(d);e.includes("-")||i?t.setProperty(e,i?r.slice(0,-11):r,i?o:""):t[e]=r}}return l}});export{h as styleMap};
/*! Bundled license information:

lit-html/directives/style-map.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
