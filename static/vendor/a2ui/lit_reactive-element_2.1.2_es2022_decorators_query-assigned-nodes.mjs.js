/* esm.sh - @lit/reactive-element@2.1.2/decorators/query-assigned-nodes */
import{desc as n}from"./lit_reactive-element_2.1.2_es2022_decorators_base.mjs.js";function a(e){return(s,o)=>{let{slot:t}=e??{},r="slot"+(t?`[name=${t}]`:":not([name])");return n(s,o,{get(){return this.renderRoot?.querySelector(r)?.assignedNodes(e)??[]}})}}export{a as queryAssignedNodes};
/*! Bundled license information:

@lit/reactive-element/decorators/query-assigned-nodes.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
