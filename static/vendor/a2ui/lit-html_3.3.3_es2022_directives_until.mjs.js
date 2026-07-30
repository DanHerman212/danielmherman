/* esm.sh - lit-html@3.3.3/directives/until */
import{noChange as _}from"./lit-html_3.3.3_es2022_lit-html.mjs.js";import{isPrimitive as u}from"./lit-html_3.3.3_es2022_directive-helpers.mjs.js";import{AsyncDirective as p}from"./lit-html_3.3.3_es2022_async-directive.mjs.js";import{PseudoWeakRef as l,Pauser as w}from"./lit-html_3.3.3_es2022_directives_private-async-helpers.mjs.js";import{directive as g}from"./lit-html_3.3.3_es2022_directive.mjs.js";var $=n=>!u(n)&&typeof n.then=="function",d=1073741823,o=class extends p{constructor(){super(...arguments),this._$Cwt=d,this._$Cbt=[],this._$CK=new l(this),this._$CX=new w}render(...c){return c.find(e=>!$(e))??_}update(c,e){let h=this._$Cbt,C=h.length;this._$Cbt=e;let f=this._$CK,a=this._$CX;this.isConnected||this.disconnected();for(let t=0;t<e.length&&!(t>this._$Cwt);t++){let s=e[t];if(!$(s))return this._$Cwt=t,s;t<C&&s===h[t]||(this._$Cwt=d,C=0,Promise.resolve(s).then(async m=>{for(;a.get();)await a.get();let i=f.deref();if(i!==void 0){let r=i._$Cbt.indexOf(s);r>-1&&r<i._$Cwt&&(i._$Cwt=r,i.setValue(m))}}))}return _}disconnected(){this._$CK.disconnect(),this._$CX.pause()}reconnected(){this._$CK.reconnect(this),this._$CX.resume()}},x=g(o);export{o as UntilDirective,x as until};
/*! Bundled license information:

lit-html/directives/until.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
