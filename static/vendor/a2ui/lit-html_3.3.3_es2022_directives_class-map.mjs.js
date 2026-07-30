/* esm.sh - lit-html@3.3.3/directives/class-map */
import{noChange as i}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";import{directive as a,Directive as o,PartType as h}from"./lit-html_3.3.3_es2022_directive.mjs.js";var l=a(class extends o{constructor(s){if(super(s),s.type!==h.ATTRIBUTE||s.name!=="class"||s.strings?.length>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(s){return" "+Object.keys(s).filter(e=>s[e]).join(" ")+" "}update(s,[e]){if(this.st===void 0){this.st=new Set,s.strings!==void 0&&(this.nt=new Set(s.strings.join(" ").split(/\s/).filter(t=>t!=="")));for(let t in e)e[t]&&!this.nt?.has(t)&&this.st.add(t);return this.render(e)}let r=s.element.classList;for(let t of this.st)t in e||(r.remove(t),this.st.delete(t));for(let t in e){let n=!!e[t];n===this.st.has(t)||this.nt?.has(t)||(n?(r.add(t),this.st.add(t)):(r.remove(t),this.st.delete(t)))}return i}});export{l as classMap};
/*! Bundled license information:

lit-html/directives/class-map.js:
  (**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
