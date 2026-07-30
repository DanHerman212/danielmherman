/* esm.sh - lit-html@3.3.3/directives/unsafe-html */
import{nothing as s,noChange as r}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";import{directive as n,Directive as o,PartType as a}from"./lit-html_3.3.3_es2022_directive.mjs.js";var i=class extends o{constructor(t){if(super(t),this.it=s,t.type!==a.CHILD)throw Error(this.constructor.directiveName+"() can only be used in child bindings")}render(t){if(t===s||t==null)return this._t=void 0,this.it=t;if(t===r)return t;if(typeof t!="string")throw Error(this.constructor.directiveName+"() called with a non-string value");if(t===this.it)return this._t;this.it=t;let e=[t];return e.raw=e,this._t={_$litType$:this.constructor.resultType,strings:e,values:[]}}};i.directiveName="unsafeHTML",i.resultType=1;var l=n(i);export{i as UnsafeHTMLDirective,l as unsafeHTML};
/*! Bundled license information:

lit-html/directives/unsafe-html.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
