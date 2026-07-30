/* esm.sh - lit-element@4.2.2/lit-element */
import{ReactiveElement as o}from"./lit_reactive-element__2.1.0_target_es2022.js";export*from"./lit_reactive-element__2.1.0_target_es2022.js";import{render as i,noChange as d}from"./lit-html__3.3.0_target_es2022.js";export*from"./lit-html__3.3.0_target_es2022.js";var s=globalThis,t=class extends o{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let r=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=i(r,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return d}};t._$litElement$=!0,t.finalized=!0,s.litElementHydrateSupport?.({LitElement:t});var l=s.litElementPolyfillSupport;l?.({LitElement:t});var p={_$AK:(n,e,r)=>{n._$AK(e,r)},_$AL:n=>n._$AL};(s.litElementVersions??=[]).push("4.2.2");export{t as LitElement,p as _$LE};
/*! Bundled license information:

lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
