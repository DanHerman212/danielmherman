/* esm.sh - @lit/reactive-element@2.1.2/decorators/query-async */
import{desc as n}from"./lit_reactive-element_2.1.2_es2022_decorators_base.mjs.js";function s(e){return(t,r)=>n(t,r,{async get(){return await this.updateComplete,this.renderRoot?.querySelector(e)??null}})}export{s as queryAsync};
/*! Bundled license information:

@lit/reactive-element/decorators/query-async.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
