/* esm.sh - @a2ui/lit@0.10.2/v0_9 */
import{GenericBinder as et}from"./a2ui_web_core__0.10.5_v0_9_external_zod_target_es2022.js";var g=class{constructor(s,i){this.host=s,this.binder=new et(this.host.context,i.schema),this.props=this.binder.snapshot,this.host.addController(this),this.host.isConnected&&this.hostConnected()}hostConnected(){this.subscription||(this.subscription=this.binder.subscribe(s=>{this.props=s,this.host.requestUpdate()}))}hostDisconnected(){this.subscription?.unsubscribe(),this.subscription=void 0}dispose(){this.binder.dispose()}};import{html as C,nothing as it,LitElement as ot}from"./lit_3.2.1.js";import{customElement as st,property as nt,state as lt}from"./lit_3.2.1_decorators.js";import{ComponentContext as ct}from"./a2ui_web_core__0.10.5_v0_9_external_zod_target_es2022.js";import{nothing as tt}from"./lit_3.2.1.js";import{html as rt,unsafeStatic as at}from"./lit_3.2.1_static-html.js";function E(n,s){let i=n.componentModel.type,e=s.components.get(i);if(!e)return console.warn(`Component implementation not found for type: ${i}`),tt;let r=at(e.tagName);return rt`<${r} .context=${n}></${r}>`}var x=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},_=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},ut=(()=>{let n=[st("a2ui-surface")],s,i=[],e,r=ot,f,t=[],l=[],v,c=[],o=[];var a=class extends r{static{e=this}constructor(){super(...arguments),this.#e=_(this,t,void 0),this.#t=(_(this,l),_(this,c,!1)),this.unsubscribe=_(this,o)}static{let b=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;f=[nt({type:Object})],v=[lt()],x(this,null,f,{kind:"accessor",name:"surface",static:!1,private:!1,access:{has:h=>"surface"in h,get:h=>h.surface,set:(h,m)=>{h.surface=m}},metadata:b},t,l),x(this,null,v,{kind:"accessor",name:"_hasRoot",static:!1,private:!1,access:{has:h=>"_hasRoot"in h,get:h=>h._hasRoot,set:(h,m)=>{h._hasRoot=m}},metadata:b},c,o),x(null,s={value:e},n,{kind:"class",name:e.name,metadata:b},null,i),a=e=s.value,b&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:b}),_(e,i)}#e;get surface(){return this.#e}set surface(b){this.#e=b}#t;get _hasRoot(){return this.#t}set _hasRoot(b){this.#t=b}willUpdate(b){if(b.has("surface")&&(this.unsubscribe&&(this.unsubscribe(),this.unsubscribe=void 0),this._hasRoot=!!this.surface?.componentsModel.get("root"),this.surface&&!this._hasRoot)){let h=this.surface.componentsModel.onCreated.subscribe(m=>{m.id==="root"&&(this._hasRoot=!0,this.requestUpdate(),this.unsubscribe?.(),this.unsubscribe=void 0)});this.unsubscribe=()=>h.unsubscribe()}}disconnectedCallback(){super.disconnectedCallback(),this.unsubscribe&&(this.unsubscribe(),this.unsubscribe=void 0)}render(){if(!this.surface)return it;if(!this._hasRoot)return C`<slot name="loading"><div>Loading surface...</div></slot>`;try{let b=new ct(this.surface,"root","/");return C`${E(b,this.surface.catalog)}`}catch(b){return console.error("Error creating root context:",b),C`<div>Error rendering surface</div>`}}};return a=e})();import{LitElement as ft,nothing as U}from"./lit_3.2.1.js";import{property as pt}from"./lit_3.2.1_decorators.js";import{ComponentContext as mt}from"./a2ui_web_core__0.10.5_v0_9_external_zod_target_es2022.js";var dt=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},R=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},A=(()=>{let n=ft,s,i=[],e=[];return class extends n{constructor(){super(...arguments),this.#e=R(this,i,void 0),this.controller=R(this,e)}static{let f=typeof Symbol=="function"&&Symbol.metadata?Object.create(n[Symbol.metadata]??null):void 0;s=[pt({type:Object})],dt(this,null,s,{kind:"accessor",name:"context",static:!1,private:!1,access:{has:t=>"context"in t,get:t=>t.context,set:(t,l)=>{t.context=l}},metadata:f},i,e),f&&Object.defineProperty(this,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:f})}#e;get context(){return this.#e}set context(f){this.#e=f}renderNode(f,t){if(!f)return U;let{surface:l,path:v}=this.context.dataContext;if(!!!l.componentsModel.get(this.context.componentModel.id))return U;let o,a=t;return typeof f=="object"?(o=f.id,a=a??f.basePath):o=f,a=a??v,E(new mt(l,o,a),l.catalog)}willUpdate(f){super.willUpdate(f),f.has("context")&&this.context&&(this.controller&&(this.removeController(this.controller),this.controller.dispose()),this.controller=this.createController())}}})();import{createContext as ht}from"./lit_context__1.1.6_target_es2022.js";var q=ht(Symbol("A2UIMarkdown"));var j={markdown:q};import{Catalog as oa}from"./a2ui_web_core__0.10.5_v0_9_external_zod_target_es2022.js";import{BASIC_FUNCTIONS as sa}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";import{html as W,nothing as kt,css as Et}from"./lit_3.2.1.js";import{customElement as xt}from"./lit_3.2.1_decorators.js";import{consume as Ct}from"./lit_context__1.1.6_target_es2022.js";import{TextApi as Y}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";import{injectBasicCatalogStyles as vt,computeColorVariant as O}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var y=class extends A{connectedCallback(){super.connectedCallback(),vt()}willUpdate(s){super.willUpdate(s);let i=this.controller?.props;i&&i.weight!==void 0?this.style.flex=String(i.weight):this.style.removeProperty("flex");let e=this.context?.theme?.primaryColor;e?(this.style.setProperty("--a2ui-color-primary",e),this.style.setProperty("--a2ui-color-primary-light",O("light",{colorVar:"--a2ui-color-primary"})),this.style.setProperty("--a2ui-color-primary-dark",O("dark",{colorVar:"--a2ui-color-primary"})),this.style.setProperty("--a2ui-color-primary-hover",O("hover",{darkVar:"--a2ui-color-primary-dark",lightVar:"--a2ui-color-primary-light"}))):(this.style.removeProperty("--a2ui-color-primary"),this.style.removeProperty("--a2ui-color-primary-light"),this.style.removeProperty("--a2ui-color-primary-dark"),this.style.removeProperty("--a2ui-color-primary-hover"))}};import{html as G,noChange as bt}from"./lit_3.2.1.js";import{Directive as gt,directive as yt}from"./lit_3.2.1_directive.js";import{unsafeHTML as _t}from"./lit_3.2.1_directives_unsafe-html.js";import{until as wt}from"./lit_3.2.1_directives_until.js";var S=class n extends gt{constructor(){super(...arguments),this.lastValue=null,this.lastTagClassMap=null}update(s,[i,e,r]){let f=JSON.stringify(r?.tagClassMap);return this.lastValue===i&&f===this.lastTagClassMap?bt:(this.lastValue=i,this.lastTagClassMap=f,this.render(i,e,r))}static{this.defaultMarkdownWarningLogged=!1}render(s,i,e){if(i){let r=i(s,e).then(f=>_t(f));return wt(r,G`<span class="no-markdown-renderer">${s}</span>`)}return n.defaultMarkdownWarningLogged||(console.warn("[MarkdownDirective]",`can't render markdown because no markdown renderer is configured.
`,"Use `@a2ui/markdown-it`, or your own markdown renderer."),n.defaultMarkdownWarningLogged=!0),G`<span class="no-markdown-renderer">${s}</span>`}},D=yt(S);var J=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},T=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Ya=(()=>{let n=[xt("a2ui-basic-text")],s,i=[],e,r=y,f,t=[],l=[];var v=class extends r{static{e=this}static{let c=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;f=[Ct({context:j.markdown,subscribe:!0})],J(this,null,f,{kind:"accessor",name:"markdownRenderer",static:!1,private:!1,access:{has:o=>"markdownRenderer"in o,get:o=>o.markdownRenderer,set:(o,a)=>{o.markdownRenderer=a}},metadata:c},t,l),J(null,s={value:e},n,{kind:"class",name:e.name,metadata:c},null,i),v=e=s.value,c&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:c})}static{this.styles=Et`
    :host {
      display: inline-block;
      color: var(--_a2ui-text-color, var(--a2ui-text-color-text, var(--a2ui-color-on-background)));
    }
    p,
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    ol,
    ul,
    li,
    blockquote,
    pre {
      margin: var(--_a2ui-text-margin, 0);
    }
    h1,
    h2,
    h3,
    h4,
    h5 {
      font-family: var(--a2ui-font-family-title, inherit);
      line-height: var(--a2ui-line-height-headings, 1.2);
    }
    h1 {
      font-size: var(--a2ui-font-size-2xl);
    }
    h2 {
      font-size: var(--a2ui-font-size-xl);
    }
    h3 {
      font-size: var(--a2ui-font-size-l);
    }
    p,
    h4 {
      font-size: var(--a2ui-font-size-m);
    }
    h5 {
      font-size: var(--a2ui-font-size-s);
    }
    p,
    ol,
    ul,
    li,
    blockquote,
    .a2ui-caption {
      line-height: var(--a2ui-line-height-body, 1.5);
    }
    .a2ui-caption,
    .a2ui-caption > *,
    .a2ui-caption ::slotted(*) {
      font-size: var(--a2ui-font-size-xs);
      color: var(--a2ui-text-caption-color, light-dark(#666, #aaa));
    }
    a {
      color: var(--a2ui-text-a-color, inherit);
      font-weight: var(--a2ui-text-a-font-weight, inherit);
    }
  `}#e=T(this,t,void 0);get markdownRenderer(){return this.#e}set markdownRenderer(c){this.#e=c}createController(){return new g(this,Y)}render(){let c=this.controller.props;if(!c)return kt;let o=typeof c.text=="string"?c.text:String(c.text??"");switch(c.variant){case"h1":o=`# ${o}`;break;case"h2":o=`## ${o}`;break;case"h3":o=`### ${o}`;break;case"h4":o=`#### ${o}`;break;case"h5":o=`##### ${o}`;break;default:break}let a=D(o,this.markdownRenderer);return c.variant==="caption"?W`<span class="a2ui-caption">${a}</span>`:W`${a}`}constructor(){super(...arguments),T(this,l)}static{T(e,i)}};return v=e})();var H={...Y,tagName:"a2ui-basic-text"};import{html as Z,nothing as K,css as Ot}from"./lit_3.2.1.js";import{customElement as St}from"./lit_3.2.1_decorators.js";import{classMap as Dt}from"./lit_3.2.1_directives_class-map.js";import{ButtonApi as Q}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var At=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},jt=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},ri=(()=>{let n=[St("a2ui-basic-button")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;At(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Ot`
    :host {
      display: inline-block;
      margin: var(--a2ui-button-margin, var(--a2ui-spacing-m));
    }
    :where(:host) {
      --_color-primary: var(--a2ui-color-primary, #17e);
      --_button-border-radius: var(--a2ui-button-border-radius, var(--a2ui-spacing-s, 0.25rem));
      --_button-padding: var(
        --a2ui-button-padding,
        var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem)
      );
      --_button-border: var(
        --a2ui-button-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
    }
    .a2ui-button {
      --_a2ui-text-margin: 0;
      --_a2ui-text-color: var(--a2ui-color-on-secondary, #333);
      padding: var(--_button-padding);
      background: var(--a2ui-button-background, var(--a2ui-color-surface, #fff));
      box-shadow: var(--a2ui-button-box-shadow, none);
      font-weight: var(--a2ui-button-font-weight, normal);
      color: var(--_a2ui-text-color);
      border: var(--_button-border);
      border-radius: var(--_button-border-radius);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .a2ui-button.a2ui-button-primary {
      --_a2ui-text-color: var(--a2ui-color-on-primary, #fff);
      background-color: var(--_color-primary);
      color: var(--_a2ui-text-color);
    }
    .a2ui-button:hover {
      background-color: var(--a2ui-color-secondary-hover, #ddd);
    }
    .a2ui-button.a2ui-button-primary:hover {
      background-color: var(--a2ui-color-primary-hover, #fbd);
    }
    .a2ui-button.a2ui-button-borderless {
      background: none;
      padding: 0;
      color: var(--_color-primary);
    }
  `}createController(){return new g(this,Q)}render(){let t=this.controller.props;if(!t)return K;let l=t.isValid===!1,v={"a2ui-button":!0,["a2ui-button-"+(t.variant||"default")]:!0};return Z`
      <button
        class=${Dt(v)}
        @click=${()=>!l&&t.action&&t.action()}
        ?disabled=${l}
      >
        ${t.child?Z`${this.renderNode(t.child)}`:K}
      </button>
    `}static{jt(e,i)}};return f=e})();var X={...Q,tagName:"a2ui-basic-button"};import{html as w,nothing as z,css as $t}from"./lit_3.2.1.js";import{customElement as Pt}from"./lit_3.2.1_decorators.js";import{classMap as I}from"./lit_3.2.1_directives_class-map.js";import{TextFieldApi as ee}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Tt=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},zt=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},di=(()=>{let n=[Pt("a2ui-basic-textfield")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Tt(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=$t`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
    }
    .a2ui-textfield {
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      border: var(--a2ui-textfield-border, var(--a2ui-border));
      border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m));
      padding: var(--a2ui-textfield-padding, var(--a2ui-spacing-m));
      font-family: inherit;
    }
    .a2ui-textfield:focus {
      outline: none;
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
    }
    .a2ui-textfield.invalid {
      border-color: var(--a2ui-textfield-color-error, red);
    }
    label {
      font-size: var(
        --a2ui-textfield-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-textfield-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    .error {
      color: var(--a2ui-textfield-color-error, red);
      font-size: var(--a2ui-font-size-xs, 0.75rem);
    }
  `}createController(){return new g(this,ee)}render(){let t=this.controller.props;if(!t)return z;let l=t.isValid===!1,v=a=>t.setValue?.(a.target.value),c="text";t.variant==="number"&&(c="number"),t.variant==="obscured"&&(c="password");let o={"a2ui-textfield":!0,invalid:l};return w`
      ${t.label?w`<label>${t.label}</label>`:z}
      ${t.variant==="longText"?w`<textarea
            class=${I(o)}
            .value=${t.value||""}
            @input=${v}
          ></textarea>`:w`<input
            type=${c}
            class=${I(o)}
            .value=${t.value||""}
            @input=${v}
          />`}
      ${l&&t.validationErrors?.length?w`<div class="error">${t.validationErrors[0]}</div>`:z}
    `}static{zt(e,i)}};return f=e})();var te={...ee,tagName:"a2ui-basic-textfield"};import{html as re,nothing as Bt,css as Nt}from"./lit_3.2.1.js";import{customElement as Mt}from"./lit_3.2.1_decorators.js";import{map as Ft}from"./lit_3.2.1_directives_map.js";import{RowApi as ae}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Vt=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Lt=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Rt={start:"flex-start",center:"center",end:"flex-end",spaceBetween:"space-between",spaceAround:"space-around",spaceEvenly:"space-evenly",stretch:"stretch"},Ut={start:"flex-start",center:"center",end:"flex-end",stretch:"stretch"},_i=(()=>{let n=[Mt("a2ui-basic-row")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Vt(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Nt`
    :host {
      display: flex;
      flex-direction: row;
      gap: var(--a2ui-row-gap, var(--a2ui-spacing-m));
    }
  `}createController(){return new g(this,ae)}updated(t){super.updated(t);let l=this.controller.props;l&&(this.style.justifyContent=Rt[l.justify??""]??"flex-start",this.style.alignItems=Ut[l.align??""]??"stretch")}render(){let t=this.controller.props;if(!t)return Bt;let l=Array.isArray(t.children)?t.children:[];return re` ${Ft(l,v=>re`${this.renderNode(v)}`)} `}static{Lt(e,i)}};return f=e})();var ie={...ae,tagName:"a2ui-basic-row"};import{html as oe,nothing as Jt,css as Wt}from"./lit_3.2.1.js";import{customElement as Yt}from"./lit_3.2.1_decorators.js";import{map as Ht}from"./lit_3.2.1_directives_map.js";import{ColumnApi as se}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var qt=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Gt=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Zt={start:"flex-start",center:"center",end:"flex-end",spaceBetween:"space-between",spaceAround:"space-around",spaceEvenly:"space-evenly",stretch:"stretch"},Kt={start:"flex-start",center:"center",end:"flex-end",stretch:"stretch"},Si=(()=>{let n=[Yt("a2ui-basic-column")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;qt(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Wt`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-column-gap, var(--a2ui-spacing-m));
    }
  `}createController(){return new g(this,se)}updated(t){super.updated(t);let l=this.controller.props;l&&(this.style.justifyContent=Zt[l.justify??""]??"flex-start",this.style.alignItems=Kt[l.align??""]??"stretch")}render(){let t=this.controller.props;if(!t)return Jt;let l=Array.isArray(t.children)?t.children:[];return oe` ${Ht(l,v=>oe`${this.renderNode(v)}`)} `}static{Gt(e,i)}};return f=e})();var ne={...se,tagName:"a2ui-basic-column"};import{html as le,nothing as It,css as er}from"./lit_3.2.1.js";import{customElement as tr}from"./lit_3.2.1_decorators.js";import{map as rr}from"./lit_3.2.1_directives_map.js";import{ListApi as ce}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Qt=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Xt=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Ni=(()=>{let n=[tr("a2ui-list")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Qt(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=er`
    :host {
      display: flex;
      overflow: auto;
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 0.5rem));
      padding: var(--a2ui-list-padding, 0);
    }
  `}createController(){return new g(this,ce)}updated(t){super.updated(t);let l=this.controller.props;l&&(this.style.flexDirection=l.direction==="horizontal"?"row":"column")}render(){let t=this.controller.props;if(!t)return It;let l=Array.isArray(t.children)?t.children:[];return le`${rr(l,v=>le`${this.renderNode(v)}`)}`}static{Xt(e,i)}};return f=e})();var ue={...ce,tagName:"a2ui-list"};import{html as or,nothing as sr,css as nr}from"./lit_3.2.1.js";import{customElement as lr}from"./lit_3.2.1_decorators.js";import{classMap as cr}from"./lit_3.2.1_directives_class-map.js";import{styleMap as ur}from"./lit_3.2.1_directives_style-map.js";import{ImageApi as de}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var ar=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},ir=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Hi=(()=>{let n=[lr("a2ui-image")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;ar(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=nr`
    img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--a2ui-image-border-radius, 0);
    }
    :host(.icon),
    img.icon {
      width: var(--a2ui-image-icon-size, 24px);
      height: var(--a2ui-image-icon-size, 24px);
    }
    img.avatar {
      width: var(--a2ui-image-avatar-size, 40px);
      height: var(--a2ui-image-avatar-size, 40px);
      border-radius: 50%;
    }
    :host(.smallFeature),
    img.smallFeature {
      max-width: var(--a2ui-image-small-feature-size, 100px);
    }
    :host(.largeFeature),
    img.largeFeature {
      max-height: var(--a2ui-image-large-feature-size, 400px);
    }
    :host(.header),
    img.header {
      height: var(--a2ui-image-header-size, 200px);
      object-fit: cover;
    }
  `}createController(){return new g(this,de)}render(){let t=this.controller.props;if(!t)return sr;let l={"a2ui-image":!0,[t.variant||""]:!!t.variant},v={objectFit:t.fit||"fill"};return or`<img
      src=${t.url}
      alt=${t.description||""}
      class=${cr(l)}
      style=${ur(v)}
    />`}static{ir(e,i)}};return f=e})();var fe={...de,tagName:"a2ui-image"};import{html as pe,nothing as pr,css as mr}from"./lit_3.2.1.js";import{customElement as hr}from"./lit_3.2.1_decorators.js";import{IconApi as he}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var dr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},fr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},me={play:"play_arrow",rewind:"fast_rewind",favoriteOff:"favorite_border",starOff:"star_border"};function vr(n){return me[n]?me[n]:n.replace(/[A-Z]/g,s=>"_"+s.toLowerCase())}var ro=(()=>{let n=[hr("a2ui-icon")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;dr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=mr`
    :where(:host) {
      --_icon-size: var(--a2ui-icon-size, var(--a2ui-font-size-xl, 24px));
    }
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .material-symbol {
      font-family: var(--a2ui-icon-font-family, 'Material Symbols Outlined', sans-serif);
      font-size: var(--_icon-size);
      font-weight: normal;
      font-style: normal;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      color: var(--a2ui-icon-color, inherit);
      font-variation-settings: var(--a2ui-icon-font-variation-settings, 'FILL' 1);
    }
    .svg {
      fill: currentColor;
      width: var(--_icon-size);
      height: var(--_icon-size);
    }
  `}createController(){return new g(this,he)}render(){let t=this.controller.props;if(!t)return pr;let l=t.name;if(typeof l=="object"&&l!==null&&"svgPath"in l){let o=l.svgPath;return pe`<svg class="svg" viewBox="0 0 24 24"><path d=${o}></path></svg>`}let c=typeof l=="string"?vr(l):"";return pe`<span class="material-symbol">${c}</span>`}static{fr(e,i)}};return f=e})();var ve={...he,tagName:"a2ui-icon"};import{html as yr,nothing as _r,css as wr}from"./lit_3.2.1.js";import{customElement as kr}from"./lit_3.2.1_decorators.js";import{VideoApi as be}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var br=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},gr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},uo=(()=>{let n=[kr("a2ui-video")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;br(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=wr`
    :host {
      display: block;
      width: 100%;
    }
    video {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--a2ui-video-border-radius, 0);
    }
  `}createController(){return new g(this,be)}render(){let t=this.controller.props;return t?yr`<video src=${t.url} controls class="a2ui-video"></video>`:_r}static{gr(e,i)}};return f=e})();var ge={...be,tagName:"a2ui-video"};import{html as ye,nothing as _e,css as Cr}from"./lit_3.2.1.js";import{customElement as Ar}from"./lit_3.2.1_decorators.js";import{AudioPlayerApi as we}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Er=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},xr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},yo=(()=>{let n=[Ar("a2ui-audioplayer")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Er(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Cr`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      background: var(--a2ui-audioplayer-background, transparent);
      border-radius: var(--a2ui-audioplayer-border-radius, 0);
      padding: var(--a2ui-audioplayer-padding, 0);
    }
  `}createController(){return new g(this,we)}render(){let t=this.controller.props;return t?ye`
      ${t.description?ye`<p>${t.description}</p>`:_e}
      <audio src=${t.url} controls></audio>
    `:_e}static{xr(e,i)}};return f=e})();var ke={...we,tagName:"a2ui-audioplayer"};import{html as Ee,nothing as xe,css as Sr}from"./lit_3.2.1.js";import{customElement as Dr}from"./lit_3.2.1_decorators.js";import{CardApi as Ce}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var jr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Or=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},jo=(()=>{let n=[Dr("a2ui-card")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;jr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Sr`
    :host {
      display: block;
      border: var(
        --a2ui-card-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      border-radius: var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px));
      padding: var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px));
      background: var(--a2ui-card-background, var(--a2ui-color-surface, #fff));
      color: var(--a2ui-color-on-surface, #333);
      box-shadow: var(--a2ui-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
      margin: var(--a2ui-card-margin, var(--a2ui-spacing-m));
    }
  `}createController(){return new g(this,Ce)}render(){let t=this.controller.props;return t?Ee` ${t.child?Ee`${this.renderNode(t.child)}`:xe} `:xe}static{Or(e,i)}};return f=e})();var Ae={...Ce,tagName:"a2ui-card"};import{html as je,nothing as $r,css as Pr}from"./lit_3.2.1.js";import{customElement as Vr}from"./lit_3.2.1_decorators.js";import{classMap as Oe}from"./lit_3.2.1_directives_class-map.js";import{DividerApi as Se}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Tr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},zr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Lo=(()=>{let n=[Vr("a2ui-divider")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Tr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Pr`
    :host {
      display: block;
      align-self: stretch;
    }
    .a2ui-divider.horizontal {
      height: 0;
      overflow: hidden;
      font-size: 0.1px;
      line-height: 0;
      border: 0;
      border-top: var(
        --a2ui-divider-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin: var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem)) 0;
      width: 100%;
    }
    .a2ui-divider.vertical {
      width: var(--a2ui-border-width, 1px);
      background-color: var(--a2ui-color-border, #ccc);
      height: 100%;
      margin: 0 var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 0.5rem));
    }
  `}createController(){return new g(this,Se)}render(){let t=this.controller.props;if(!t)return $r;let l={"a2ui-divider":!0,vertical:t.axis==="vertical",horizontal:t.axis!=="vertical"};return t.axis==="vertical"?je`<div class=${Oe(l)}></div>`:je`<hr class=${Oe(l)} />`}static{zr(e,i)}};return f=e})();var De={...Se,tagName:"a2ui-divider"};import{html as Te,nothing as ze,css as Nr}from"./lit_3.2.1.js";import{customElement as Mr}from"./lit_3.2.1_decorators.js";import{classMap as $e}from"./lit_3.2.1_directives_class-map.js";import{CheckBoxApi as Pe}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Lr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Br=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Jo=(()=>{let n=[Mr("a2ui-checkbox")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Lr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Nr`
    :host {
      display: block;
    }
    .container {
      display: flex;
      flex-direction: column;
      margin: var(--a2ui-checkbox-margin, var(--a2ui-spacing-m));
    }
    label.a2ui-checkbox {
      display: inline-flex;
      align-items: center;
      gap: var(--a2ui-checkbox-gap, var(--a2ui-spacing-s, 0.5rem));
      font-size: var(
        --a2ui-checkbox-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-checkbox-label-font-weight, var(--a2ui-label-font-weight, bold));
      cursor: pointer;
    }
    label.invalid {
      color: var(--a2ui-checkbox-color-error, red);
    }
    input {
      width: var(--a2ui-checkbox-size, 1rem);
      height: var(--a2ui-checkbox-size, 1rem);
      background: var(--a2ui-checkbox-background, inherit);
      border: var(--a2ui-checkbox-border, var(--a2ui-border));
      border-radius: var(--a2ui-checkbox-border-radius, 4px);
    }
    input.invalid {
      outline: 1px solid var(--a2ui-checkbox-color-error, red);
    }
    .error {
      color: var(--a2ui-checkbox-color-error, red);
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      margin-top: 4px;
    }
  `}createController(){return new g(this,Pe)}render(){let t=this.controller.props;if(!t)return ze;let l=t.isValid===!1,v={"a2ui-checkbox":!0,invalid:l},c={invalid:l};return Te`
      <div class="container">
        <label class=${$e(v)}>
          <input
            type="checkbox"
            class=${$e(c)}
            .checked=${t.value||!1}
            @change=${o=>t.setValue?.(o.target.checked)}
          />
          ${t.label}
        </label>
        ${l&&t.validationErrors?.length?Te`<div class="error">${t.validationErrors[0]}</div>`:ze}
      </div>
    `}static{Br(e,i)}};return f=e})();var Ve={...Pe,tagName:"a2ui-checkbox"};import{html as Le,nothing as Be,css as Ur}from"./lit_3.2.1.js";import{customElement as qr}from"./lit_3.2.1_decorators.js";import{SliderApi as Ne}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Fr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Rr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Io=(()=>{let n=[qr("a2ui-slider")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Fr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Ur`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      margin: var(--a2ui-slider-margin, var(--a2ui-spacing-m));
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header label {
      font-size: var(
        --a2ui-slider-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-slider-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--a2ui-slider-thumb-color, var(--a2ui-color-primary, #007bff));
      background: var(--a2ui-slider-track-color, var(--a2ui-color-secondary, #e9ecef));
    }
  `}createController(){return new g(this,Ne)}render(){let t=this.controller.props;return t?Le`
      <div class="header">
        ${t.label?Le`<label>${t.label}</label>`:Be}
        <span>${t.value}</span>
      </div>
      <input
        type="range"
        min=${t.min??0}
        max=${t.max??100}
        .value=${t.value?.toString()||"0"}
        @input=${l=>t.setValue?.(Number(l.target.value))}
      />
    `:Be}static{Rr(e,i)}};return f=e})();var Me={...Ne,tagName:"a2ui-slider"};import{html as Fe,nothing as $,css as Wr}from"./lit_3.2.1.js";import{customElement as Yr}from"./lit_3.2.1_decorators.js";import{DateTimeInputApi as Re}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Gr=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},Jr=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0};function Hr(n,s){if(!n)return"";let i=n.includes("T"),e=n.split("T"),r=(i?e[0]:n)?.substring(0,10)??"",f=(i?e[1]:n)?.substring(0,5)??"";switch(s){case"date":return r;case"time":return f;case"datetime-local":return`${r}T${f}`}return""}var ns=(()=>{let n=[Yr("a2ui-datetimeinput")],s,i=[],e,r=y;var f=class extends r{static{e=this}static{let t=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;Gr(null,s={value:e},n,{kind:"class",name:e.name,metadata:t},null,i),f=e=s.value,t&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:t})}static{this.styles=Wr`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
    }
    input {
      background-color: var(--a2ui-datetimeinput-background, var(--a2ui-color-input, #fff));
      color: var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333));
      border: var(--a2ui-datetimeinput-border, var(--a2ui-border));
      border-radius: var(--a2ui-datetimeinput-border-radius, var(--a2ui-border-radius));
      padding: var(--a2ui-datetimeinput-padding, var(--a2ui-spacing-s));
    }
    .a2ui-date-time-input::-webkit-datetime-edit,
    .a2ui-date-time-input::-webkit-datetime-edit-fields-wrapper {
      color: var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333));
    }
    label {
      font-size: var(
        --a2ui-datetimeinput-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-datetimeinput-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
  `}createController(){return new g(this,Re)}render(){let t=this.controller.props;if(!t)return $;if(!(t.enableDate||t.enableTime))return $;let l=t.enableDate&&t.enableTime?"datetime-local":t.enableDate?"date":"time",v=Hr(t.value,l);return Fe`
      ${t.label?Fe`<label>${t.label}</label>`:$}
      <input
        class="a2ui-date-time-input"
        type=${l}
        .value=${v}
        @input=${c=>t.setValue?.(c.target.value)}
      />
    `}static{Jr(e,i)}};return f=e})();var Ue={...Re,tagName:"a2ui-datetimeinput"};import{html as k,nothing as V,css as Zr}from"./lit_3.2.1.js";import{customElement as Kr,state as Qr}from"./lit_3.2.1_decorators.js";import{classMap as Ge}from"./lit_3.2.1_directives_class-map.js";import{ChoicePickerApi as Je}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var qe=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},P=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},vs=(()=>{let n=[Kr("a2ui-choicepicker")],s,i=[],e,r=y,f,t=[],l=[];var v=class extends r{static{e=this}static{let c=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;f=[Qr()],qe(this,null,f,{kind:"accessor",name:"filter",static:!1,private:!1,access:{has:o=>"filter"in o,get:o=>o.filter,set:(o,a)=>{o.filter=a}},metadata:c},t,l),qe(null,s={value:e},n,{kind:"class",name:e.name,metadata:c},null,i),v=e=s.value,c&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:c})}static{this.styles=Zr`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      padding: var(--a2ui-choicepicker-padding, 0);
    }
    .options {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    label {
      color: var(--a2ui-choicepicker-label-color, inherit);
      font-size: var(--a2ui-choicepicker-label-font-size, inherit);
    }
    :host > label {
      font-size: var(
        --a2ui-choicepicker-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-choicepicker-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    .filter-input {
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      border: var(--a2ui-textfield-border, var(--a2ui-border));
      border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m));
      padding: var(
        --a2ui-choicepicker-filter-padding,
        var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px)
      );
      font-family: inherit;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
    }
    .chips {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    .chip {
      padding: var(
        --a2ui-choicepicker-chip-padding,
        var(--a2ui-spacing-s, 4px) var(--a2ui-spacing-m, 8px)
      );
      border-radius: var(--a2ui-choicepicker-chip-border-radius, 999px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      background-color: var(--a2ui-color-surface, #fff);
      color: var(--a2ui-color-on-surface, inherit);
      cursor: pointer;
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      font-family: inherit;
    }
    .chip.selected {
      background-color: var(--a2ui-color-primary, #007bff);
      color: var(--a2ui-color-on-primary, #fff);
      border-color: var(--a2ui-color-primary, #007bff);
    }
  `}#e=P(this,t,"");get filter(){return this.#e}set filter(c){this.#e=c}createController(){return new g(this,Je)}render(){let c=this.controller.props;if(!c)return V;let o=Array.isArray(c.value)?c.value:[],a=c.variant==="multipleSelection",b=c.displayStyle==="chips",h=d=>{c.setValue&&(a?o.includes(d)?c.setValue(o.filter(u=>u!==d)):c.setValue([...o,d]):c.setValue([d]))},m=(c.options||[]).filter(d=>!c.filterable||this.filter===""||String(d.label).toLowerCase().includes(this.filter.toLowerCase()));return k`
      ${c.label?k`<label>${c.label}</label>`:V}
      ${c.filterable?k`
            <input
              type="text"
              class="filter-input"
              placeholder="Filter options..."
              aria-label="Filter options"
              .value=${this.filter}
              @input=${d=>this.filter=d.target.value}
            />
          `:V}
      <div class=${Ge({options:!0,chips:b})}>
        ${m.map(d=>b?k`
                <button
                  class=${Ge({chip:!0,selected:o.includes(d.value)})}
                  aria-pressed=${o.includes(d.value)}
                  @click=${()=>h(d.value)}
                >
                  ${d.label}
                </button>
              `:k`
                <label>
                  <input
                    type=${a?"checkbox":"radio"}
                    .checked=${o.includes(d.value)}
                    @change=${()=>h(d.value)}
                  />
                  ${d.label}
                </label>
              `)}
      </div>
    `}constructor(){super(...arguments),P(this,l)}static{P(e,i)}};return v=e})();var We={...Je,tagName:"a2ui-choicepicker"};import{html as B,nothing as He,css as Xr}from"./lit_3.2.1.js";import{customElement as Ir,state as ea}from"./lit_3.2.1_decorators.js";import{classMap as ta}from"./lit_3.2.1_directives_class-map.js";import{TabsApi as Ze}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Ye=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},L=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},Cs=(()=>{let n=[Ir("a2ui-tabs")],s,i=[],e,r=y,f,t=[],l=[];var v=class extends r{static{e=this}static{let c=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;f=[ea()],Ye(this,null,f,{kind:"accessor",name:"activeIndex",static:!1,private:!1,access:{has:o=>"activeIndex"in o,get:o=>o.activeIndex,set:(o,a)=>{o.activeIndex=a}},metadata:c},t,l),Ye(null,s={value:e},n,{kind:"class",name:e.name,metadata:c},null,i),v=e=s.value,c&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:c})}static{this.styles=Xr`
    :host {
      display: block;
    }
    .a2ui-tabs-headers {
      display: flex;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      border-bottom: var(
        --a2ui-tabs-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin-bottom: var(--a2ui-spacing-m, 0.5rem);
    }
    .a2ui-tabs-header {
      padding: var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem);
      background: var(--a2ui-tabs-header-background, transparent);
      color: var(--a2ui-tabs-header-color, var(--a2ui-color-on-surface));
      border: none;
      border-radius: var(--a2ui-border-radius, 0.25rem) var(--a2ui-border-radius, 0.25rem) 0 0;
      cursor: pointer;
      font-family: inherit;
    }
    .a2ui-tabs-header.active {
      background: var(--a2ui-tabs-header-background-active, var(--a2ui-color-secondary, #eee));
      color: var(--a2ui-tabs-header-color-active, var(--a2ui-color-on-secondary, #333));
    }
    .a2ui-tabs-content {
      padding: var(--a2ui-tabs-content-padding, 0 var(--a2ui-spacing-m, 0.5rem));
    }
  `}createController(){return new g(this,Ze)}#e=L(this,t,0);get activeIndex(){return this.#e}set activeIndex(c){this.#e=c}render(){let c=this.controller.props;return!c||!c.tabs?He:B`
      <div class="a2ui-tabs-headers">
        ${c.tabs.map((o,a)=>B`
            <button
              class=${ta({"a2ui-tabs-header":!0,"a2ui-tab-button":!0,active:a===this.activeIndex})}
              @click=${()=>this.activeIndex=a}
            >
              ${o.title}
            </button>
          `)}
      </div>
      <div class="a2ui-tabs-content">
        ${c.tabs[this.activeIndex]?B`${this.renderNode(c.tabs[this.activeIndex].child)}`:He}
      </div>
    `}constructor(){super(...arguments),L(this,l)}static{L(e,i)}};return v=e})();var Ke={...Ze,tagName:"a2ui-tabs"};import{html as M,nothing as F,css as ra}from"./lit_3.2.1.js";import{customElement as aa,query as ia}from"./lit_3.2.1_decorators.js";import{ModalApi as Xe}from"./a2ui_web_core__0.10.5_v0_9_basic_catalog_external_zod_target_es2022.js";var Qe=function(n,s,i,e,r,f){function t(p){if(p!==void 0&&typeof p!="function")throw new TypeError("Function expected");return p}for(var l=e.kind,v=l==="getter"?"get":l==="setter"?"set":"value",c=!s&&n?e.static?n:n.prototype:null,o=s||(c?Object.getOwnPropertyDescriptor(c,e.name):{}),a,b=!1,h=i.length-1;h>=0;h--){var m={};for(var d in e)m[d]=d==="access"?{}:e[d];for(var d in e.access)m.access[d]=e.access[d];m.addInitializer=function(p){if(b)throw new TypeError("Cannot add initializers after decoration has completed");f.push(t(p||null))};var u=(0,i[h])(l==="accessor"?{get:o.get,set:o.set}:o[v],m);if(l==="accessor"){if(u===void 0)continue;if(u===null||typeof u!="object")throw new TypeError("Object expected");(a=t(u.get))&&(o.get=a),(a=t(u.set))&&(o.set=a),(a=t(u.init))&&r.unshift(a)}else(a=t(u))&&(l==="field"?r.unshift(a):o[v]=a)}c&&Object.defineProperty(c,e.name,o),b=!0},N=function(n,s,i){for(var e=arguments.length>2,r=0;r<s.length;r++)i=e?s[r].call(n,i):s[r].call(n);return e?i:void 0},$s=(()=>{let n=[aa("a2ui-modal")],s,i=[],e,r=y,f,t=[],l=[];var v=class extends r{static{e=this}static{let c=typeof Symbol=="function"&&Symbol.metadata?Object.create(r[Symbol.metadata]??null):void 0;f=[ia("dialog")],Qe(this,null,f,{kind:"accessor",name:"dialog",static:!1,private:!1,access:{has:o=>"dialog"in o,get:o=>o.dialog,set:(o,a)=>{o.dialog=a}},metadata:c},t,l),Qe(null,s={value:e},n,{kind:"class",name:e.name,metadata:c},null,i),v=e=s.value,c&&Object.defineProperty(e,Symbol.metadata,{enumerable:!0,configurable:!0,writable:!0,value:c})}static{this.styles=ra`
    :host {
      display: inline-block;
    }
    dialog {
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-modal-border-radius, 8px);
      padding: var(--a2ui-modal-padding, 24px);
      min-width: 300px;
      background: var(--a2ui-color-surface, #fff);
    }
    dialog::backdrop {
      background: var(--a2ui-modal-backdrop-bg, rgba(0, 0, 0, 0.5));
    }
  `}createController(){return new g(this,Xe)}#e=N(this,t,void 0);get dialog(){return this.#e}set dialog(c){this.#e=c}render(){let c=this.controller.props;return c?M`
      <div
        @click=${()=>this.dialog?.showModal()}
        class="a2ui-modal-trigger"
        style="display: contents;"
      >
        ${c.trigger?M`${this.renderNode(c.trigger)}`:F}
      </div>
      <dialog class="a2ui-modal a2ui-modal-overlay">
        <form method="dialog" style="text-align: right;">
          <button class="a2ui-modal-close">×</button>
        </form>
        ${c.content?M`${this.renderNode(c.content)}`:F}
      </dialog>
    `:F}constructor(){super(...arguments),N(this,l)}static{N(e,i)}};return v=e})();var Ie={...Xe,tagName:"a2ui-modal"};var na=new oa("https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",[H,X,te,ie,ne,ue,fe,ve,ge,ke,Ae,De,Ve,Me,Ue,We,Ke,Ie],sa);export{g as A2uiController,A as A2uiLitElement,ut as A2uiSurface,j as Context,na as basicCatalog};
