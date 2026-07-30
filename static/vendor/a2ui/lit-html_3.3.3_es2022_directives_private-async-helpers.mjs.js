/* esm.sh - lit-html@3.3.3/directives/private-async-helpers */
var r=async(t,s)=>{for await(let o of t)if(await s(o)===!1)return},i=class{constructor(s){this.G=s}disconnect(){this.G=void 0}reconnect(s){this.G=s}deref(){return this.G}},e=class{constructor(){this.Y=void 0,this.Z=void 0}get(){return this.Y}pause(){this.Y??=new Promise(s=>this.Z=s)}resume(){this.Z?.(),this.Y=this.Z=void 0}};export{e as Pauser,i as PseudoWeakRef,r as forAwaitOf};
/*! Bundled license information:

lit-html/directives/private-async-helpers.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
