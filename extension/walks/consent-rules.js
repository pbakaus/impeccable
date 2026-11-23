/*! @duckduckgo/autoconsent 17.2.0, MPL-2.0 (https://mozilla.org/MPL/2.0/), https://github.com/duckduckgo/autoconsent (unmodified below the bridge) */
if (!globalThis.__impeccableConsent) {
(function consentBridge(rules, config) {
  const w = globalThis;
  if (w.__impeccableConsent)
    return;
  const state = { cmp: null, popup: !1, result: null, done: !1, error: null, since: typeof performance === "object" ? performance.now() : 0 };
  w.__impeccableConsent = state;
  const reply = (message) => Promise.resolve().then(() => typeof w.autoconsentReceiveMessage === "function" ? w.autoconsentReceiveMessage(message) : void 0);
  w.autoconsentSendMessage = (message) => {
    if (!message || typeof message !== "object")
      return;
    switch (message.type) {
      case "init":
        return reply({ type: "initResp", config, rules });
      case "cmpDetected":
        state.cmp = String(message.cmp ?? "").slice(0, 80) || null;
        return;
      case "popupFound":
        state.popup = !0;
        state.cmp = String(message.cmp ?? "").slice(0, 80) || state.cmp;
        return;
      case "optOutResult":
        state.result = message.result ? "declined" : "not-declined";
        if (!message.result)
          state.done = !0;
        return;
      case "autoconsentDone":
        state.done = !0;
        if (message.isCosmetic)
          state.result = "hidden";
        state.cmp = String(message.cmp ?? "").slice(0, 80) || state.cmp;
        return;
      case "autoconsentError":
        state.error = String(message.details?.msg ?? message.details ?? "error").slice(0, 200);
        return;
      default:
        return;
    }
  };
})({ compact: {"v":1,"s":[".c-simple-popup:has(.c-cookie-popup)",".c-cookie-popup [data-role=refuse-cookies]",".c-cookie-popup","dialog.cookie-consent","dialog.cookie-consent form.cookie-consent__form","dialog.cookie-consent form.cookie-consent__form button[value=no]","dialog.cookie-consent form.cookie-consent__form button.cookie-consent__options-toggle","dialog.cookie-consent form.cookie-consent__form button[value=\"save_options\"]","#abe-gdpr-banner #gdpr-banner-component","#abe-gdpr-banner #gdpr-banner-component-decline-btn","#gdpr-banner-component","#gdpr-banner-component-decline-btn","abeconsent=%221%3A1%2C2%3A0%2C3%3A0%2C4%3A0%22","div[id$=\"_cookie_box\"]:has(a[onclick^=\"accept_\"][onclick*=\"_cookie_box()\"])","div[id$=\"_cookie_box\"] a[onclick^=\"accept_\"][onclick*=\"_cookie_box()\"]",".bc-content-modal:has([class*=\"_cookieFooter_\"])",".bc-content-modal [class*=\"_cookieFooter_\"]",".bc-content-modal [class*=\"_cookieFooter_\"] button:first-child","%222%22%3Afalse","div.acris-cookie-consent","[data-acris-cookie-consent]",".acris-cookie-consent.is--modal","#ccAcceptOnlyFunctional","#__cmp_overlay","#__cmp_body","#__cmp_body .cmpButtonLink","#__cmp_body .cmpLayer","#__cmp_body .cmpLayer .vue-js-switch","#__cmp_body .vue-js-switch.toggled .v-switch-input","#__cmp_body .manageLink:not(.buttonDisabled)","#__cmp_body .manageLink","#__cmp_body .rejectLink",".adn-window.adn-message",".adn-window.adn-message .adn-footer button[onclick*='saveAll(false)']","#cookie-banner","#adopt-controller-button","#adopt-reject-all-button","#adroll_consent_container","#adroll_consent_reject","__adroll_fpc","adstate-settings-component",".c-cookie-notice button[data-qa='allow-all-cookies']",".c-cookie-notice","button[data-qa=\"reject-non-essentials\"]","serif_manage_cookies_viewed","serif_allow_analytics",".amgdprcookie-bar-container",".amgdprcookie-bar-container [data-amgdprcookie-js=\"accept\"]:not([disabled])",".amgdprcookie-bar-container [data-amgdprcookie-js=\"decline\"]",".amgdprcookie-bar-container [data-amgdprcookie-js=\"decline\"]:not([disabled])",".amgdprcookie-bar-container [data-amgdprcookie-js=\"settings\"], .amgdprcookie-bar-container [data-amgdprcookie-js=\"custom_settings\"]",".amgdprcookie-settings-form",".amgdprcookie-settings-form input.amgdprcookie-input:checked:not([disabled])",".amgdprcookie-settings-form .amgdprcookie-done","#am-cookie-bar [x-ref=\"am-cookie-bar\"]","#am-cookie-bar > :is([data-dialog-ref-name=\"am-cookie-bar\"], [x-bind^=\"overlay\"])","#am-cookie-bar[style*=\"translateY(100%)\"]","[x-ref=\"am-cookie-bar-settings\"] :is([x-ref=\"ambar-settings-done\"], button[\\@click*=\"cookiebar-action-accept\"])","#am-cookie-bar [x-ref=\"am-cookie-bar\"] :is([data-dispatch-action=\"cookiebar-action-accept\"], .ambar-btn-decline)","#am-cookie-bar [x-ref=\"am-cookie-bar\"] :is([data-dispatch-action=\"cookiebar-action-settings\"], .ambar-btn-settings)","[x-ref=\"am-cookie-bar-settings\"] input[type=\"checkbox\"]","[x-ref=\"am-cookie-bar-settings\"] input[type=\"checkbox\"]:checked:not([disabled])","#am-cookie-bar [x-ref=\"am-cookie-bar\"] :is(button[\\@click=\"closeCookieBarHandler\"], button[\\@click*=\"close-cookie-bar\"])","[data-test-id=\"consentModal\"] [data-test-id=\"consentBtn\"]","[data-test-id=\"consentModal\"] button[aria-label=\"Continue without accepting cookies\"]","[data-test-id=\"consentModal\"] button[aria-label=\"Close cookie consent card popup\"]","[data-test-id=\"consentModal\"]","#sp-cc-wrapper,[data-action=sp-cc],span[data-action=\"sp-cc\"][data-sp-cc*=\"rejectAllAction\"]","#sp-cc-wrapper *,[data-action=sp-cc],span[data-action=\"sp-cc\"][data-sp-cc*=\"rejectAllAction\"]","#sp-cc-rejectall-link","#user-consent-management-granular-banner-overlay","[data-testid=granular-banner-button-decline-all]","div:has(> p > a[href='https://www.anthropic.com/legal/cookies'])","div:has(> p > a[href='https://www.anthropic.com/legal/cookies']) button:nth-child(2)","anthropic-consent-preferences","iframe[title='Consent window']","script[src*='cdn.appconsent.io/tcf2-clear/'][src*='core.bundle.js']","iframe[srcdoc*='frame-root']","script[src*='cdn.appconsent.io/tcf2/'][src*='core.bundle.js']","#consent-tracking","#consent-tracking .decline.btn",".modal-open bahf-cookie-disclaimer-dpl3","bahf-cookie-disclaimer-dpl3","bahf-cookie-disclaimer-dpl3:not([aria-hidden=true])","cookie_consent=denied",".Dialog:has(.ConsentManager)",".ConsentManager[data-controller~='consent-manager']",".ConsentManager button[data-action*='consent-manager#denyAll']","arto-consent=signature","dialog[data-testid=\"cookie-message-modal\"]","[data-testid=\"cookie-message-bottom-sheet\"]","[data-testid=\"cookie-message-bottom-sheet-overlay\"]","dialog[data-testid=\"cookie-message-modal\"] button[data-testid=\"decline-all-cookies\"], [data-testid=\"cookie-message-bottom-sheet\"] button[data-testid=\"decline-all-cookies\"]","dialog[data-testid=\"cookie-message-modal\"], [data-testid=\"cookie-message-bottom-sheet\"]","#gdpr_area","#gdpr_area .gdpr_area_inner","#gdpr_area .gdpr_btn_agree, #gdpr_area #gdpr_btn_agree","is_gdpr_agree=1","#divCookieInfo","#divCookieInfo #ctl00_CookieInfo_btnLinkNO"," - OFF - ","#cookie-policy-info,#cookie-policy-info-bg","#cookie-policy-info button","#cookie-policy-info .btn-reject","#cookie-policy-info .btn-setting","#cookie-policy-info .btn-ok","div[data-popup-cookies][data-terms-cookies-popup-common]","div[data-popup-cookies][data-terms-cookies-popup-common] button[data-cookies=\"disallow_all_cookies\"]","all_marketing_cookies=denied","form[class*=\"a8c-cookie-banner\"][method=\"post\"]","form[class*=\"a8c-cookie-banner\"] div[class*=\"simple-options\"] a[class*=\"customize-button\"]","input[type=checkbox][checked]:not([disabled])","a[class*=\"accept-selection-button\"]","#as24-cmp-popup","#as24-cmp-popup [data-testid=\"as24-cmp-container\"]","#as24-cmp-popup [data-testid=\"as24-cmp-decline-all-button\"]","%22consents%22%3A%5B%5D%7D%2C%22vendor%22",".as-oil",".AvacyBanner",".as-oil, .AvacyBanner",".as-oil .as-js-reject-all, .AvacyBanner .as-js-reject-all",".as-oil .as-js-close-banner, .AvacyBanner .as-js-close-banner",".Avada-CookiesBar__OuterWrapper .Avada-CookiesBar_Container",".Avada-CookiesBar__OuterWrapper .Avada-CookiesBar_BtnDeny",".Avada-CookiesBar-Preferences__PopUp .Avada-CookiesBar_BtnDeny","\"analytics\":false,\"marketing\":false",".fusion-privacy-bar",".fusion-privacy-bar .fusion-privacy-bar-reject, .fusion-privacy-bar .fusion-privacy-choices input[type=\"checkbox\"]:not(:disabled)",".fusion-privacy-bar .fusion-privacy-bar-reject",".fusion-privacy-bar .fusion-privacy-choices input[type=\"checkbox\"]:checked:not(:disabled)",".fusion-privacy-bar .fusion-privacy-bar-acceptance","#ACClayerBackground","#ACClayerBackground #ACCsmallCookieLayer","#ACCsmallCookieLayer, #ACCtabedCookieLayer","#ACCsmallCookieLayer","#ACCsmallCookieLayer .kkACCButtonLearnMore","#ACCdetailsSaveButton","#ACCtabedCookieLayer .kkACCSwitchLabel input:checked","#ACCtabedCookieLayer .kkACCSwitchLabel:has(input:checked)","=1000,","#awsccc-cb-content","#awsccc-cs-container","#awsccc-cs-modalOverlay","#awsccc-cs-container-inner","button[data-id=awsccc-cb-btn-decline]","button[data-id=awsccc-cb-btn-customize]","input[aria-checked]","input[aria-checked=true]","button[data-id=awsccc-cs-btn-save]",".axeptio_widget,.axeptio_mount",".axeptio-widget--open",".axeptio_mount .axeptio_widget","%22$$completed%22:false",".axeptio_mount .needsclick","button#axeptio_btn_dismiss,button.ax-discardButton,button#axeptio_btn_close","button#axeptio_btn_dismiss,button.ax-discardButton","button#axeptio_btn_close","axeptio_authorized_vendors=%2C%2C","#cookie_consent_wrapper, #cookie_consent_min_wrapper, #manage_cookie_consent_modal","#cookie_consent_wrapper:not(.hideConsent)","#cookie_consent_wrapper #consent_accept_essential, #manage_cookie_consent_modal #modal_consent_accept_essential","#cookie_consent_wrapper.non_cookie_consent_wrapper #js_cookieBannerCloseBtn","#cookie_consent_wrapper #consent_accept_essential","#cookie_consent_wrapper #js_cookieBannerCloseBtn","#manage_cookie_consent_modal #modal_consent_accept_essential","#cookie_consent_min_wrapper #close_minimized_banner","cookieConsent=1","cookieConsent=5",".b-cookie.is-open",".cookie-alert.t-dark","#cookie-accept-necessary",".cookie-alert .checkbox__input:checked:not(:disabled)",".cookie-alert__button button","#banner-privacy","#banner-privacy #cb-RejectAll","cookiepolicy=1-","[id$=\"bathnes-cookie-consent-banner\"] #cookie-banner","[id$=\"bathnes-cookie-consent-banner\"] #cookie-banner button[onclick^=\"rejectCookies\"]","iabbb-cookies-message > section","iabbb-cookies-message","iabbb-cookies-message > section [name='allow-all']","iabbb-cookies-message > section button.bds-button-unstyled","iabbb-cookies-message dialog[open]","iabbb-cookies-message dialog fieldset input[type=radio][value=false]:not(:checked)","iabbb-cookies-message dialog button.bds-button","iabbb-cookies-message > section button.bds-button:not([name])",".cookiesgdpr__base:has(.cookiesgdpr__rejectbtn)",".cookiesgdpr__base .cookiesgdpr__rejectbtn",".cookiesgdpr__base .cookiesgdpr__wrapper","\"analitica\":false","#overlay-policy","#overlay-policy #policy_pop_close .fa-times-circle","#overlay-policy #policy_pop_close","showpopuppolicy=No","beetle-tracking-consent-modal","\"bt_marketing\":false","#consent-manager","#consent-manager button","#consent-manager button:nth-child(2)","tracking-preferences","#bc-cmp-host","#bc-cmp-host-auto","#bigidcmp-banner-widget","bigidcmp-consent-","marketing=false","#bnp_container","#bnp_cookie_banner","#bnp_btn_accept,#bnp_btn_reject","#bnp_btn_reject","AD=0","#cconsent-modal","#cconsent-modal .ccm__footer .consent-givenone","#cconsent-modal.ccm--visible .ccm__footer .consent-givenone","\"wanted\":false",".cookie-notification","#blocksy-ext-cookies-consent-styles-css",".cookie-notification .ct-cookies-decline-button","blocksy_cookies_consent_accepted=no","#cookie_banner:has(#cookie_essential)","#cookie_banner #cookie_buttons #cookie_essential","#cookie_banner #cookie_essential","#cookie_banner","#CookieConsentContainer:has(#BtnCCPrefs) > .container","#CookieConsentContainer #BtnCCPrefs","#CookieConsentContainer #BtnCCAll","#CookieConsentContainer #BtnCCNone","#CookieConsentPanel #BtnCCSave","#ConsentAnalytics:checked","#ConsentAnalytics","#ConsentThirdParty:checked","#ConsentThirdParty","-saved=true","-analytics=true","#cookie-consent-banner","#ccpa-consent-banner","#cookie-consent-banner [data-id=\"cookie-consent-banner-modal\"]","#cookie-consent-banner .banner-gdpr, #cookie-consent-banner #gdpr-modal","#ccpa-consent-banner [data-id=\"btn-close-ccpa\"]","#cookie-consent-banner [data-id=\"btnGdprRejectAll\"], #cookie-consent-banner [data-id=\"btn-contd-without-accpting\"]","#cookie-consent-banner [data-id=\"pre-banner-btn\"]","#cookie-consent-banner [data-id=\"cookie-consent-banner-modal\"] input[type=\"checkbox\"]:checked:not(:disabled)","#cookie-consent-banner [data-id=\"btn-save-preference\"]","#BorlabsCookieBox","._brlbs-block-content,.brlbs-cmpnt-dialog","._brlbs-bar-wrap,._brlbs-box-wrap,.brlbs-cmpnt-dialog",".brlbs-btn-accept-only-essential,a[data-cookie-refuse],.brlbs-btn-save,#CookieBoxSaveButton,.brlbs-cmpnt-close-button[data-borlabs-cookie-actions=\"close-button\"],a[data-cookie-individual]",".brlbs-btn-accept-only-essential,a[data-cookie-refuse]",".brlbs-btn-save,#CookieBoxSaveButton",".brlbs-cmpnt-close-button[data-borlabs-cookie-actions=\"close-button\"]","a[data-cookie-individual]",".cookie-preference","input[data-borlabs-cookie-checkbox]:checked","#CookiePrefSave","dock-privacy-settings","#cookie-panel-banner","#cookie-panel-banner-reject-button","no.bouvet.app.cookiepanel-cookie-control","#cconsent-bar","#cconsent-bar .consent-give","#cconsent-bar:not(.ccb--hidden) .consent-give","#cconsent-bar button.consent-decline","#cconsent-bar .ccb__edit","#ccm__footer__consent-modal-submit","#cconsent-modal .ccm__switch-group[aria-checked=\"true\"]","#cconsent-modal input.category-onoff:checked:not(:disabled)","#bsw-consentCookie","#bsw-consentCookie .accept-btn","#bsw-consentCookie .manage-cookies-btn","#bsw-consentCookie .config-banner_section","#bsw-consentCookie input[type=checkbox]:checked:not(:disabled)","x-bsw-consentCookie",".cookie-banner #accept_all","#cookies_modal #third_party_cookies_toggle","#third_party_cookies_toggle:checked","#third_party_cookies_toggle","#cookies_modal #save_button",".cookie-banner:not(.d-none) #accept_all","third_party_cookies_accepted=False","cookie_banner_hidden=True",".cookiebanner--tablist","#cookiebanner[data-cookiebanner]",".cookiebanner [data-consent=\"acceptSelection\"]",".cookiebanner input[type=\"checkbox\"]:checked:not(:disabled)",".cookiebanner input[type=\"checkbox\"]:checked:not(:disabled) + label",".bpa-cookie-banner",".bpa-cookie-banner .bpa-module-full-hero",".bpa-close-button","cookie-allow-tracking=0",".cookie-modal","#notice-cookie-block","#notice-cookie-block #cm-selectSpecific","#html-body #notice-cookie-block","#notice-cookie-block #btn-cookie-decline","#notice-cookie-block button[\\@click^='rejectAll']","#btn-cookie-manage","#notice-cookie-block input:checked","#btn-cookie-save","#html-body #notice-cookie-block, #notice-cookie",".bwr-cookie.js-cookie",".bwr-cookie.js-cookie .js-cookie-trigger",".bwr-cookie.js-cookie .bwr-cookie__buttons",".bwr-cookie.js-cookie input[data-cookie-option]:checked:not(:disabled)","ZnVuY3Rpb25hbCI6ZmFsc2UsInBlcnNvbmFsaXphdGlvbiI6ZmFsc2V9","#cookieconsent","#cookieconsent .cookiechoices .rejectcookies","ANALYTICALCONSENT=0","MARKETINGCONSENT=0","#cookieBanner.c-banner","#cookieBanner.c-banner button[data-allow-cookies=false]","cookies_allow=false",".cassie-cookie-module",".cassie-pre-banner","#cassie_pre_banner_text",".cassie-reject-all",".cc_banner-wrapper",".cc_banner",".cc-banner[data-cc-banner]",".cc-banner[data-cc-banner] button[data-cc-action=reject]",".cc-banner[data-cc-banner] button[data-cc-action=preferences]",".cc-preferences[data-cc-preferences]",".cc-preferences[data-cc-preferences] input[type=radio][data-cc-action=toggle-category][value=off]",".cc-preferences[data-cc-preferences] button[data-cc-action=reject]",".cc-preferences[data-cc-preferences] button[data-cc-action=save]","#ccm-widget.ccm-show","#ccm-widget","script[src*='ccm19'][src*='/app.js?apiKey=']","#ccm-widget .ccm--decline-cookies","#ccm-widget [data-ccm-modal='ccm-control-panel']","#ccm-control-panel .ccm--save-settings:not([data-full-consent='true'])","#js_cookie-consent-banner","#js_cookie-consent-banner .js_cookie-consent-necessary",".cfGdprCookieConsentPopup",".cfGdprCookieConsentPopup #cfGdprCookieConsentPopupSettings",".cfGdprCookieConsentPopup #cfGdprCookieConsentPopupSaveSettings",".cfGdprCookieConsentPopup__settings input[type=checkbox]:checked","CF_GDPR_COOKIE_CONSENT_PERFORMANCE=0","CF_GDPR_COOKIE_CONSENT_SOCIAL=0","CF_GDPR_COOKIE_CONSENT_MARKETING=0",".c24-cookie-consent-wrapper",".c24-cookie-consent-wrapper .c24-cookie-consent-functional",".c24-cookie-consent-notice","[data-modal-content]:has([data-toggle-target^='cookie'])","[data-toggle-target^='cookie']","[data-cookie-dismiss-all]",".chefcookie",".chefcookie .chefcookie__buttons",".chefcookie .chefcookie__box",".chefcookie .chefcookie__buttons a[href=\"#chefcookie__decline\"]","hide_prompt=1",".gdpr-modal:has(img[src*=\".ciaopeople.it/\"])",".gdpr-modal .gdpr-modal__box-top-sx img[src*=\".ciaopeople.it/\"]",".gdpr-modal .gdpr-modal__box",".gdpr-modal__box-top-dx > button","section[role=\"alert\"]:has(button[aria-label=\"close cookie message\"])","section[role=\"alert\"] button[aria-label=\"close cookie message\"]","#ccc-module,#ccc-overlay,#ccc","#ccc-module,#ccc-notify","#ccc",".ccc-reject-button","#ccc-notify .ccc-notify-buttons .ccc-notify-button:not(.ccc-accept-button):not(.ccc-reject-button)","#ccc-module","#ccc-dismiss-button","#ccc-close",".cc-individual-cookie-settings",".cc-individual-cookie-settings #cookie-settings-reject-all","ckies_cookielaw","#cksModal","#cksModal #cks .cksButtons","#cksModal #cks","#cks .cksLink[onclick*=\"setCksPrefs('0')\"]","CookiePrefs=0","#cl-consent","#cl-consent [data-role=\"b_options\"]",".cl-consent-popup.cl-consent-visible [data-role=\"alloff\"]","[data-role=\"b_save\"]","__lxG__consent__v2_daisybit=",".consent-modal[role=dialog]","#consent_reject","#manage_cookie_preferences","#cookie_consent_preferences input:checked","#consent_save","ctc_rejected=1","#cookie-notice:has(.cookie-notice-close[onclick^='closeCookieNotice'])","#cookie-notice .cookie-notice-close[onclick^='closeCookieNotice']",".cf_modal_container","#cm-wrapper:has(#cm-selectSpecific)","#cookie-consent:has(#cm-selectSpecific)","#cm-selectSpecific","#cm-selectAllCheckboxes","#cm-openSettings",".cmCat-checkboxes:checked:not(:disabled)","#coki61 .cok_but1","#coki61","coki61=2","#cu-privacy-notice","#cu-privacy-notice .cu-privacy-notice-close","com-consent-layer","#cmplz-cookiebanner-container","#cmplz-cookiebanner-container .cmplz-cookiebanner",".cmplz-cookiebanner .cmplz-deny","cmplz_banner-status=dismissed",".cc-type-categories[aria-describedby=\"cookieconsent:desc\"]",".cc-type-categories[aria-describedby=\"cookieconsent:desc\"] .cc-dismiss",".cc-dismiss",".cc-type-categories input[type=checkbox]:not([disabled]):checked",".cc-save",".cc-type-info[aria-describedby=\"cookieconsent:desc\"]",".cc-type-info[aria-describedby=\"cookieconsent:desc\"] .cc-compliance .cc-btn",".cc-deny","[aria-describedby=\"cookieconsent:desc\"]",".cc-blockingScreen","[aria-describedby=\"cookieconsent:desc\"].cc-type-opt-out","[aria-describedby=\"cookieconsent:desc\"].cc-type-opt-out:not(.cc-invisible)",".cmp-pref-link",".cmp-body [id*=rejectAll]",".cmp-body .cmp-save-btn",".cc-type-opt-in[aria-describedby=\"cookieconsent:desc\"]",".cc-type-opt-in[aria-describedby=\"cookieconsent:desc\"]:not(.cc-invisible)",".cc-settings",".cc-settings-view",".cc-settings-view input[type=checkbox]:not([disabled]):checked",".cc-settings-view .cc-btn-accept-selected",".cc-type-opt-in[aria-describedby=\"cookieconsent:desc\"].cc-invisible","#cookie-banner.cookie-banner","#cookie-consent","#cookie-button-settings-accept","#cookie_consent_Necessary","#cookie-button-settings","#cookie_consent_Product:checked, #cookie_consent_Marketing:checked",".cookie-consent-card:has([data-cy=cookie-customize])",".cookie-consent-card [data-cy=cookie-customize]","#cookie-preferences-dialog [data-cy=cookie-save-preferences]","#cookie-preferences-dialog button[role=switch][aria-checked=true]:not([aria-disabled=true])","_cookieConsent=%7B%22analytics%22%3Afalse%2C%22marketing%22%3Afalse",".cookiebanner:has(> #cookieform .chooseCookies)",".diffusion_layer:has(#cookieform)",".cookiebanner #cookieform .chooseCookies",".cookiebanner [onclick^='sendForm(0']",".cookiebanner .chooseCookies input[type='checkbox']:checked:not([onclick])",".cookiebanner [onclick^='sendForm(1']","._flo-consent-root","._flo-consent-root ._flo-consent-modal-contextual ._flo-consent-button--accept-selected","._flo-consent-root ._flo-consent-modal:not(._flo-consent-modal-contextual)","._flo-consent-modal:not(._flo-consent-modal-contextual) ._flo-consent-button--reject","._flo-consent-button--settings","._flo-consent-modal-contextual ._flo-consent-button--accept-selected","._flo-consent-modal-contextual ._flo-consent-checkbox:checked:not(._flo-consent-checkbox--necessary)","._flo-consent-root._flo-consent-hide",".consent-studio .cookie-banner",".consent-studio .consent-banner",".consent-studio [cs-role=consent-banner]",".consent-studio [cs-role=consent-banner] [data-cs-button=reject_all]",".consent-studio [cs-role=consent-banner] [cs-consent=reject]",".consent-studio [cs-role=consent-banner] .cookie-banner__switch[aria-checked=true]:not([aria-disabled=true])",".consent-studio [cs-role=consent-banner] [data-cs-button=save]","consent-studio__storage=[%22functional%22]","#consentaur-banner","#consentaur-banner .consentaur-btn-reject","%22marketing%22%3Afalse",".cs-info-bar[class*=\"cs-public-cookie-\"] .cs_action_btn[data-cs_action=\"allow_all\"]",".cs-info-bar .cs_action_btn[data-cs_action=\"disable_all\"]",".cs-info-bar .options_btn",".cs_settings_popup [data-cs_action=\"cs_confirm\"]",".cs_settings_popup input.cs_script_action:checked:not(:disabled)","cs_viewed_cookie_policy=","#ncmp__tool .ncmp__banner","#ncmp__tool .ncmp__banner.ncmp__active","ncmp=","csm-cookie-consent","#cookie-information-template-wrapper","#CcpaWrapper","CookieInformationConsent=","cookie-banner-element#ckb","#cookie-bar","#cookie-bar .cookie-bar-frame #decline","#cookie-bar .cookie-bar-frame","cookies-state=decline",".spicy-consent-wrapper",".spicy-consent-bar",".js-decline-all-cookies","section.cookie-info","section.cookie-info .js-cookie-info__decline","section.cookie-info.is-visible:not(.is-hidden)","accepted-cookies=functional","accepted-cookies=functional%2C","#cookie-law-info-bar, #cookie-law-bg, .cli-popupbar-overlay","#cookie-law-info-bar","cookielawinfo-checkbox-non-necessary=yes","#btn-cookie-settings","#notice-cookie-block #allow-functional-cookies, #notice-cookie-block #btn-cookie-settings","#allow-functional-cookies",".modal-body",".modal-body input:checked, .switch[data-switch=\"on\"]","[role=\"dialog\"] .modal-footer button","#cookie-notice:has(#cookie-notice-accept.cookie-notice__accept--custom)","#cookie-notice #cookie-notice-accept.cookie-notice__accept--custom","#cookie-notice #cookie-notice-reject","#cookie-notice input[type=checkbox]:not(#cookie-checkbox-mandatory, [data-is-mandatory], :disabled):checked","#cookie-notice #cookie-notice-accept","#cookie-popup","#cookie-popup #close-cookies","#cookie-popup #view-all","#cookie-popup:not([class*=\"invisible\"]) #close-cookies","#cookie-popup[class*=\"invisible\"]","acceptedAnalytics=granted","#cookie-popup:has([onclick*=\"cookieNo()\"])","#cookie-popup [onclick*=\"cookieNo()\"]","#cookie-popup:has([onclick*=\"cookieOk()\"]):not(:has([onclick*=\"cookieNo()\"]))","#cookie-popup:not(:has([onclick*=\"cookieNo()\"])) [onclick*=\"cookieOk()\"]","form.cookie-pref-form .cookie-bar","form.cookie-pref-form .cookie-bar .cookie-bar--action","form.cookie-pref-form .cookie-bar .cookie-bar--reject","form.cookie-pref-form .show-cookie-pref","form.cookie-pref-form .cookie-pref-save","form.cookie-pref-form .cookie-pref-overlay input[type=checkbox]:checked:not(:disabled)","#cookiescript_injected",".cookiescript_banner_container [role=dialog]","#cookiescript_injected, .cookiescript_banner_container","#cookiescript_injected, .cookiescript_banner_container [role=dialog]","#cookiescript_reject","#cookiescript_manage",".cookiescript_fsd_main, #cookiescript_save",".cookiescript_fsd_main","#cookiescript_save","#cookiescript_injected input.cookiescript_checkbox_input:checked:not(:disabled), .cookiescript_banner_container input.cokiescript_checkbox:checked:not(:disabled)","#cookiescript_close, .cookiescript_close_btn","#cookieAcceptBar.cookieAcceptBar","#cbPopupWrap.cb-popup--open","#cbPopupWrap #cbRefuseTrigger","cbDataAccepted=1","#cc--main","html.show--consent #cm, html.show--settings #s-cnt","#s-all-bn","#s-rall-bn","#c-s-bn","#s-bl input.c-tgl:checked:not(:disabled)","#s-sv-bn","cc_cookie=","#cc_div","#cc_div #cm_btns","html.show--consent #cc_div #cm, html.lb-show-cookie-consent #cc_div #cm","#cm_secondary_btn","html.show--settings, html.lb-show-cookie-settings","#cs_blocks input.c_toggle:checked:not(:disabled)","#cs_save__btn","lb_csc=","#cc-main","#cc-main .cm-wrapper",".cm__btn[data-role=necessary]",".cm__btn[data-role=show]","#cc-main .pm__btn[data-role=necessary]",".cc-cookies",".cc-cookies .cc-cookie-accept",".cc-cookies:not(#cookies_declinedbar) .cc-cookie-accept",".cc-cookies .cc-cookie-decline","#cookiefirst-root,.cookiefirst-root,[aria-labelledby=cookie-preference-panel-title]","#cookiefirst-root,.cookiefirst-root","#cookiefirst-root button[data-cookiefirst-action],.cookiefirst-root button[data-cookiefirst-action],#btnAcceptAllCookies,#btnRejectAllCookies,#btnAdjustSettings,[aria-labelledby=cookie-preference-panel-title] button","button[data-cookiefirst-action=reject]","#btnRejectAllCookies","button[data-cookiefirst-action=adjust]","[data-cookiefirst-widget=modal]","button[data-cookiefirst-action=save]",".ch2-container",".ch2-dialog",".ch2-open-settings-btn, .ch2-open-personal-data-btn",".ch2-settings",".ch2-deny-all-btn",".ch2-settings input[type=checkbox]:not([disabled]):checked",".ch2-save-settings-btn","cookiehub=",".cookieinfo",".cookieinfo-close",".cookiejs-banner-wrapper",".cookiejs-banner-wrapper:not(.modal)",".cookiejs-banner-wrapper button.cookiejs-button",".cookiejs-banner-wrapper #reject-cookies-btn","analytics_cookies=false",".cookiejs-banner-wrapper.modal",".cookiejs-banner-wrapper .cookiejs-banner-text",".cookiejs-banner-wrapper .cookiejs-banner-li:nth-of-type(2) button","cookiejs_preferences","#cookie-legit-notice-container .cookie-legit-notice","#cookie-legit-notice-container.notice .cookie-legit-notice","#cookie-legit-notice-container .cookie-legit-deny-btn","#cookie-legit-notice-container .cookie-legit-pref-btn","#cookie-legit-notice-container .cookie-legit-save-pref-btn","#cookie-legit-notice-container input[name=cl_tracking]:checked","#cookie-legit-notice-container input[name=cl_marketing]:checked","cl_tracking=false","cl_marketing=false","#cookieman-modal","#cookieman-modal [data-cookieman-save]","#cookieman-modal [data-cookieman-accept-none]","#cookieman-modal [aria-controls=\"cookieman-settings\"]","#cookieman-modal [data-cookieman-form]","#cookieman-modal [data-cookieman-form] input[type=\"checkbox\"]:checked:not(:disabled)","#cookieman-modal [data-cookieman-save]:not([data-cookieman-accept-all]):not([data-cookieman-accept-none])","CookieConsent=","#cp-overlay","#cp-overlay #cp-no a","cookiepermission=no","#eksCookiePrompt","#eksCookiePrompt .cpDontAcceptBtn","#eksCookieNo","cookieOptOut=n","#CookieReportsBanner","#CookieReportsOverlay","#CookieReportsPanel #CookieReportsBanner","#cookiesInfo #closeCookies","#cookiesInfo",".cookiesjsr-banner.active",".cookiesjsr-banner",".cookiesjsr-banner.active .denyAll",".cookiesjsr-banner.active .cookiesjsr-settings",".cookiesjsr-layer",".cookiesjsr-layer .denyAll",".cookiesjsr-layer .cookiesjsr-switch.active input",".cookiesjsr-layer .save","#CookieConsent dialog.cookie-popup","#CookieConsent dialog.cookie-popup #cc-b-custom","#CookieConsent .actions input[type=checkbox]:checked","#CookieConsent #cc-b-custom",".cky-overlay,.cky-consent-container",".cky-consent-container",".cky-consent-container [data-cky-tag=reject-button]",".cky-consent-container [data-cky-tag=donotsell-button]",".cky-modal [data-cky-tag=optout-option-toggle]",".cky-modal [data-cky-tag=optout-option-toggle]:not(:checked)",".cky-modal [data-cky-tag=optout-confirm-button]",".cky-modal [data-cky-tag=optout-success]",".cky-modal [data-cky-tag=optout-close]",".cky-consent-container [data-cky-tag=settings-button]",".cky-modal-open input[type=checkbox],.cky-consent-bar-expand input[type=checkbox],.cky-modal-open [data-cky-tag=detail-save-button],.cky-consent-bar-expand [data-cky-tag=detail-save-button]",".cky-modal-open input[type=checkbox]:checked,.cky-consent-bar-expand input[type=checkbox]:checked",".cky-modal [data-cky-tag=detail-save-button],.cky-consent-bar-expand [data-cky-tag=detail-save-button]",".cky-consent-container,.cky-overlay,.cky-consent-bar-expand","advertisement:no","#cky-consent.cky-consent-bar","#cky-consent #cky-btn-reject","#cky-consent #cky-btn-settings","#cky-btn-custom-accept","input[id^=cky-checkbox-category]:checked:not(:disabled)","cky-action=yes","cky-consent=no","cookieyes-analytics=no",".elementor-popup-modal:has(.cookiez-footer)",".cookiez-footer [data-cookiez-action]",".cookiez-footer [data-cookiez-action=\"deny-all\"]","%22analytics%22%3Afalse","dialog:has(#cookie-banner-2025-form)","#cookie-banner-2025-form","button[form=\"cookie-banner-2025-form\"][name=\"accept_cookie\"]","button[form=\"cookie-banner-2025-form\"][name=\"accept_cookie\"][value=\"selection\"]",".c-cookie-banner.c-custom-sheet","[id^=\"monetate_selectorHTML\"] > .gdprCookieBanner",".c-cookie-banner.c-custom-sheet .c-cookie-banner__close-button","[id^=\"monetate_selectorHTML\"] > .gdprCookieBanner .gdprCookieBannerCloseBtn",".c-cookie-banner.c-custom-sheet, [id^=\"monetate_selectorHTML\"] > .gdprCookieBanner",".cookiealert",".configurecookies",".confirmcookies","#gdprMessage button.gdpr-review","[id^=div-transcend-cookie]","#gdprMessage","#btn-transcend-cookie-confirm, #btn-transcend-save","#analyticsNo:not(:checked), #functionalNo:not(:checked), #targetingNo:not(:checked)","#analyticsCookieCheckbox:checked, #preferenceCookieCheckbox:checked","#elc-cookie-consent","#elc-cookie-consent #elc-cookie-consent-form","#elc-cookie-consent:not(.elc-hidden) #elc-cookie-consent-form","#elc-cookie-consent-form input[type=checkbox][name^=\"group-\"]:checked:not([disabled]):not([name$=\"-necessary\"])","#elc-accept-link","#elc-detail-link","#elc-save-link, #elc-accept-link","#elc-save-link","#elc-cookie-consent.elc-hidden","#ct-ultimate-gdpr-cookie-popup","#ct_ultimate-gdpr-cookie-reject a,#ct-ultimate-gdpr-cookie-reject","#ct-ultimate-gdpr-cookie-change-settings","#ct-ultimate-gdpr-cookie-modal-slider-form input[type=radio][value=\"1\"], #ct-ultimate-gdpr-cookie-modal-slider-form input[type=radio][value=\"2\"]","#ct-ultimate-gdpr-cookie-modal-body .save","ct-ultimate-gdpr-cookie=","#cookiebar","#cookiebar .cookiebar-content",".cookies-consent:has(.cookies-consent-accept-needed)",".cookies-consent .cookies-consent-accept-needed",".cookies-consent .cookies-inner","cookiesConsentAllowedServices=","]},{\"type\":",".cookie-consent-banner:has(#FormCookieConsentAll)",".cookie-consent-banner #FormCookieConsentAll",".cookie-consent-banner .btn-cookie-consent-settings",".modal-cookie-consent .btn-cookie-consent-modal-disallow-all",".cookie-consent-banner",".cookie-notice.js-cookie-modal",".cookie-notice.js-cookie-modal .js-accept-minimal-cookies","acceptCookiePolicy-marketing=false","div[class*=\"CookiePopup__desktopContainer\"]:has(div[class*=\"CookiePopup\"])","div[class*=\"CookiePopup__desktopContainer\"]",".cookie-banner.show .cookie-banner__content-all-btn",".cookie-banner__content-essential-btn","[data-module=cookie-consent-banner]","[data-module=cookie-consent-banner] #button-accept-necessary[data-consent-set]","[data-module=cookie-consent-banner] .cookie-consent-banner","[data-module=cookie-consent-banner] #button-accept-necessary","dbconsent=0.1.",".dg-consent-banner","datagrail_consent","#datasign_cmp__host","#cookieconsent.cookie-overlay .cookie-buttons #cookie-deny","#cookieconsent.cookie-overlay[style*=\"visibility: visible\"] #cookie-deny","#cookieconsent.cookie-overlay #cookie-deny","CLC_GDPR=AB%3A","#cookie-notice","#cookie-notice :is(#cn-refuse-cookie, #cn-close-notice)","#cookie-notice.cookie-notice-visible #cn-notice-buttons","#cookie-notice #cn-refuse-cookie","#cookie-notice #cn-close-notice","cookie_notice_accepted=false","#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium","#didomi-host","#didomi-popup, #didomi-notice, .didomi-popup-notice, .didomi-notice-banner, #didomi-host:not([aria-hidden=\"true\"]):not(:empty)","#didomi-notice-disagree-button,.didomi-continue-without-agreeing","dnt-cookies","CONSENT=OFF","#cc_modal_dialog","#cc_modal_window","#cc_section_quick_info #cc_accept_all_cookies","#cc_reject_all_cookies","#cc_manage_cookies","#cc_reject_all","#cc_save_preferences","#cc_section_quick_info","cookie_consent=","[data-project=\"mol-fe-cmp\"]","[data-project=\"mol-fe-cmp\"] [class*=footer]","[data-project=\"mol-fe-cmp\"] button[class*=basic]","[data-project=\"mol-fe-cmp\"] div[class*=\"tabContent\"]","[data-project=\"mol-fe-cmp\"] div[class*=\"toggle\"][class*=\"enabled\"]","#mol-ads-cmp-iframe, div.mol-ads-cmp > form > div","div.mol-ads-cmp > form > div","div.mol-ads-ccpa--message > u > a",".mol-ads-cmp--modal-dialog","a.mol-ads-cmp-footer-privacy","button.mol-ads-cmp--btn-secondary","[data-testid=\"cookie-banner\"][class*=\"cookie-banner-styles__StyledCookieBanner\"]","[data-testid=\"cookie-banner\"] button[kind=\"BUTTON/FLAT_SECONDARY\"]","cookie_tracking_enabled","#pg-shadow-host-dom",".cmp-popup_popup",".cmp-app_gdpr",".cmp-popup_popup .cmp-intro_rejectAll",".cmp-popup_popup .cmp-details_rejectAll","lpubconsent=","#rgpd-popup","#rgpd-custom-popup","#rgpd-popup #rgpd-continue-without-accepting","#rgpd-continue-without-accepting","consentLevel=none","#drupalorg-crosssite-gdpr",".no","#d-notification-bar[data-rule-type=\"notification\"]:not([data-rule])","#d-notification-bar[data-rule-type=\"notification\"]:not([data-rule]) .notification-dismiss",".showing-message--shown > #d-notification-bar[data-rule-type=\"notification\"][data-visible]:not([data-rule])",".showing-message--shown > #d-notification-bar:not([data-rule]) .notification-dismiss",".showing-message--shown > #d-notification-bar:not([data-rule])","div[data-testid=cookie-consent-modal-backdrop]","div[data-testid=cookie-consent-message-contents]","button[data-testid=cookie-consent-adjust-settings]","button[data-testid=cookie-consent-preferences-save]","cc_functional=0","cc_targeting=0",".cookieconsent form .hidden_accept_all",".cookieconsent:not(.hidden) form input[type=submit]","#cookie-consent-deny",".cookieconsent form button.button--textual, #cookie-consent-button",".cookieconsent .hidden_accept_all[value=no]","#cookie_category_marketing:checked","#cookie_category_marketing",".cookieconsent form input[type=submit]","cookie_category_marketing=on","#cookieBox .block-cookie-consent","#cookieBox #consentButton.block-cookie-consent--btn","#cookieBox","#econda-pp2-banner","#econda-pp2-banner-modal","#econda-pp2-banner, #econda-pp2-banner-modal","#econda-pp2-banner-reject-all-channels-button","econda.privacy.protection={\"profile\":{\"state\":\"DENY\"","#emCookieWrapper","#emCookieWrapper #emCookieBanner","#emCookieBanner","#emCookieBtnConfigure","#emCookieTool #emCookieBtnRejectAll","#emCookieFrame","EducaMadrid_LSSI_Cookies=0",".cookieNoticeWrapper",".cookieNoticeWrapper #cookieConsentFormAccept input[name^='ee:cookies_']",".cookieNoticeWrapper #cookieConsentFormAccept",".cookieNoticeWrapper #cookieConsentFormDecline button",".cookieNoticeWrapper #cookieConsentFormAccept button","div[role='dialog'][aria-modal='true']:has([data-qa='accept-all-button'])","[data-qa='accept-all-button']","[data-qa='reject-non-essential-button']","#ensNotifyBanner",".ensModal","#ensNotifyBanner[style*=block]","#ensModalWrapper[style*=block]","#ensNotifyBanner #ensRejectAll,#ensNotifyBanner #ensRejectAllConsent,#ensNotifyBanner #rejectAll,#ensNotifyBanner #ensRejectBanner,#ensNotifyBanner .rejectAll,#ensNotifyBanner #bannerRejectButton,#ensNotifyBanner #ensRejectAds,#ensNotifyBanner #btn-accept-essential-cookies","#ensOpenModal,#modalOpenButton,#bannerOpenModal",".ensCheckbox:checked:not(:disabled)","#ensSave,#modalSaveButton,#bannerSave","#ensCloseBanner","epaas-consent-drawer-shell","%22advertising%22%3A0","#emgCookieConsentOverlay","#emgCookieConsentInitialPopup","#emgCookieConsentInitialPopup button.minimal","#cookiebar[data-cookie-name=\"eset_cookie-bar\"]","#cookiebar[data-cookie-name=\"eset_cookie-bar\"] #cc-accept","#cookiebar #cc-decline","#cookiebar #cc-manage","#cookiebar #cc-accept2","#cookiebar .cc-category input[type=checkbox]:checked:not(:disabled)","\"marketing\":0","#et-consent-overlay","#et-consent-overlay-bg","#et-consent-overlay button[data-editor=buttonDeny]","et_allow_cookies=0","#gdpr-single-choice-overlay","#gdpr-privacy-settings","button[data-gdpr-open-full-settings]",".gdpr-overlay-body input",".pea_cook_wrapper,.pea_cook_more_info_popover",".pea_cook_wrapper","euCookie","body.eu-cookie-compliance-popup-open",".eu-cookie-compliance-banner .decline-button, .eu-cookie-compliance-banner .accept-necessary, .eu-cookie-compliance-save-preferences-button","cookie-agreed=2",".eupopup-container",".eupopup-container > .eupopup-closebutton","#ez-cookie-dialog-wrapper","#ez-manage-settings","#ez-cookie-dialog input[type=checkbox]","#ez-cookie-dialog input[type=checkbox]:checked","#ez-save-settings","ez-consent-tcf",".aspire-banner.marketing-cookies-banner","[data-trk-id=\"reject-marketing-cookies\"]","mktck=false","#fast-cmp-root","iframe#fast-cmp-iframe","fastCMP-","iframe.ck_if","iframe.ck_if[title='Cookie center']","html.ck_panel iframe.ck_if[style*='visibility: visible']","html.ck_panel iframe.ck_if","fedex-gdpr","fedex-gdpr div","fedex-gdpr .fxg-gdpr__reject-all-btn","_svs=",".cookies-container:has(.accept-necessary-only-btn)",".cookies-container .cookies-banner-non-essential .accept-necessary-only-btn",".cookies-container",".cookies-container .accept-necessary-only-btn",".cookies-container .accept-hide-message-btn",".cookies-accepted-container #closeStatusPopUp","_website_cookie_essentialCookies=essentialCookies","_website_cookie_usageCookies=","astro-island[component-url*=\"CookiesBanner\"] .cookies","astro-island[component-url*=\"CookiesBanner\"] .cookies button.cookies__buttons--settings","astro-island[component-url*=\"CookiesBanner\"] .cookies input[name=\"targeting\"]:checked","astro-island[component-url*=\"CookiesBanner\"] .cookies input[name=\"targeting\"]","astro-island[component-url*=\"CookiesBanner\"] .cookies button.cookies__buttons--accept","cookiesPreferences=[%22necessary%22]","#cookie-advice.fv-cookie-advice","#cookie-advice .fv-cookie-advice__message a:not([href]), #cookie-advice .fv-cookie-advice__message button",".fv-cookies-management",":is(fv-cookies-management-sheet, .modal-content):has(.fv-cookies-management) button[class*=\"--primary\"]","fever_cookies_configuration","#fides-overlay, #fides-overlay-wrapper","#fides-overlay-wrapper #fides-banner","#fides-overlay-wrapper .fides-banner-hidden",".fides-banner-button","#fides-banner .fides-reject-all-button",".fides-banner:not(.fides-banner-hidden) .fides-reject-all-button","#fides-banner .fides-manage-preferences-button",".fides-modal-content .fides-reject-all-button",".js-cookie-consent:has(.cookie-consent__accept-essential)",".js-cookie-consent .cookie-consent__accept-essential","[fs-consent-element=banner]","[fs-consent-element=banner] [fs-consent-element=allow]","[fs-consent-element=banner] [fs-consent-element=deny]","[fs-consent-element=banner], [fs-consent-element=root]","#first-visit.first-visit","#first-visit.first-visit a.js-first",".fp-cookie-modal",".fp-cookie-modal .cookie-essentials",".fp-cookie-modal a.cookie-essentials","cookie_consent=essentials","[class*=\"_cookieconsent-banner--open_\"]","[class*=\"_cookieconsent-banner_\"] [class*=\"_cookieconsent__button-container_\"]","[class*=\"_cookieconsent-banner--open_\"] [class*=\"_cookieconsent--initial_\"]","[class*=\"_cookieconsent--initial_\"] [class*=\"_cookieconsent__button-container_\"] > button:nth-child(2)","%22analyticsConsent%22%3Afalse%2C%22thirdPartyConsent%22%3Afalse%2C%22surveyConsent%22%3Afalse",".dse-cookie-disclaimer",".dse-cookie-disclaimer .cta-decline-cookies",".dse-cookie-disclaimer.cookie-visible:not(.cookie-hidden) .cta-decline-cookies",".dse-cookie-disclaimer.cookie-hidden","%22targeting%22%3Afalse",".fc-consent-root,.fc-dialog-container,.fc-dialog-overlay,.fc-dialog-content",".fc-consent-root",".fc-dialog-container",".fc-cta-do-not-consent,.fc-cta-manage-options",".fc-li-only-placeholder",".fc-preference-consent:checked,.fc-preference-legitimate-interest:checked",".fc-confirm-choices","[class*=\"gcb-modal-overlay\"]","[data-gcb-modal-show-prefs]","[data-gcb-modal-save]","gcbcl=a3|m3",".overlay_bc_banner","a[href=\"https://gdpr-legal-cookie.myshopify.com/\"]",".overlay_bc_banner .banner-body",".overlay_bc_banner *[data-cookie-save]","#cookieConsentWidgetDiv .cookie-banner","#cookieConsentWidgetDiv #banner-cookie-consent-reject-all","#banner-cookie-consent-reject-all","g4m_cookie_consent=CONSENT_ESSENTIAL","[data-test-id=\"cookie-banner-body\"]","cookie-banner [data-test-id=\"cookie-banner-body\"] [data-test-id=\"reject-button\"]","[data-test-id=\"cookie-banner-body\"] [data-test-id=\"reject-button\"]",".cdk-global-overlay-wrapper:has(pf-confirm-mat-modal a[href*='getproven.com/privacy'])","pf-confirm-mat-modal a[href*='getproven.com/privacy']","#cookie-container .navbar-cookies","#cookie-container #accetta-cookie .cookie-container-setting","#cookie-container","#accetta-cookie input[type=checkbox]:checked:not(:disabled)","#accetta-cookie .accept","acconsenti-cookie=1",".cookie-banner[data-available-cookies]",".cookie-banner[data-available-cookies] .reject-cookies","CookieConsent=[]","#gtm_privacy","pwinteraction=","[data-aid=FOOTER_COOKIE_BANNER_RENDERED]","[data-aid=FOOTER_COOKIE_BANNER_RENDERED] [data-aid=FOOTER_COOKIE_DECLINE_RENDERED]","[data-aid=FOOTER_COOKIE_BANNER_RENDERED][style*=transform]","a[href^=\"https://policies.google.com/technologies/cookies\"","form[action^=\"https://consent.google.\"][action$=\"/save\"],form[action^=\"https://consent.youtube.\"][action$=\"/save\"]","form[action^=\"https://consent.google.\"][action$=\"/save\"]:has(input[name=set_eom][value=true]) button,form[action^=\"https://consent.youtube.\"][action$=\"/save\"]:has(input[name=set_eom][value=true]) button",".glue-cookie-notification-bar",".glue-cookie-notification-bar__reject",".HTjtHe#xe7COe",".HTjtHe#xe7COe a[href^=\"https://policies.google.com/technologies/cookies\"]",".HTjtHe#xe7COe button#W0wltc","SOCS=CAE",".govuk-cookie-banner__message",".govuk-cookie-banner__message .govuk-button","#gravitoCMPRoot","#gravitoCMPRoot [id^=gravito][id$=-layer1-accept-all]","#gravitoCMPRoot [id^=gravito][id$=-layer1-reject-all]","#gravitoCMPRoot [id^=gravito][id$=-layer1-settings]","#gravitoCMPRoot [id^=gravito][id$=-layer2-reject-all]","gravitoData","[data-test=\"modal-cookie-bottom-bar\"], [data-test=\"section-cookieModal\"]","[data-test=\"modal-cookie-bottom-bar\"]","[data-test=\"button-customizeCookie\"]","[data-test=\"modal-cookie-customize\"]","[data-test=\"modal-cookie-customize\"] input[role=\"switch\"]:checked:not([disabled])","[data-test=\"modal-cookie-customize\"] [data-test=\"button-submit\"], dialog:has([data-test=\"modal-cookie-customize\"]) [data-test=\"button-submit\"]","[data-test=\"section-cookieModal\"] [data-test=\"button-customize\"]","[data-test=\"section-customizeModal\"]","[data-test=\"section-customizeModal\"] input[data-ischecked=\"true\"]:not([disabled])","[data-test=\"section-customizeModal\"] [data-test=\"button-save\"]","gpc_ad=0","cp_advertisement=0","#gr-consent-layer-area","#gr-consent-layer","#gr-btn-more-options","#gr-btn-legitimate-partners","#toggleLegitimateCheckbox","#toggleLegitimateCheckbox:not(:checked)","#gr-btn-save-exit-primary",".bhh-cookie-banner",".bhh-cookie-banner .bhh-cookie-banner__btn--close, .cookie-banner .cookie-banner__btn--close",".bhh-cookie-banner__btn--close, .cookie-banner__btn--close","#cookiebanner.cookiebanner__restrictive","#c-cookiebanner.c-cookiebanner",".js-banner__container .js-banner-button-confirm-selection",".js-banner__container input.js-banner-control__element:checked:not(:disabled)","gsbbanner=closed","#guesty-be-root .cookies__block","#guesty-be-root","#guesty-be-root .cookies__block .cookies__btn--decline","cookiePolicyAccepted=0","div[class^='overlay-cookie-uuid-']","div[class^='overlay-cookie-uuid-'] [class^='button-container-cookie-uuid-']","div[class^='overlay-cookie-uuid-'] [class^='accordion-container-cookie-uuid-']","div[class^='overlay-cookie-uuid-'] button[class*='btn-default-cookie-uuid-']","div[class^='overlay-cookie-uuid-'] input[class^='cookie-uuid-'][id$='-legitimate-interest']","div[class^='overlay-cookie-uuid-'] input[class^='cookie-uuid-'][type='checkbox']:checked",".cookies-bar__close-button","%22advertising%22:0","allow_marketing=deny","shb-cookie-consent","shb-cookie-consent [data-testid=\"CookieConsent_modal\"]","shb-cookie-consent [data-testid=\"cookie_consent_accept_only_necessary_btn\"]","shb-cookies-consent=false","#modal-host > div.no-hash > div.window-wrapper","#modal-host > div.no-hash > div.window-wrapper, div[data-testid=qualtrics-container]","#modal-host > div.no-hash > div.window-wrapper > div:last-child a[href=\"/privacy-settings\"]","div#__next","#__next div:nth-child(1) > button:first-child",".cookie-modal .cookie-accept-btn",".cookie-modal .js-cookie-reject-btn","cookies_rejected=1",".hkd-cookie-banner",".hkd-cookie-banner .hkd-cookie-banner-button-group","next-route-announcer",".hkd-cookie-banner-button-group > button:nth-of-type(2)","cookie-consent=essential",".cookieModalContent","#cookie-banner-overlay","#manageCookie",".cookieSettingsModal","#AOCookieToggle","#AOCookieToggle[aria-pressed=true]","#TPCookieToggle","#TPCookieToggle[aria-pressed=true]","#updateCookieButton","dialog[data-cookie-consent]:has([data-cookie-accept])","dialog[data-cookie-consent] [data-cookie-accept]","a[data-cookie-accept=\"functional\"]","[data-test=\"cookie-consent-notification\"]","[data-test=\"cookie-consent-notification\"] [data-test=\"accept-button\"]","[data-test=\"cookie-consent-notification\"] [data-test=\"dismiss-button\"]","[data-test=\"cookie-consent-notification\"] [data-test=\"settings-button\"]","[data-test=\"cookie-consent-modal\"] [data-test=\"accept-button\"]","#hu.hu-wrapper","#hu.hu-visible","#hu-cookies-save","#hs-eu-cookie-confirmation","#hs-eu-decline-button","#hs-eu-close-button","#cookie-modal","#cookie-modal #gdpr-customize-settings","#cookie-modal #gdpr-reject-all","#cookie-modal #gdpr-save-settings","IB_PRIV_PREFS=1%7C1%7C1","body > #idxrcookies","body > #idxrcookies #idxrcookiesKO","#gdpr-cookie-message","#gdpr-cookie-message #gdpr-cookie-advanced","#gdpr-cookie-types","#gdpr-cookie-types input[type=checkbox]:checked:not(:disabled)","#gdpr-cookie-message #gdpr-cookie-accept2","#gdpr-cookie-message #gdpr-cookie-accept","cookieControl=true","#toast-container.ck-tstr #ck_set","#cmp_settings .cmp__button--reject","cmp_ck=3","#ipc_cookie_confirmation","#ipc_cookie_confirmation .cookie_confirmed_and_close","ipc_cookie=confirmed","[data-in2-modal-root-node]","[data-in2-modal-root-node] .in2-modal-deny-button","[data-in2-modal-root-node] .in2-modal-checkbox__input:checked:not(:disabled)","[data-in2-modal-root-node] [data-in2-modal-save-button]","in2cookiemodal-selection=[%22essential%22]","cookie-consent-element","\"isSelected\":false",".q-notifications .q-notification:has(a[href=\"/cookie-policy\"])",".q-notifications .q-notification a[href=\"/cookie-policy\"]","module-rgpd-component","cookieConsent=consent_1",".accept-cookie",".accept-cookie > .accept-cookie-inner","xpath///*[contains(@class, 'accept-cookie')]//*[contains(text(), 'Decline')]","cookie-pref=rejected","[data-preact=\"cookie-banner/index\"] .js-cookiebar","[data-preact=\"cookie-banner/index\"] .js-cookiebar .js-cookie-deny","form.rodo-popup","form.rodo-popup button.rodo-popup-main-settings","form.rodo-popup button.rodo-popup-reject",".privacy-consent--backdrop",".privacy-consent--modal",".footer-config-link","#confirmSelection",".m-cookie-banner[data-id=\"cookie-banner\"]",".m-cookie-banner[data-id=\"cookie-banner\"] [data-id=\"cookie-manage\"]","#ccc-icon","#ccc-module .ccc-reject-button","\"optionalCookies\":{","\"revoked\"","#iubenda-cs-banner",".iubenda-cs-accept-btn","#iubenda-cs-banner .iubenda-ccpa-opt-out",".iubenda-cs-reject-btn",".iubenda-cs-customize-btn",".iub-btn-reject","#iubFooterBtn","#iubenda-alert .iubenda-button-confirm","#iubenda-cs-banner .iubenda-cs-close-btn","uspString%22%3A%221YY-","body.cookies-request #cookie-bar","body.cookies-request #cookie-bar .disallow-cookies","cookie_permission_granted=no",".js-jcookie",".js-jcookie .js-jcookie-allow",".js-jcookie.active",".widget_eu_cookie_law_widget","#jix-cookie-consent-modal","#jix-cookie-consent-modal input.jix-cookie-consent-selection:checked:not(:disabled)","#jix-cookie-consent-accept-selected","div[class^=pecr-cookie-banner-]","button[data-test^=manage-cookies]","label[data-test^=toggle][class*=checked]:not([class*=disabled])","button[data-test=save-preferences]","[data-testid=\"jkl-cookie-consent-godta\"]","[data-testid=\"jkl-cookie-consent-nekt\"]","[id^=\"jkl-cookie-modal\"] input[type=\"checkbox\"]:checked","\"statistics\":\"denied\"",".js-cookie-consent:has(.cookie-consent__settings-save)",".js-cookie-consent .cookie-consent__settings-save",".js-cookie-consent.cookie-consent--open .cookie-consent__button--secondary",".js-cookie-consent .cookie-consent__button--secondary",".js-cookie-consent .cookie-consent__option-checkbox:checked",".js-cookie-consent.cookie-consent--open",".consent-banner:has(.consent-close-icon-wrapper)",".consent-banner a.consent-close-icon-wrapper[data-pt-name=\"consent-closed\"]","cbc=true",".cookie-bar",".cookie-bar .cookie-bar__message,.cookie-bar .cookie-bar__buttons","cookies-state=accepted",".ui-dialog[aria-describedby=\"cookies\"]","#cookies > #cookies-info #btnCookiesAll","#cookies-info #btnCookiesReject","#cookies-info #btnCookiesOptions","#cookies-options #btnCookiesSelected","#cookies-options input[type=\"checkbox\"]:checked",".gdprPopup:has(> .gdprPopupContainer > .gdprButton)","script#kasp-cookie-alert-js",".gdprPopup > .gdprPopupContainer > .gdprButton",".gdprPopup",".kc-overlay","#kconsent",".kc-dialog","#kc-denyAndHide","#lanyard_root div[role='dialog']","#ketch-banner","#ketch-modal","#lanyard_root [class*='ketch-fixed']","#lanyard_root button[aria-label^='Reject' i], #ketch-banner button[aria-label^='Reject' i]","#lanyard_root [aria-describedby=preference-description], #lanyard_root [aria-describedby=modal-description], #ketch-modal, #ketch-purposes-modal, #ketch-preferences","#lanyard_root button[class*=confirmButton], #lanyard_root div[class*=actions_] > button:nth-child(1), #lanyard_root button[class*=actionButton], #ketch-modal button[aria-label='Confirm'], #ketch-purposes-modal button[aria-label='Confirm'], #ketch-modal button[aria-label='Save Settings'], #ketch-purposes-modal button[aria-label='Save Settings']","#ketch-banner-button-tertiary","#lanyard_root [aria-describedby=banner-description]","#lanyard_root div[class*=buttons] > button[class*=secondaryButton], #lanyard_root button[class*=buttons-secondary], #ketch-banner-button-secondary","#lanyard_root [id^='ketch-banner-buttons-container'] > button:only-child","#lanyard_root [aria-describedby=preference-description],#lanyard_root [aria-describedby=modal-description], #ketch-preferences, #ketch-purposes-modal","#lanyard_root button[class*=rejectButton], #lanyard_root button[class*=rejectAllButton], #ketch-modal button[aria-label='Reject All'], #ketch-purposes-modal button[aria-label='Reject All']","#lanyard_root input[type=checkbox][role=switch][aria-checked=true]:not(:disabled)","_ketch_consent_v1_",".cc-container.cc-noselect",".cc-container .cc-box .cc-section-landing .cc-btn-reject",".cc-container.displayed .cc-section-landing",".cc-container .cc-section-landing .cc-btn-reject","cookie_consent={\"status\":\"rejected\"","#xp-cookie-banner-root dialog.xp-cookie-banner","#xp-cookie-banner-root dialog.xp-cookie-banner[open]",".xp-cookie-banner .xp-cookie-wrapper--buttons button[data-button=\"secondary_cta\"]","klp-marketing-consent=false","body.kolibri [data-testid=\"cookie-widget\"]","body.kolibri [data-testid=\"cookie-widget\"] button.k-button--primary + button.k-button--tertiary","%22advertising%22%3Afalse%2C%22hasConsented%22%3Atrue",".consentForm__container",".consentForm__root .consentForm__acceptButton[data-accept-action=selected]",".consentForm__root",".consentForm__optOutItem input:checked",".consentForm__acceptButton[data-accept-action=selected] button","optOutAccepted=true","modal-box[data-options*=\"cookies\"] .modal-object--cookie",".modal-object--cookie [data-js-cookies-decline]","#kit-ccm",".cookie-settings-message",".cookie-settings-background",".cookie-settings-message #frmCookiesBanner",".cookie-settings-message .cookie-settings-message-close-link",".cookie-settings-message .cookie-settings-manage","#frmCookiesBanner","#frmCookiesBanner input[type=checkbox]:checked",".cookie-settings-message .cookie-settings-message-save-link","#_evh-ric","#_evh-ric #btn_donotaccept","__cpmtAccept=false","#lab-consent","#lab-consent .lab-consent-reject","lab_analytics_consent=denied",".lcc-modal.js-lcc-modal-alert",".lcc-modal.js-lcc-modal-alert .js-lcc-settings-toggle",".lcc-modal.js-lcc-modal-settings",".lcc-modal.js-lcc-modal-settings input[type=checkbox]:checked:not(:disabled)",".lcc-modal.js-lcc-modal-settings .js-lcc-settings-save","__cookie_consent=false","#lw-widget-root #lw-banner","#lw-widget-root #lw-banner.lw-banner-visible","#lw-banner.lw-banner-visible .lw-consent-reject","#lw-banner.lw-banner-visible","\"marketing\":{\"wanted\":false}","#jmdCookieConsentWrapper","[data-cc-window] [data-cc-popup]","[data-cc-window] [data-cc-popup] [data-cc-action=allow]","[data-cc-window] [data-cc-popup] button[data-cc-action=dismiss]","[data-cc-window] [data-cc-popup] [data-cc-action=close-popup]","cookieconsent_status=dismiss",".lia-cookie-banner-alert",".lia-cookie-banner-alert .AjaxFeedback",".lia-cookie-banner-alert a.lia-cookie-banner-alert-reject","#p_p_id_com_liferay_cookies_banner_web_portlet_CookiesBannerPortlet_","script[src*=\"otSDKStub\"]","#_com_liferay_cookies_banner_web_portlet_CookiesBannerPortlet_declineAllButton","CONSENT_TYPE_PERFORMANCE=false",".darken-layer.open,.lightbox.lightbox--cookie-consent","body.cookie-consent-is-active div.lightbox--cookie-consent > div.lightbox__content > div.cookie-consent[data-jsb]",".cookie-consent__footer > button[type='submit']:not([data-button='selectAll'])","#lgcookieslaw_banner,#lgcookieslaw_modal,#lgcookieslaw-modal,.lgcookieslaw-overlay,.lgcookieslaw_overlay",".lgcookieslaw-reject-button-enabled,#lgcookieslaw-overlay,.lgcookieslaw-overlay",".lgcookieslaw-reject-button-enabled .lgcookieslaw-reject-button",".lgcookieslaw-reject-button-enabled",".artdeco-global-alert[type=COOKIE_CONSENT]",".artdeco-global-alert[type=COOKIE_CONSENT] button[action-type=DENY]","#lta-cookies-banner","#js-lta-cookie-modal-trigger","#lta-cookies-modal","#lta-cookies-form input[type=radio][id^=decline-]","#js-lta-cookie-modal-set","%22perf%22:false","#macaron_cookie_box","#macaron_cookie_box .macaronbtn",".macaronbtn.refuse",".macaronbtn.letmechoose",".macaronbtn.letmechoose.open","#cookie_description .paragraph","#cookie_description input[type=checkbox]:checked:not(:disabled)",".macaronbtn.confirmselection","_deCookiesConsent",".cookies-prompt__banner",".cookies-prompt__wrapper .cookies-prompt__banner",".cookies-prompt__banner_preview",".cookies-prompt__banner_preview .cookies-prompt__actions-btn.btn-secondary",".cookies-prompt__actions-wrap_details",".cookies-prompt__banner_details .switch input:checked:not([disabled])",".cookies-prompt__actions-wrap_details .cookies-prompt__actions-btn.btn-secondary","cookies_consent=",".mco-consent-pop-up",".mco-consent-slide-up",".mco-consent-slide-up__backdrop",".mco-overlay:has(.mco-consent)","#mco-consent","[class*=\"mco-consent-\"][class*=\"__button-decline\"]","\"acceptedAll\":false","div[aria-labelledby=pwa-consent-layer-title]","div[class^=StyledConsentLayerWrapper-]","div[aria-labelledby^=pwa-consent-layer-title]","button[data-test^=pwa-consent-layer-deny-all]","#mensajeCookies","#divConfigCookies","#mensajeCookies .cajaCookies #btnAcceptAll","#mensajeCookies #btnAcceptNoAllCookies","#divConfigCookies #btnAcceptNoCookies","#mensajeCookies .cajaCookies","#mensajeCookies #btnConfigCookies","cmm-cookie-banner","#cookies-disclaimer-modal","#cookies-disclaimer-modal #cookies-disclaimer-modal-settings","#cookies-disclaimer-modal #cookies-disclaimer-modal-accept","#cookies-disclaimer-modal-settings","#cookies-settings-modal-header","#cookies-settings-modal-statistics-switch:checked","#cookies-settings-modal-confirm","\"googleAnalytics\":false","[data-testid=\"cookie-policy-dialog\"]","[data-testid=\"cookie-policy-manage-dialog\"]","[data-testid=\"cookie-policy-dialog\"] [data-cookiebanner=\"accept_only_essential_button\"], [data-testid=\"cookie-policy-manage-dialog\"] [data-cookiebanner=\"accept_only_essential_button\"]","[data-cookiebanner=\"accept_only_essential_button\"]",".cmp_gdpr .fondo-cmp",".cmp_gdpr #btn-gdpr-accept",".cmp_gdpr #btn-gdpr-configure",".cmp_gdpr .bt-final.footer button.bt-izq-m","cmp-cl=AA","#wcpConsentBannerCtrl","#msCookieBanner","#msCookieBanner.msCookieBanner",".bottom-cookie-wrap:has(.js-bottom-cookie-close)",".bottom-cookie-wrap .js-bottom-cookie-close","#gdprCookieBar","#gdprCookieBarOverlay",".mst-gdpr__cookie-bar-wrapper",".mst-gdpr__cookie-bar-overlay",".mst-gdpr__cookie-bar .mst-gdpr__buttons",".mst-gdpr__buttons [data-trigger-settings=decline],.mst-gdpr__buttons button[\\@click=handleDecline]",".mst-gdpr__buttons [data-trigger-settings=decline]",".mst-gdpr__buttons button[\\@click=handleDecline]",".mst-gdpr__buttons [data-trigger-settings=trigger]",".mst-gdpr__buttons button[\\@click=openSettings]","[data-mst-gdpr-settings-apply],.mst-gdpr__cookie-settings--success-btn,[x-on\\:click=save]","input.checkbox[data-group-id]:not([disabled]):checked","[data-mst-gdpr-settings-apply]",".mst-gdpr__cookie-settings--success-btn","[x-on\\:click=save]","gdpr_cookie_consent=","#cookies.modal:has(.aceptar-cookies)","#configuracion-cookies.modal","#cookies.modal button[data-bs-target=\"#configuracion-cookies\"]","#cookies.modal .aceptar-cookies","#configuracion-cookies .aceptar-cookies","#configuracion-cookies input[value=analytics-cookies]:checked","#configuracion-cookies input[value=analytics-cookies]","div[role=\"dialog\"]:has(button#necessary[role=\"switch\"]):has(button#marketing[role=\"switch\"]) [role=\"tablist\"]","div[role=\"dialog\"]:has(button#necessary[role=\"switch\"]):has(button#marketing[role=\"switch\"])","div[role=\"dialog\"]:has(button#necessary[role=\"switch\"]) div:not([role=\"tablist\"]) > button:nth-child(3):last-child","decided=true","#__consent .md-consent__inner","#__consent .md-consent__overlay","#__consent form[name='consent'] .md-consent__settings input[type='checkbox']","#__consent:not([hidden]) .md-consent__inner","#__consent .md-consent__settings input[type='checkbox']:checked","#__consent .md-consent__controls button.md-button--primary","#cookiesdirective","#cookiesdirective #explicitreject","dialog[data-testid=\"modal-dialog\"]:has([data-testid=\"uc-button-decline\"])","dialog[data-testid=\"modal-dialog\"] [data-testid=\"uc-button-decline\"]","dialog[data-testid=accept-our-cookies-dialog]","#banner-manage","#pc-confirm","#moove_gdpr_cookie_info_bar","#moove_gdpr_cookie_info_bar:not(.moove-gdpr-info-bar-hidden)",".moove-gdpr-infobar-reject-btn","#moove_gdpr_cookie_info_bar .change-settings-button","#moove_gdpr_cookie_modal",".moove-gdpr-modal-save-settings","#msg-cookie:has(#hide-msg-cookie)","#msg-cookie #hide-msg-cookie","#msg-cookie","#cookie_consent_wrapper #cookie_consent.privacy_headsup","#cookie_consent_wrapper #submit_privacy_consent1","#cookie_consent #cookie_only_necessary2","#gCookieConfirmToast","#gCookieConfirmDimmed","#gCookieConfirmToast .g-cookie-btn-deny","applyCookie=%7B%22typeArr%22%3A%5B%22NECESSARY%22%5D","#nhsuk-cookie-banner","#nhsuk-cookie-banner__link_accept",".bpPrivacy",".bpPrivacy .bpPrivacy_button-close",".js-ne-piwik-cookies",".js-ne-piwik-cookies-overlay",".js-ne-piwik-cookies .ne-piwik-cookies__btn-manage",".js-ne-piwik-cookies .ne-piwik-cookies",".ne-piwik-cookies__btn-manage",".ne-piwik-modal__btn-check-choosen",".ne-piwik-modal input.ne-piwik-modal__checkbox-input:checked:not(:disabled)","ppms_privacy_","%22analytics%22:{%22status%22:0","ccm-notification",".cookie-manager .modal-mask",".cookie-manager .modal-mask .accept-cookie-settings",".cookie-manager .modal-mask .decline-cookie-settings",".cookie-manager .modal-mask input[type=\"checkbox\"]:checked:not(:disabled)",".cookie-manager .modal-mask .save-cookie-settings","#privacy-banner.nyuuninav--privacy-banner",".nyuuninav--privacy-banner .nyuuninav--privacy-banner__accept-button",".nyuuninav--privacy-banner:not(.nyuuninav--privacy-banner--hide)",".nyuuninav--privacy-banner__accept-button","privacy_banner=",".disc-cp--active",".disc-cp-modal__modal",".js-disc-cp-deny-all",".js-occ-gdrp-modal",".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings",".js-occ-gdrp-modal.is-visible .js-occ-gdrp-modal__btn-modal-gdpr-settings",".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings:not(.settings-active)",".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings.settings-active",".js-occ-gdrp-modal .js-cookie-category:checked","occ_gdpr_settings",".tx-om-cookie-consent",".om-cookie-panel[data-omcookie-panel]",".active[data-omcookie-panel]","[data-omcookie-panel-save=min]","input[data-omcookie-panel-grp]:checked:not(:disabled)","[data-omcookie-panel-save=save]","#oc_cb_wrapper","#oc_cb_wrapper #oc_cb_btn",".legalmonster-cleanslate",".legalmonster-cleanslate #lm-cookie-wall-container","#lm-accept-necessary","#o5-legal-banner-container","#o5-legal-banner-container .o5-legal-banner-container__close","#CookieBanner.cookie-banner.drawer","#CookieBanner.cookie-banner.drawer.opened",".osano-cm-window,.osano-cm-dialog",".osano-cm-window",".osano-cm-dialog:not(.osano-cm-dialog--hidden)",".osano-cm-denyAll,.osano-cm-deny",".osano-cm-dialog--type_bar .osano-cm-dialog__close",".cookieBanner--visibility",".cookieBanner__wrapper",".js_cookieBannerProhibitionButton",".cookie-banner:has([data-ol-cookie-banner-set-consent])","[data-ol-cookie-banner-set-consent]","[data-ol-cookie-banner-set-consent=essential]","oa",".js-cookie-notice:has(#cookie_settings-form)",".js-cookie-notice #cookie_settings-form",".js-cookie-notice button[value=disable]","#pandectes-banner","pandectes-cmp","#pandectes-banner .cc-deny","#pandectes-banner .cc-settings",".pd-cp-ui-save",".pd-cp-ui-rejectAll","#passle-cookie-control-container #cookie-control","#passle-cookie-control-container","#passle-cookie-control-container.cookie-control_state--open #cookie-control","#cookie-control .cookie-control--decline","passleCookieControl={%22Accepted%22:false","#ccpaCookieContent_wrapper","#ccpaCookieBanner","#bannerDeclineButton","type%3Dexplicit","#gdprCookieBanner","#gdprCookieContent_wrapper","#overlay > .gdprBackgound","#overlay > .gdprBackgound > .gdprTitle","#overlay > .gdprBackgound > span[onclick]","pxCookie=Y","pe-cookies","TC_PRIVACY=1%40","#consent_block[widget=\"CookieTracker\"]","#consent_block [widget-attachpoint=\"basicAgree\"]",".cookie-wrapper .cookie-tip",".cookie-wrapper .cookie-tip__container",".cookie-wrapper .cookie-tip__text",".cookie-wrapper .cookie-tip__button > .button",".el-dialog.cookie-dialog",".el-dialog.cookie-dialog .el-switch.is-checked",".el-dialog.cookie-dialog .el-dialog__footer button.el-button--primary","allow_analysis=%22false%22","allow_analysis=false","#PiwikPROConsentForm-container",".PiwikPROConsentForm-overlay","#ppms_cm_popup_overlay","#PiwikPROConsentForm-container, #ppms_cm_popup_overlay #ppms_cm_reject-all, #ppms_cm_popup_overlay #ppms_cm_disagree","#PiwikPROConsentForm-container, #ppms_cm_popup_wrapper","#ppms_cm_reject-all, #ppms_cm_disagree","#ppms_consent_form_success_note_button","#PiwikPROConsentForm-reject-all","#PiwikPROConsentForm-toggle-details","#PiwikPROConsentForm-consents","button.PiwikPROConsentForm-consent-checkbox[aria-checked=true]:not([aria-required=true]), input.PiwikPROConsentForm-consent-checkbox:checked:not(:disabled)","#PiwikPROConsentForm-save","%22status%22:0","#cookieBanner","#cookieBanner #openCookieBannerSettings","#cookieBannerSettings #CookieBannerSettingsRejectAll","#cookieBannerSettings","hpa=true","[data-cookie-bar]","[data-cookie-bar] [data-cb=\"acceptAll\"]","[data-cookie-bar] [data-cb=\"declineAll\"],[data-cookie-bar] [data-cb=\"saveNecessary\"]","[data-cookie-bar] [data-cb=\"declineAll\"]","[data-cookie-bar] [data-cb=\"saveNecessary\"]","plenty-shop-cookie=","#pr-cookie-notice #btn-cookie-allow",".pr-cookie-modal:not(._show) #pr-cookie-notice","#pr-cookie-notice #btn-cookie-decline","#pr-cookie-notice .pr-cookie-setting-btn","#pr-cookie-setting-bar .pr-actions-buttons button.decline","pr-cookie-consent=%5B%5D","#pmc-pp-tou--notice","aside[aria-labelledby=\"pmc-privacy-banner-heading\"]","aside[aria-labelledby=\"pmc-privacy-banner-heading\"] button","#js-consent-banner","#js-consent-banner #js-cookie-reject-button","#js-consent-banner #js-cookie-dismiss-button","cookie-consent=","#cookie-consent.c-cookie-banner","#cookie-consent.c-cookie-banner .c-cookie-banner__quickform","#cookie-consent .c-cookie-banner__quickform input[name='Purpose.Statistics'][value='False'] ~ input[type='submit']","%22statistics%22%3Afalse","#spopupCont","#spopupCont #poper #cookie-btn.spopupbtnok","#spopupCont #poper",".cookiesBanner",".cookiesBanner .wrapper-cookies",".gdpr-wrapper",".gdpr-wrapper .gdpr-cookie-wrapper","#cookie-bar .cb-enable,#cookie-bar .cb-disable,#cookie-bar .cb-policy","#cookie-bar .cb-disable","cb-enabled=accepted",".azpp-cookie-consent","\"status\":\"reject_all\"","\"status\":\"do_not_sell\"",".privacyArea",".privacyArea .privacyTrigger.acceptAll","#modulePrivacy .privacyTrigger.acceptCustom",".privacyArea .privacyTrigger.rejectOptional","#modulePrivacy input[type=checkbox]:checked","privacy={\"necessary\":\"ok\"}",".c-cookie-banner-main.c-consent-window",".c-cookie-banner .c-cookie-banner-main.c-consent-window",".c-cookie-banner-main.c-consent-window[style*=\"visibility: visible\"]",".c-cookie-banner-main .c-cookie-banner-header-refuse-btn","elmo_vc={\"purposes\":[\"necessary\"]","#cookie-consent-banner #accept-button","#cookie-consent-banner #deny-button","#cookie-consent-banner #manage-settings-button","#manage-cookies #save-button","#pro_euclp_cookies_box","#pro_euclp_cookies_box .pro_euclp_accept","#euCookiesZone .european-union-cookies-agreement","body[data-page-initialized=true]","#euCookiesZone [data-testid=cookieBannerDismiss]","EUCookieOff=t","#pubtech-cmp","#pubtech-cmp #pt-actions","#pubtech-cmp #pt-close","#pubtech-cmp a[href*=\"pubtech_action_reject_all\"]","xpath///div[@id='qtip-growl-container']/div[contains(@class,'qtip-jgrowl')][.//div[contains(@class,'qtip-title')][contains(., 'ookie')]]","xpath///div[@id='qtip-growl-container']/div[contains(@class,'qtip-jgrowl')][.//div[contains(@class,'qtip-title')][contains(., 'ookie')]]//a[contains(@class,'qtip-close')]","#qc-cmp2-main,#qc-cmp2-container","#qc-cmp2-container","#qc-cmp2-ui,#qc-cmp2-usp","#qc-cmp2-usp","#qc-cmp2-usp .qc-cmp2-list-item-header,#qc-cmp2-usp .qc-cmp2-toggle-switch","#qc-cmp2-usp .qc-cmp2-list-item:not(:has(.qc-cmp2-toggle-switch)) > .qc-cmp2-list-item-header","#qc-cmp2-usp .qc-cmp2-toggle-switch","#qc-cmp2-usp .qc-cmp2-toggle-switch > button[aria-checked=\"false\"]","#qc-cmp2-usp .qc-usp-ui-form-content button[mode=\"primary\"]","#qc-cmp2-mspa-success-modal button","#disagree-btn","#disagree-btn:not([disabled])",".qc-cmp2-summary-buttons button[mode=\"secondary\"]",".qc-cmp2-summary-buttons button[mode=\"secondary\"]:nth-of-type(2)",".qc-cmp2-summary-buttons button[mode=\"secondary\"]:nth-of-type(1)","#qc-cmp2-ui .qc-cmp2-consent-info",".qc-cmp2-toggle-switch > button[aria-checked=\"true\"]","#qc-cmp2-ui",".qc-cmp2-buttons-desktop > button[mode=primary]",".cookieconsent-popup:has(.ui-icon-wrench)",".cookieconsent-popup .cookieconsent-button-wrap button:has(.ui-icon-wrench)",".cookieconsent-edit-settings .cookieconsent-level-changer",".cookieconsent-level-changer > a:nth-of-type(2).activated",".cookieconsent-level-changer > a:first-of-type",".cookieconsent-edit-settings .cookieconsent-dialog-close-btn",".cookieconsent-edit-settings .cookieconsent-dialog-close","cookie_consent_level=","cookie_consent_level=tracking","cookie_consent_level=targeting","cookie_consent_level=functional","#consent_iframe","_svs=%7B%22v%22%3A1%2C%22c%22%3A%7B%221%22%3Atrue%2C%222%22%3Afalse%2C%223%22%3Afalse","#r42CookieBar","#r42CookieBar .cw-deny","#r42CookieBar[open] .cw-deny","feature-modular-cookiebanner-variant-one .cookiebanner-container","#modular-cookiebanner-variant-one-consent-level-button-1","feature-modular-cookiebanner-variant-one .cookiebanner-default-consent-button","RABO_PSL=1","[data-component=RADCookieOverlay] .CookieOverlay","[data-component=RADCookieOverlay] .CookieOverlay_Buttons","[data-component=RADCookieOverlay] .CookieOverlay_ButtonGroup > button:nth-child(2)","cookie=False","#js-legal-disclaimer.g-alert-cookie, #js-legal-disclaimer.cookie-consent-banner, #info-shell-legal-disclaimer, #oh-shell-legal-disclaimer","#raksha-consent-banner","#raksha-consent-overlay","#raksha-decline","#raksha-manage","#raksha-btn-reject","#cookie-policy-notification.r-sdk__policy-notification","#cookie-policy-notification .r-sdk__button","terms-notification=true","#_cpmt-iframe","#concentBanner","#concentPopup","#concentBanner .rdc-save-preferences, #concentPopup .rdc-save-preferences","#concentBanner, #concentPopup","#rcc-decline-button","div[consent-skip-blocker=\"1\"][id][data-bg]","div[consent-skip-blocker=\"1\"][id][data-bg] > dialog > div > div > div > div > div > a[role=button][id]","#cookie:has(a.remove_cookie[onclick*=\"/cookie/close\"])","xpath///div[@id='cookie']//a[contains(@class,'remove_cookie') and contains(@onclick,'/cookie/close') and (normalize-space(.)='OK' or normalize-space(.)='x' or normalize-space(.)='×')]","#cookie a.remove_cookie[onclick*=\"/cookie/close\"]","#cookie","#notification-bar:has(> #close-notification[aria-label=\"Sluit de cookiebanner\"])","#notification-bar > #close-notification[aria-label=\"Sluit de cookiebanner\"]","#notification-bar","#notification-bar > #close-notification","cookie_notification_shown=true",".consent-banner .consent--manage",".consent-banner .consent-banner-copy",".consent-modal .consent-bucket",".consent-modal input[type=checkbox]:checked",".consent-modal .consent-save","#consent-wrapper","#consent-wrapper > .button-container > button.close","cookie_consent_status=","dialog[aria-labelledby='cookie-dialog-title']:has(#deny-consent-button)","dialog[aria-labelledby='cookie-dialog-title'] #deny-consent-button","dialog[aria-labelledby='cookie-dialog-title'][open]",".sv-cookie-management__banner",".sv-cookie-management__banner.sv--visible",".sv-cookie-management__banner .sv-manage-cookies",".sv-cookie-management__modal--visible","#functional-cookies:checked","label[for='functional-cookies']","#tracking-cookies:checked","label[for='tracking-cookies']",".sv-cookie-management__modal--visible .sv-save-close","\"tracking\":false","#scCookieBanner:has(.sc-cookie-reject)","#scCookieBanner .sc-cookie-reject","#scCookieBanner","_consent=denied","[data-module=\"ds-cookie-notification\"]","[data-module=\"ds-cookie-notification\"] .js-accept-essential-cookies","cookiePermissions=eyJuZWNlc3NhcnkiOnRydWUsInByZWZlcmVuY2VzIjpmYWxzZSwic3RhdGlzdGljcyI6ZmFsc2UsImNhbXBhaWducyI6ZmFsc2UsIm1hcmtldGluZyI6ZmFsc2V9",".f-cmp-flyout-wrapper .f-gpc-banner",".f-cmp-flyout-wrapper .f-gpc-banner .f-banner-close-btn",".cc-window",".f-gpc-banner .f-banner-close-btn",".f-gpc-banner","#gdpr-cookie","#gdpr-cookie .js-allow-required","gdpr-cookie=eyJwcmVmZXJlbmNlIjpmYWxzZSwic3RhdGlzdGljIjpmYWxzZSwibWFya2V0aW5nIjpmYWxzZX0",".stpd_cmp_wrapper",".stpd_cmp_wrapper .stpd_cmp_form",".stpd_cmp_wrapper .stpd_flexed_btns button[type=\"submit\"]",".stpd_cmp_wrapper .stpd_flexed_btns button[type=\"button\"]:not(.withdraw_consent)",".stpd_cmp_wrapper .stpd_purposes_list",".stpd_cmp_wrapper input[type=\"checkbox\"]:checked","euconsent-v2=","#shopify-pc__banner","#shopify-pc__banner__btn-decline",".cookie-permission-container[data-cookie-permission]",".cookie-permission-container[data-cookie-permission] .js-cookie-configuration-button",".cookie-permission-container .js-cookie-permission-button",".cookie-permission-container .js-cookie-permission-button button",".cookie-permission-container .js-cookie-configuration-button button",".js-offcanvas-cookie-submit","cookie-preference=1","footer.pageFooter #cookieBanner.cookieBanner","footer.pageFooter #cookieBanner.cookieBanner.visible",".js-top-modal-window-container",".js-top-modal-window-container .modal-link[href*='shueisha.co.jp/privacy']",".js-top-modal-window-container .js-top-modal-content",".js-top-modal-window-container button.close-modal.js-top-modal-close-button","sibbo-cmp-layout","#rejectAllMain","#silktide-banner","#silktide-backdrop","#silktide-banner .reject-all","#silktide-banner .preferences","#silktide-modal .preferences-reject-all",".contentRender_name_plugins_common_cookie_banner",".contentRender_name_plugins_common_gdpr_banner",".contentRender_name_plugins_common_cookie_banner [data-sv-close-banner], .contentRender_name_plugins_common_gdpr_banner [data-sv-close-banner]",".contentRender_name_plugins_common_cookie_banner > :has([data-sv-close-banner]), .contentRender_name_plugins_common_gdpr_banner > :has([data-sv-close-banner])",".contentRender_name_plugins_common_cookie_banner, .contentRender_name_plugins_common_gdpr_banner","#sd-cmp","#sd-cmp [role='dialog']","#sd-cmp [role='button'][title='Close']","[data-t=\"site-notifications\"] [data-notice-key=\"cookie_usage\"]",".SP-CookieUsageNotification","xpath///button[contains(@class,'SP-CookieUsageNotification__ok')][normalize-space(.)='OK' or normalize-space(.)='Ok' or normalize-space(.)='Okay']",".SP-CookieUsageNotification[data-sp-cookie-usage-notification-bootstrapped]",".SP-CookieUsageNotification__ok",".sv-cookie-consent-banner",".sv-cookie-consent-banner form:has(input[name=\"necessary\"]):not(:has(input[name=\"analytics\"])) button[type=\"submit\"]",".sv-cookie-consent-banner button[type=\"button\"]",".sv-cookie-consent-banner button[type=\"submit\"][form]",".sv-cookie-consent-banner form input[type=\"checkbox\"]:checked:not(:disabled)",".sv-cookie-consent-modal",".sv-cookie-consent-modal form:has(input[name=necessary]):not(:has(input[name=analytics])) button[type=submit]",".sv-cookie-consent-modal .env-dialog__controls > button[type=button]",".sv-cookie-consent-modal button[type=submit][form]",".sv-cookie-consent-modal form input[type=checkbox]:checked:not(:disabled)",".sv-iw-cookie #cookie-banner",".sv-iw-cookie #cookie-banner button:nth-of-type(3)",".sv-iw-cookie #cookie-banner button:nth-of-type(2)",".sv-iw-cookie #cookie-banner button:first-of-type",".sv-iw-cookie #cookie-modal",".sv-iw-cookie #cookie-modal input[type=checkbox]:checked:not(:disabled)",".sv-iw-cookie #cookie-modal > div > button:first-of-type",".w-cookie",".w-cookie-modal .w-cookie-actions button[name=accept]",".w-cookie-modal .w-cookie-form",".w-cookie-modal .w-cookie-option input[type=checkbox]:checked:not([disabled])","cookie_consent=REQUIRED",".snigel-cmp-framework","#sn-b-custom","#sn-b-save","snconsent","#cookie_modal","#cookie_modal #id_cookies_necessary","#cookie_modal #id_cookies_all","#cookiebar-tra","#cookiebar-tra #cb-RejectAll, #cookiebar #cb-RejectAll","#cb-RejectAll","cookieConsent=",".cookies-banner .cookies-banner__button-group .cookies-banner__reject",".cookies-banner .cookies-banner__reject","_SC_analytics=reject","#cookies_message","#cookies-message-modal","#cookies-close-deny, #cookies_frame > #cookies_close","#cookies-close-deny","#cookies_frame > #cookies_close","cookies_message_bar_hidden=true","cookies_google_targeting=false","cookies_message_hidden=true","body > div[id^='sp_message_container_']",".cookiebar:has(.cookiebar-ko)",".cookiebar .cookiebar-buttons .cookiebar-ko","#opt-in .optin","#opt-in .optin #optin--acceptAll","#opt-in #optin--rejectAll, #opt-in #optin--onlyNeeded",".cookie-banner-mount-point",".cookie-banner-mount-point section[aria-label='Cookie banner'] :is(button.decline, button.manage)",".cookie-banner-mount-point section[aria-label='Cookie banner']",".cookie-banner-mount-point button.decline",".cookie-banner-mount-point button.manage",".cookie-banner-manager .manage-cookies-overlay",".cookie-banner-manager .manage-cookies-overlay label.sqs-toggle--on input",".cookie-banner-manager .manage-cookies-overlay button.save",".cookie-banner-mount-point section[aria-label='Cookie banner'] button.accept","#cookie-consent-banner #accept-cdp-cookie","#reject-cdp-cookie","squiz.cdp.consent",".cookiepreferences_popup","#rejectAllButton","#_psaihm_main_div","#_psaihm_overlay","#_psaihm_main_div #_psaihm_id_accept_all_btn","#_psaihm_refuse_all","#_psaihm_continue_without_accepting","_psac_gdpr_consent_given=1","_psac_gdpr_consent_purposes=;","#GDPRConsentManagerContainer","#GDPRConsentManagerContainer [data-atx-component='cookieConsent']","#GDPRConsentManagerContainer #explicit_consent","#GDPRConsentManagerContainer #ccmgt_explicit_preferences","#GDPRConsentManagerContainer #ccmgt_preferences_reject","CONSENTMGR=c1:0%7Cc2:0%7Cc3:0",".js-cookie-banner.cookie-banner",".js-cookie-banner.cookie-banner #cookie-banner__settings .js-cookie-settings__form",".js-cookie-banner.cookie-banner .cookie-banner__actions .js-cookie-banner-settings-btn","#cookie-banner__settings .js-cookie-settings__form","#cookie-banner__settings .js-cookie-settings__checkbox:checked:not(:disabled)","#cookie-banner__settings .cookie-settings__submit-btn","-consent-necessary=1","#controlled_banner-cookie_consent-consent_banner","#controlled_banner-cookie_consent-privacy_setting_banner","#controlled_banner-cookie_consent-consent_banner [data-search-key-button=reject_all_text]","#controlled_submit-cookie_consent-consent_banner-privacy_setting_banner_link","#controlled_banner-cookie_consent-privacy_setting_banner [data-search-key-button=reject_all_text]","#controlled_banner-cookie_consent-privacy_setting_banner [role=checkbox][aria-checked=true]","#controlled_banner-cookie_consent-privacy_setting_banner [data-search-key-button=save_settings_text]","[data-testid=\"CookiesReminder\"]","[data-testid=\"CookiesReminder\"] [data-testid=\"CookiesManage\"]","body:not(.disable-transition)","dialog[open] .cookies-select-modal","dialog[open] .cookies-select-modal .cookies-select-modal__buttons .ds-btn-apply-2-ds"," c=%7B%22essential","div[class*=cookieBanner].pencraft","hideCookieBanner=","#CookieConsentBannerPlaceholder","#CookieConsentBannerPlaceholder .cookies-banner-container",".js-consent-modal",".js-consent-modal #validate_cookie_btn, .js-consent-modal #validate_cookie_foreign_btn",".js-consent-modal .modal-content",".js-consent-modal #validate_cookie_foreign_btn",".js-consent-modal #unfold_cookie_btn",".js-consent-modal .cookie-selection",".js-consent-modal .cookie-selection input[type=checkbox]:checked:not(:disabled)",".js-consent-modal #validate_cookie_btn","_gtm_consent_prod=",".syno_cookie_element",".syno_cookie_element .btn_option",".syno_cookie_element .scb_dialog_body",".syno_cookie_element.scb_dialog input[type=checkbox]:checked:not(:disabled):not([readonly])",".syno_cookie_element.scb_dialog .scb_btn_save","syno_confirm_v5_answer","\"targeting\":false","#consent-banner-main","#consent-banner-modal","#consent-banner-modal a[href=\"#reject\"]","#consent-banner-modal a[href=\"#settings\"]","#consent-banner-settings","#consent-banner-settings a[href=\"#reject\"]","#consent-banner-settings input[type=\"checkbox\"]:checked:not(:disabled)","#consent-banner-settings a[href=\"#save\"]","#consent-banner-modal, #consent-banner-settings","div[class^=\"cookies-banner-module_\"]","div[class^=\"cookies-banner-module_cookie-banner_\"]","div[class^=\"cookies-banner-module_small-cookie-banner_\"]","#tarteaucitronRoot","#tarteaucitronAllDenied2","#tarteaucitronCloseAlert",".dsgvoaio-checkbox",".dsgvoaio-checkbox > input:checked","#tarteaucitronPersonalize","#tarteaucitronAllDenied","#tarteaucitronClosePanel","#taunton-user-consent__overlay","#taunton-user-consent__overlay:not([aria-hidden=true])","#taunton-user-consent__toolbar input[type=checkbox]:checked","#taunton-user-consent__toolbar button[type=submit]","taunton_user_consent_submitted=true","#tccCmpAlert","xpath///span[contains(.,'Accetta solo cookie necessari')]","#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs,#__tealiumImplicitmodal,#consent-layer","#__tealiumGDPRecModal *,#__tealiumGDPRcpPrefs *,#__tealiumImplicitmodal *","#__tealiumGDPRecModal #rejectAll,#__tealiumGDPRcpPrefs #preferences_prompt_reject_all_submit","#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs,#__tealiumImplicitmodal","#cm-acceptNone,.js-accept-essential-cookies,#continueWithoutAccepting,#no_consent,#consent_prompt_decline,#teal-decline-consent,#deny_full_submit_1","#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs > *","div[data-cookie-consent]:has(> button[data-cookie-consent-close])","div[data-cookie-consent] > button[data-cookie-consent-close]","#termly-code-snippet-support","#termly-code-snippet-support div","[data-tid=\"banner-decline\"]",".t-preference-button,[data-testid=\"preferences-link\"]",".t-declineAllButton",".t-preference-modal input[type=checkbox][checked]:not([disabled])",".t-saveButton",".termsfeed-com---nb",".freeprivacypolicy-com---nb",".termsfeed-com---nb,.freeprivacypolicy-com---nb",".cc-nb-reject",".cc-nb-changep","input[cookie_consent_toggler=\"true\"]","input[cookie_consent_toggler=\"true\"]:checked",".cc-cp-foot-save",".cc_dialog.cc_css_reboot,.cc_overlay_lock",".cc_dialog.cc_css_reboot",".cc_dialog.cc_css_reboot .cc_b_cp",".cookie-consent-preferences-dialog .cc_cp_f_save button","#reject-all","#privacy-test-page-cmp-test","#privacy-test-page-cmp-test-prehide","#privacy-test-page-cmp-test-banner","#tiGDPRecModal,#tiGDPRcpPrefs","#tiGDPRecModal #consent_pref_center","#tiGDPRecModal .privacy_prompt","#consent_pref_center","#tiGDPRcpPrefs .privacy_prompt","#tiGDPRcpPrefs input.cookie-custom-checkbox:checked","#preferences_prompt_submit","c1:0%7Cc3:0%7Cc6:0%7Cc7:0",".consent-banner-box","consent-banner[component=consent-banner]","button[data-consent=disagree]","#cmpBanner",".tna-cookie-banner",".tna-cookie-banner button[value=\"reject\"]",".tna-cookie-banner__message--prompt button[value=\"reject\"]",".tna-cookie-banner__message--rejected button[value=\"close\"]","cookie_preferences_set=true","%22usage%22%3Afalse","#cookie-banner.visible","#cookie-banner .cookie-banner__container [data-cookie-preferences-button]","#cookie-banner.visible .cookie-banner__container","#ensModalWrapper","#cookie-banner.visible [data-cookie-preferences-button]","#ensModalWrapper #ensSave","#consentModalOverlay","#ensModalWrapper[tabindex]","#ensModalWrapper .ensCheckbox:checked:not(:disabled):not(#EssentialCookiesSlide)","ENSIGHTEN_PRIVACY_TargetingCookies=0",".tp-dialog.cookie-dialog",".tp-cookie-banner",".tp-dialog.cookie-dialog, :not(.tp-cookie-banner-tpl) > .tp-cookie-banner .show-cookie-dialog, #tp-cookie-banner > .tp-cookie-banner + .el-dialog__wrapper",".tp-dialog.cookie-dialog button",":not(.tp-cookie-banner-tpl) > .tp-cookie-banner .show-cookie-dialog","#tp-cookie-banner > .tp-cookie-banner .tp-cookie-button-box","#tp-cookie-banner > .tp-cookie-banner .tp-cookie-button-box .el-button--default","#tp-cookie-banner > .el-dialog__wrapper","#tp-cookie-banner > .el-dialog__wrapper .el-dialog__footer","#tp-cookie-banner > .el-dialog__wrapper .el-dialog__footer button.is-plain:first-child",".tp-dialog.cookie-dialog .tp-dialog-box",".tp-dialog-box .tp-cookie-opt-out",".tp-dialog-box .checkbox.clickable.checked",".tp-dialog-box .tp-cookie-save","_privacy_base=1","_privacy_marketing=1",".my-cookie-wrapper.cc-window",".my-cookie-wrapper [aria-describedby=\"cookieconsent:desc\"] .cc-reject-all",".my-cookie-wrapper:not(.cc-invisible) [aria-describedby=\"cookieconsent:desc\"] .cc-reject-all","cookieconsent_dismissed1=reject_all","div.aem-page > div[class^=\"CookiesAlert_cookiesAlert__\"]","#transcend-consent-manager","[class^=\"app_gdpr--\"] button","[class^=\"app_gdpr--\"] div > button:first-of-type:nth-last-of-type(2)","[class^=\"app_gdpr--\"] div > button:nth-of-type(2):nth-last-of-type(2)","tt_cons_addtl=","pubConsent=",".trillian-cookie-consent-banner",".trillian-cookie-consent-banner .tpc2-reject-all","t_privacy_confirmed=true","#shopify-section-cookies-controller","#shopify-section-cookies-controller #cookies-controller-main-pane","#cookies-controller-main-pane a[data-tab-target=manage-cookies]","#manage-cookies-pane.active","#manage-cookies-pane.active input[type=checkbox][checked]:not([disabled])","#manage-cookies-pane.active button[type=submit]","#truendo_container .tru_cookie-dialog_wrapper",".tru_cookie-dialog_accept-only",".tru_cookie-dialog_accept-only .tru_cookie-dialog_message a[href='']",".tru_cookie-dialog_wrapper [data-cy=banner-options-btn], .tru_cookie-dialog_wrapper [data-cy=optionsBtn], .tru_cookie-dialog_wrapper #tru_options_btn","#truendo_container [data-cy=action-button-necessary]","\"adsPermitted\":false",".T360PurposeOverviewBanner",".T360PurposeOverviewBanner :is(.T360_Banner_Reject, .T360Banner_Reject)","_trust360_=",".truste_popframe.trustarc_newcm_container","cmapi_cookie_privacy=permit 1","cmapi_cookie_privacy=permit 1,2","#truyo-consent-module","#truyo-cookieBarContent","button#declineAllCookieButton",".react-cookie-policy",".react-cookie-policy #cookie-policy","xpath///div[@class='react-cookie-policy']//button[contains(., 'Cookie settings')]","button[role='switch']","xpath///li[contains(., 'Tracking')]//button[@role='switch'][@aria-checked='true']","xpath///li[contains(., 'Advertising')]//button[@role='switch'][@aria-checked='true']","xpath///button[contains(., 'Save and close')]","trybe_cookies_consent_tracking=false","#cookie-onetrust-show-info","#cookie-onetrust-only-necessary","#onetrust-pc-sdk","#onetrust-pc-sdk .ot-pc-refuse-all-handler","#onetrust-pc-sdk input.category-switch-handler:checked","#onetrust-pc-sdk .save-preference-btn-handler","OptanonAlertBoxClosed","iframe.tmblr-iframe--gdpr-banner","[x-data^='cookieNotice('] > .fixed","[x-data^='cookieNotice('][x-data*='tv2reg_cookie_consent']","[x-data^='cookieNotice('] button[\\@click='acceptNecessary'], [x-data^='cookieNotice('] button[x-on\\:click='acceptNecessary']","\"handle\":\"marketing\",\"value\":false","#twcc__mechanism","#twcc__mechanism .twcc__notice","#twcc__decline-button","twCookieConsent=",".cookie-notify:has(a[href*=\"cookies_policy\"]) > button.btn, .cookies-policy-block:has(a[href*=\"cookies_policy\"]) > button.btn, .header__cookie:has(a[href*=\"cookies_policy\"]) > button.btn","#cookieBanner #manage[data-bs-target='#cookieModalSettings']","#cookieBanner .modal-content","#cookieBanner #manage","#cookieModalSettings form button[type=submit]","#cookieModalSettings form input[type=checkbox]:checked","#cookieModalSettings .modal-content",".u-cookie-frame, .modal:has([data-attr='btn-reject-cookies'])",".u-cookie-frame [data-attr='btn-reject-cookies'], .modal [data-attr='btn-reject-cookies']",".u12-data-protection-notice",".u12-data-protection-notice button",".u12-data-protection-notice button.js-decline","dialog.cookie-policy","dialog.cookie-policy header","xpath///*[@id=\"modal\"]/div/header","dialog header","button.js-manage","xpath///*[@id=\"cookie-policy-content\"]/p[4]/button[2]","dialog.cookie-policy .p-switch__input:checked","dialog.cookie-policy .js-save-preferences","xpath///*[@id=\"modal\"]/div/button","_cookies_accepted=essential","#politique_confidentialite","#politique_confidentialite #cookies_settings","#cookie_settings a.refuse","UFT_cookie_notice_accepted=%5B%5D","#catapult-cookie-bar",".has-cookie-bar #catapult-cookie-bar","catAccCookies",".cookie-manager > #cookiebanner","#p-cookie-banner",".cookie-manager #cookiebanner #rejectall, #p-cookie-banner #p-cookie-banner__button--reject",".cookie-manager > #cookiebanner, #p-cookie-banner","uk-parliament.cookie-policy=eyJhbmFseXRpY3MiOmZhbHNl",".cookie-notice-advanced",".cookie-notice-advanced .cookie-bar #cookie-save",".cookie-notice-advanced .cookie-bar",".cookie-notice-advanced input:is(#social-cookies, #advertisement-cookies):checked",".cookie-notice-advanced #cookie-save","#cookieControlWrapper","#cookieControlWrapper #cookieControlBannerManage","#cookieControlWrapper #cookieControlBanner","#cookieControlBannerContent a[onclick*=unicityCookiesRejectAll]","#cookieControlBannerContent a[onclick*=unicityCookiesManage]","#cookieControlBannerManage","#cookieControlBannerManage input[type=checkbox]:checked:not(:disabled)","#cookieControlBannerManage a[onclick*=unicityCookiesSave]","uni_cookies=0,0,0,0","#cookieDisclaimer.cookieDisc","#cpra_banner_wrapper","#cookieDisclaimer a[onclick*=\"handleUSPrivacyAction('reject')\"], #cpra_banner_wrapper #cpra_btn_reject, #userConsentForAdsPopup #allowButton, #gdprPopup #consent_dialog_allow","#cookieDisclaimer, #cpra_banner_wrapper, #userConsentForAdsPopup","#gdprPopup-popup.ui-popup-active","#cookieDisclaimer, #cpra_banner_wrapper","#cookieDisclaimer a[onclick*=\"handleUSPrivacyAction('reject')\"], #cpra_banner_wrapper #cpra_btn_reject","#userConsentForAdsPopup","#gdprPopup a[data-rel=\"back\"]","usprivacy=1YYN",".upcc-cookie-widget",".upcc-cookie-widget .upcc-cookie-reject-all",".upcc-cookie-widget .js-upcc-view-upcc-cookie-options",".upcc-cookie-modal-container .upcc-cookie-reject-all",".upcc-cookie-widget, .upcc-cookie-modal-container","up-cookie-consent=true","up-cookie-consent-options=[\"strictly_necessary\"]","#usercentrics-root,#usercentrics-cmp-ui","#usercentrics-cmp-ui","#usercentrics-root","#usercentrics-button","#usercentrics-button #uc-btn-accept-banner","#usercentrics-button #uc-btn-deny-banner","#cookieconsent-window[aria-describedby=\"cookieconsent-desc\"]","#cookieconsent-window[aria-describedby=\"cookieconsent-desc\"] #cookieconsent-dismiss","#cookieconsent-window","#cookie-banner[data-once~='vdg-cookies-block']","#cookie-banner__config","#cookie-banner__reject","%22analytics%22:false","#cookie_consent:has(#cookie_consent_details)","#cookie_consent #cookie_consent_details :is(#functional-cookie-accept, .functional-button)","#cookie_consent #cookie_consent_summary","#cookie_consent_details :is(#functional-cookie-accept, .functional-button)","cookieconsent_status=accept_functional","[data-slot=\"dialog-content\"] a[href*=\"vivenu.com/dataprivacy\"]","[data-slot=\"dialog-content\"]:has(a[href*=\"vivenu.com/dataprivacy\"]) button:nth-of-type(2)",".consent-overlay","div.consent[role=dialog]","div.consent[role=dialog] .consent-main-buttons .consent-decline-all","PrivacyPolicyOptOut","UsageAnalysisConsent=yes",".cookie.cookie__floating",".cookie.cookie__bar",".cookie__floating__buttons__button--accept, .cookie__bar__buttons__button--accept",".cookie.cookie__floating, .cookie.cookie__bar",".cookie__floating__buttons__button--decline, .cookie__bar__buttons__button--decline","div[aria-labelledby=CookieAlertModalHeading]","section[data-test=initial-waitrose-cookie-consent-banner]","section[data-test=cookie-consent-modal]","button[data-test=manage-cookies]","button[data-test=submit]","wtr_cookies_advertising=0","wtr_cookies_analytics=0",".warning.warning--active:has(.warning__apply)",".warning:has(.warning__text) .warning__apply","#cookie-notice:has(.btn-configure)","#cookie-notice .btn-configure","#modal_cookie-consent","#modal_cookie-consent input.cookie-toggle:checked:not(:disabled)",".cookie_preferences .modal-footer button.fill-primary","%22ConsentAnalytical%22%3Afalse","%22ConsentAdvertising%22%3Afalse","dialog#ltp-dialog, [id=\"id/ltp\"]","dialog#ltp-dialog[open], [id=\"id/ltp/banner\"]","dialog#ltp-dialog","[id=\"id/ltp\"]",".fs-cc-components,[fs-cc=banner]","script[src*=\"@finsweet/cookie-consent\"]",".fs-cc-components,[fs-cc=banner] [fs-cc=allow]","[fs-cc=banner] [fs-cc=deny]","[fs-cc=banner]","fs-cc",".wcc-overlay,.wcc-consent-container",".wcc-consent-container",".wcc-consent-container [data-tag=reject-button]",".wcc-consent-container [data-tag=donotsell-button]",".wcc-modal-open [data-tag=optout-option-toggle]",".wcc-modal-open [data-tag=optout-option-toggle]:not(:checked)",".wcc-modal-open [data-tag=optout-confirm-button]",".wcc-consent-container [data-tag=settings-button]",".wcc-modal-open [data-tag=detail-save-button],.wcc-consent-bar-expand [data-tag=detail-save-button]",".wcc-modal-open [data-tag=detail-category-toggle] input:checked,.wcc-consent-bar-expand [data-tag=detail-category-toggle] input:checked","action:yes","[data-global-privacy-control-banner]","[data-global-privacy-control-banner] > button",".mw-cookiewarning-container","[data-gtm-consent-modal]","[data-gtm-consent-modal].gtm-consent__modal--show","[data-gtm-consent-modal] [data-gtm-consent-close]","[data-gtm-consent-modal] [data-gtm-consent-toggle]","[data-gtm-consent-modal] [data-gtm-consent-details-section]","[data-gtm-consent-modal] [data-gtm-consent-types-form] input[type=checkbox]:checked:not(:disabled)","[data-gtm-consent-modal] [data-gtm-consent-submit]","\"analytics_storage\":false","\"ad_storage\":false","div[role=dialog][aria-modal=true][aria-label*='WP']","[data-comp-type=cookie-banner-root-wix],[data-hook=ccsu-banner-wrapper],[data-comp-type=cookie-banner-root-uou]","[data-comp-type=cookie-banner-root-uou]","[data-hook=consent-banner-decline-all-button]","[data-hook=consent-banner-settings-button]","[data-hook=consent-banner-settings-save-button]","[data-hook=consent-banner-section-toggle-input]:checked:not(:disabled)","[data-hook=ccsu-banner-decline-all]","[data-hook=ccsu-banner-wrapper]",".wccom-comp-privacy-banner .wccom-privacy-banner",".wccom-privacy-banner__content-buttons button.is-style-secondary:has(+ button.is-style-secondary)",".wccom-privacy-banner__content-buttons button.is-style-secondary:not([disabled]):has(+ button.is-style-secondary)",".wccom-privacy-banner__content-buttons button.is-style-secondary:not([disabled]):has(+ button.is-style-primary)",".wccom-modal__footer button.is-style-primary",".wccom-customize-privacy-checkbox input[type=checkbox]:checked:not([disabled])",".wccom-modal__footer button.is-style-primary:not([disabled])","wccom_cookie_consent_analytics=denied","[data-automation-id=\"legalNotice\"]","[data-automation-id=\"legalNoticeDeclineButton\"]","enablePrivacyTracking=false","#cookieconsentpopup.lp__cookie_tooltip","#cookieconsentpopup .accept-consent","consent_cookie=1","#gdpr-cookie-consent-bar","#gdpr-cookie-consent-bar #cookie_action_reject","wpl_viewed_cookie=no",".sp-dsgvo",".sp-dsgvo.sp-dsgvo-popup-overlay",".sp-dsgvo-popup-overlay .sp-dsgvo-privacy-btn-accept-nothing",".sp-dsgvo-popup-overlay .sp-dsgvo-popup-close","integrations%22%3A%5B%5D",".wpcc-container",".wpcc-container .wpcc-message","#wpconsent-root","#wpconsent-container","wpconsent_preferences=",".notice--cookieAdvanced",".js-notice.notice--cookieAdvanced #cookieConsentConfig",".js-notice.notice--cookieAdvanced",".notice--cookieAdvanced a[href*=\"reject=1\"]",".notice--cookieAdvanced [data-xf-click=\"toggle\"][data-target=\"#cookieConsentConfig\"]:not(.is-active)","#cookieConsentConfig button[type=\"submit\"]","#cookieConsentConfig input[name^=\"consent[\"]:checked","_consent=%5B%5D",".cookie_warn",".cookie_warn .cookie_warn_inner","div[class^=cookie-consent-CookieConsent]","#consent-settings-button",".consent-banner-button-accept-overlay","userConsent=%7B%22marketing%22%3Afalse","#cookies-use-alert",".disclaimer-opened #disclaimer-reject_cookies",".disclaimer-opened #disclaimer-cookies","#disclaimer-reject_cookies","#yle-consent-sdk-container .ycd-banner","#yle-consent-sdk-container button[name=accept-necessary-consents]","tp-yt-iron-overlay-backdrop.opened","ytd-consent-bump-v2-lightbox","ytd-consent-bump-v2-lightbox tp-yt-paper-dialog","ytd-consent-bump-v2-lightbox tp-yt-paper-dialog a[href^=\"https://consent.youtube.com/\"]","ytd-consent-bump-v2-lightbox .eom-buttons .eom-button-row:first-child ytd-button-renderer:first-child #button,ytd-consent-bump-v2-lightbox .eom-buttons .eom-button-row:first-child ytd-button-renderer:first-child button",".consent-bump-v2-lightbox","ytm-consent-bump-v2-renderer","ytm-consent-bump-v2-renderer .privacy-terms + .one-col-dialog-buttons c3-material-button:nth-child(2) button, ytm-consent-bump-v2-renderer .privacy-terms + .one-col-dialog-buttons ytm-button-renderer:nth-child(2) button","#zdf-cmp-banner-sdk","#zdf-cmp-main.zdf-cmp-show","#zdf-cmp-main #zdf-cmp-deny-btn",".cookiewarning:has(> button.cookiewarning_yes.close-button)",".cookiewarning > button.cookiewarning_yes.close-button",".cookiewarning",".c-cookies-notification-banner",".c-cookies-notification-banner .c-notification-banner__close-button button",".c-cookies-notification-banner .c-notification-banner--open","_acceptCookies=true",".cookie-alert-extended",".cookie-alert-extended-modal","a[data-controller='cookie-alert/extended/detail-link']",".cookie-alert-configuration-input:checked","button[data-controller='cookie-alert/extended/button/configuration']","#piano-cookie_banner","#piano-cookie_banner [data-close-button]","body > div#root > div#ccpa-iframe-theme-provider[data-testid=\"ccpa-iframe-theme-provider\"] > div#ccpa-iframe[data-testid=\"ccpa-iframe\"] > div#ccpa_consent_banner[data-testid=\"ccpa_consent_banner\"] > div:not([id]) > div:nth-child(3):not([id]) > span:not([id]) > span:not([id]) > div:nth-child(2):not([id]) > span:nth-child(1):not([id]) > button#decline_cookies_button[data-testid=\"decline_cookies_button\"]","body:not([id]) > div#banner-0 > div:nth-child(1)#grouped-pageload-Banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#iubenda-cs-banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(5):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#ds-cookie-consent-banner > div:not([id]) > div:not([id]) > button:nth-child(4)#reject_optional_cookies","body:not([id]) > div#banner-0 > div:nth-child(1)#grouped-pageload-Banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div#clym-app-layout > div:nth-child(2)#clym-notice-layout > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div#clym-app-layout > div:nth-child(2)#clym-notice-layout > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div#clym-app-layout > div:nth-child(2)#clym-notice-layout > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1)#handle-reject-all","body > div#banner-0 > div:nth-child(1)#grouped-pageload-Banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1)#dashboard > div:not([id]) > div:nth-child(2)#dashboard-body-container > div:nth-child(2):not([id]) > button:nth-child(4)#decline-text","body > div:not([id]) > div:nth-child(4):not([id]) > button#cookie_all_reject","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie_all_reject","body > div:not([id]) > div#clym-app-layout > div:nth-child(2)#clym-notice-layout > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1)#handle-reject-all","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1)#dashboard > div:not([id]) > div:nth-child(1):not([id]) > button#decline-text","body:not([id]) > div#root > div#ccpa-iframe-theme-provider > div#ccpa-iframe > div#ccpa_consent_banner > div:not([id]) > div:nth-child(3):not([id]) > span:not([id]) > span:not([id]) > div:nth-child(2):not([id]) > span:nth-child(1):not([id]) > button#decline_cookies_button","body#moneyinvesting > div#top > div#content > div:nth-child(4):not([id]) > a:nth-child(11):not([id])","body > div#banner-0 > div:nth-child(1)#grouped-pageload-Banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3):not([id])","body > div#app > div#app > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(1):not([id]) > div:not([id])","body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(4):not([id]) > div:not([id]) > a:nth-child(1)#ipoclick-btn-cookiebar-ik_ga_niet_akkoord_var_a","body > div[id] > div > div > div > div > div:nth-child(3) > span > span > div:nth-child(2) > span:nth-child(1) > button","div[class^=CookieBannerContent__Container]","button[class^=CookieBannerContent__Settings]","div[class^=CookiePreferencesModal__CategoryContainer] input:checked","div[class^=CookiePreferencesModal__ButtonContainer] > button",".ecoPrivacyMain .ecoPrivacyButton",".ecoPrivacyMain .ecoPrivacyButton:not([disabled])","#app > div[role=alertdialog]","#react-root div[role=alertdialog]","#app > div[role=alertdialog] button .btn-text, #react-root div[role=alertdialog] button .btn-text","#app > div[role=alertdialog], #react-root div[role=alertdialog]","div[role=alertdialog] button:has(.btn-text) + button:has(.btn-text), div[role=alertdialog] > button:has(.btn-text)","pref=%7B%22t%22%3A%22","%22m%22%3Afalse%7D","#overlay.cmp","#overlay[role=dialog]","#deny","#edit-purpose-settings","#save-purpose-settings","ui_cid=OPTOUT","#consentui #buttons .btn.amber","#consentui #buttons .btn.red","#consentui.screen_2 #filters","#consentui #filters input[type=checkbox]:checked","#consentui.screen_2 #buttons .btn.green","#consentManagerButtons .entryPage .settings","#consentManagerEntryPage","#consentManagerButtons .entryPage .declineAll","#consentManagerSettingsPage","#consentManagerButtons .otherPages .declineAll","#gdpr-consent-tool-wrapper","iframe[src^=\"https://cmp-consent-tool.privacymanager.io\"]","button#save","#denyAll",".okButton","#manageSettings",".purposes-overview-list","button#saveAndExit","span[role=checkbox][aria-checked=true]","#cmp-app-container","#save-all-pur","#reminder",".wd-cookie-banner.x-cookie-open",".wd-cookie-banner",".wd-cookie-banner.x-cookie-open .wd-cookie-banner__header__close",".cookie-disclaimer",".cookie-disclaimer a[href*='cprefs=change'], #myModal #cookieprefs",".cookie-disclaimer, #myModal #cookieprefs","#myModal #cookieprefs","#cookieprefs input[type=checkbox]:checked","#cookieprefs input[type=submit]",".cookie-disclaimer a[href*='cprefs=change']","adc-cookie-banner","cookie_banner=closed","[data-component=CookieBanner]","[data-component=CookieBanner] [data-component=CookieBanner_AcceptAll]","[data-component=CookieBanner] [data-component=CookieBanner_AcceptABCRequired]","trackingconsent",".fc-consent-root .fc-dialog-container","[data-testid=\"cookies_reject\"]","#__next > div:has(> p > a[href*='cookie-policy'])","xpath///div[@id='__next']/div[h2[normalize-space(.)='Cookies on this website']]","xpath///div[@id='__next']/div[h2[normalize-space(.)='Cookies on this website']]//button[contains(., 'do not use analytics cookies')]","#cookie-consent-banner #cookie-consent-accept","#cookie-consent-accept","cookie-consent=1","aside#cookies,.overlay-cookies","#cookies .cookies-btn","#cookies #submitCookies","#cookies #rejectCookies",".fullpageCover",".fullpageCover a[href*='/go/page/privacy.html']",".fullpageCover div.rounded-full:nth-child(2)","#popup_cookies","#popup_cookies .boton_cookies","#cookies_consent_div","#popup_content.cookies_consent_div .config_cookies","#popup_content #configurar_cookies","#popup_content .cookie_button:not(.cookies_tecnicas) input[type=checkbox]:checked","#popup_content .not_explanation.aceptar_cokies","#cookie-overlay","#decline-cookies","[data-testid=\"main-cookies-banner-container\"]","[data-testid=\"main-cookies-banner-container\"] section > div > div:nth-child(2) > div:nth-child(2) > button","#aag-cookie-consent","#gdpr-new-container","#gdpr-new-container,#voyager-gdpr > div,#voyager-gdpr-2025 > div > div > button","#voyager-gdpr > div","#voyager-gdpr > div > div > button:nth-child(2)","#voyager-gdpr-2025 > div > div > button","#voyager-gdpr-2025 > div > div > button:nth-of-type(3)","#voyager-gdpr-2025 > div > div > button:nth-of-type(2)","#voyager-gdpr-2025 > div > div > button:last-of-type","#voyager-gdpr-2025 > div > div > div > button:last-of-type","#gdpr-new-container button:nth-of-type(3)","#gdpr-new-container button:nth-of-type(2)","#gdpr-new-container button:first-of-type","#voyager-gdpr-2025","#voyager-gdpr-2025 button:last-of-type",".cookie-message",".cookie-message .cookie-agree","div:has(> div > button[allytmln=ally-cookie-consent])","button[allytmln=ally-cookie-consent]","#banner","#banner #bannerFooter music-button","#banner #bannerFooter",".cookie-menu.js-cookie-banner",".cookie-menu.js-cookie-banner .js-cookie-banner-close","apaycnst-mktg=true","#cookie-agreement","#cookie-agreement .dismiss","#a69-cookie-banner","#a69-cookie-banner #a69-cookie-manage","#a69-cookie-manage","#a69-cookie-modal","#a69-cookie-analytics:checked","#a69-cookie-save","a69_cookie_preferences=%7B%22analytics%22%3Afalse","#arb-cookie-banner-section","#arb-cookie-banner-section button","#arb-cookie-banner-section button:first-of-type","xpath///div[@role='dialog'][.//h2[normalize-space(.)='This website uses cookies']]","xpath///div[@role='dialog'][.//h2[normalize-space(.)='This website uses cookies']]//button[normalize-space(.)='Manage Cookies']","[role='dialog'] button[role='switch']#advertising","[role='dialog'] button[role='switch'][aria-checked='true']","xpath///div[@role='dialog'][.//button[@role='switch']]//button[normalize-space(.)='Save Preferences']","\"advertising\":false","#cookiePolicy","#cookiePolicy #cookiebar-btn","cookie policy accepted=","#AcceptCookies2 #MrktConfirm","#AcceptCookies","#AcceptCookies input[onclick*=AcceptCookies2]","#AcceptCookies2","#AcceptCookies2 input[type=checkbox]:checked","#AcceptCookies2 input[onclick*=SetCookie]","MrktConfirm=false","#footer-container ~ div","#footer-container > div","#gpc-banner-container","\"consent\":\"d\"","form.test-cookie-consent","form.test-cookie-consent [data-cookie-consent-target=\"screen1\"]","form.test-cookie-consent [data-action=\"cookie-consent#showSettings\"]","form.test-cookie-consent [data-cookie-consent-target=\"screen2\"] [data-action=\"cookie-consent#rejectAll\"]","%22ad_storage%22%3Afalse","body > div#shopify-section-popups > div:nth-child(1):not([id]) > modal-box#modal-popups-0 > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#cookieNotice > span:not([id])","body > div#cookieAreaBase > div#cookieArea > p:nth-child(1):not([id]) > a:nth-child(3):not([id])","body > div#cookieAreaBase > div#cookieArea > div:nth-child(2):not([id]) > a:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body#customcss > div#root > div:nth-child(4):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > span:nth-child(1):not([id]) > div:nth-child(5):not([id]) > button:nth-child(2):not([id])","body > div#cookieConsentModal > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div#cookie-banner-deezer > div#gdpr-dir-tag > div:not([id])[data-testid=\"cookie-banner\"] > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button#gdpr-btn-refuse-all[data-testid=\"gdpr-btn-refuse-all\"]","body:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div:not([id]) > div#gdpr_notification_container > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(6):not([id]) > div:not([id]) > a#gdpr_reject_button","#cookiesPortletDiv","#cookiesPortletDiv .cookie-buttons","#cookiesPortletDiv button[aria-label='Only Mandatory']","body > div#cookie-policy > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])",".MuiStack-root:has(a[href='/privacy']):has(button)","body > div#portal-cookie-banner > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2)#portal-cookie-banner__wrapper > aside#portal-cookie-banner__content > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#messages > div:nth-child(1)#shopify-section-cookie-banner > section#shopify-section-cookie-banner > div:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div#messages > div:nth-child(2)#shopify-section-newsletter-banner > section:nth-child(1):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > form#trackingConsent > button:nth-child(2):not([id])","body:not([id]) > div#cookieConsent > div:nth-child(2):not([id]) > a:nth-child(3):not([id])","body > pnp-root:not([id]) > div:not([id]) > ui-storefront:not([id]) > footer:nth-child(8):not([id]) > cx-page-layout:not([id]) > cx-page-slot:not([id]) > cms-popia-component:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#___gatsby > div:nth-child(1)#gatsby-focus-wrapper > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])","body > div#layout-fea-0-bd-5-e-e-723-4027-aa-78-dbcc-846073-a-6 > div#page-62928 > div:not([id]) > div:nth-child(8)#\\31 e9783d2-3575-4c86-b6e8-bc0fd6b17307 > div#\\31 e9783d2-3575-4c86-b6e8-bc0fd6b17307-banner > div:nth-child(3):not([id]) > a:nth-child(1)#\\31 e9783d2-3575-4c86-b6e8-bc0fd6b17307-decline","body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div#c-cookiebanner > section:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > p:nth-child(1):not([id]) > button:not([id])","body > div#wrapper > div:nth-child(4):not([id]) > button:nth-child(3):not([id])","body > div#frame-modals > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#message-banner > div:not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div#cookiemodal > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(5)#footer-cookie-buttons > a:nth-child(2)#footer-cookie-close","body > div#notice-cookie-block > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div#termsfeed-pc1-notice-banner > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(2)#termsfeed_privacy_consent_banner_button_reject_all","body > main:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > hathi-cookie-consent-banner:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cookies-modal > div:nth-child(2)#consent-modal > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id]) > span#consent-modal-refuse","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div#csm-wrapper > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#root > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(1):not([id]) > button:not([id])","body > div#body-wrapper > section:nth-child(5):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div#wrapwrap > div:nth-child(5)#website_cookies_bar > div:not([id]) > div:not([id]) > div:not([id]) > section:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(1)#cookie-banner-essential","body > aside:not([id]) > div:nth-child(2)#cookie-consent-modal > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div#cc--main > div#cc_div > div:nth-child(1)#cm > div#c-inr > div:nth-child(2)#c-bns > button:nth-child(2)#c-s-bn","body > div#dk-cookie-message > div:not([id]) > button:nth-child(3):not([id])","body > aside:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(3):not([id])","body > div:not([id]) > div:not([id]) > div#ch2-settings-dialog > div:nth-child(3):not([id]) > div:nth-child(1)#ch2-settings > button:nth-child(4):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > a:nth-child(3):not([id])","body:not([id]) > div#cookieConsentBanner > div#cookieConsentContent > button:nth-child(4)#closeConsentBanner","body:not([id]) > div#cookies-modal > div:nth-child(2)#consent-modal > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id]) > span#consent-modal-refuse","body > div:not([id]) > a:nth-child(3):not([id])","body > div#root > div:nth-child(2):not([id]) > div:nth-child(5):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#tna-cookie-prompt-banner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#reject-cookie","body > div#ecom2-spa-root > div:nth-child(4)#layout-grid > div:nth-child(4)#main-content-v2 > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])[data-testid=\"cookie-btn-deny\"]","body > div:not([id]) > div:not([id]) > button:nth-child(5):not([id])","body > div#gdprCookieBar > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div#c-footerBrandV1 > footer:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div#ez-cookie-notification > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#ez-cookie-notification__decline","body > div#site-wrapper > div:nth-child(1)#site-canvas > div#wrapper1 > main:nth-child(2)#mainSection1 > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2)#cookieadmin_reject_button","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:not([id])","body > div#privacy-cookie-banners-root > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id])[data-testid=\"CookieBanner\"] > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > form:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div#oax-dialog-main > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > aside#cmp-banner > form:not([id]) > div:nth-child(4):not([id]) > section:not([id]) > div:not([id]) > button:nth-child(1)#cmp-deny-all","body > main#main > div:nth-child(6):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > a:not([id])","body > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])[data-testid=\"s-r-bu\"]","body > div#consent_manager-background > div:nth-child(1)#consent_manager-wrapper > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#consent_manager-accept-none","body > div#ampsandConsentElement > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > section#cookie-consent > div:not([id]) > form:nth-child(3):not([id]) > div:nth-child(5):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div#cookie-banner > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-banner-reject","body > privacy-banner:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id]) > span:not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1)#hw-cc-notice-deny-btn","body > div#cookieconsent > div#cookieconsent-bar > div:nth-child(3):not([id]) > a:nth-child(2)#decline","body > header#header > div:nth-child(1)#CookiesConsent > div:not([id]) > div:nth-child(2):not([id]) > form:nth-child(2):not([id]) > div:nth-child(5):not([id]) > button:not([id])[data-testid=\"AcceptRequiredCookies\"]","body > div:not([id]) > div:nth-child(1)#ccm-widget > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cookieChoiceInfo > div:nth-child(2)#cookieButtonBar > a:nth-child(2)#cookieChoiceRefuse","body > dialog:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div#consent-manager > div:nth-child(1)#consent-banner > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button#consent-banner-btn-close","body > div#orejime > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])","body > section#cookie-policy > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cbgccp-cookies-banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2)#cbg_ccp_cookie_refuse_optional_btn","body > div > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(5):not([id]) > button:nth-child(1)#fd-unCheckAll","body > div:not([id]) > div#csm-wrapper > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div#__next > div:nth-child(5):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#__next > div:nth-child(5):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > dialog:not([id]) > article:not([id]) > footer:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#entry > div:nth-child(2)#main > div:nth-child(4):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#__next > div:nth-child(3):not([id]) > dialog:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cb-cookie-warning > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#cb-cookie-warning__button--decline","body > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cookies-banner > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2)#gdpr-popup-v3-button-mandatory","body > div:not([id]) > div:nth-child(1):not([id])[data-testid=\"privacy-banner\"] > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2)#react-aria491930105-\\:r29\\:[data-testid=\"privacy-banner-decline-all-btn-desktop\"]","body > div#tc-privacy-wrapper > div#footer_tc_privacy > div:not([id]) > div:nth-child(2)#footer_tc_privacy_container_button > button:nth-child(2)#footer_tc_privacy_button_2","body > div#tc-privacy-wrapper > div:nth-child(2)#footer_tc_privacy > div:nth-child(2)#footer_tc_privacy_container_button > button:nth-child(3)#footer_tc_privacy_button_3","body > div#app > div:nth-child(1)#__nuxt > div#__layout > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > a:nth-child(2):not([id])","body > footer:not([id]) > div:nth-child(2):not([id]) > cookie-notice:nth-child(1):not([id]) > div#cookie-notice > div:not([id]) > div#cookie-notice-inner > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > button#cookie-notice-decline","body > div#sell-root > div:nth-child(2)#appRoot > div:nth-child(7):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(2)#BorlabsCookieBox > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > p:nth-child(6):not([id]) > a:not([id])","body > div:not([id]) > div:nth-child(1)#consent-manager > footer:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#app > div:nth-child(7):not([id])[data-testid=\"cookieBanner\"] > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])[data-testid=\"onlyNecessaryCookies\"]","body > div#tc-privacy-wrapper > div#footer_tc_privacy > div:nth-child(2)#footer_tc_privacy_container_button > button:nth-child(2)#footer_tc_privacy_button_2","body > div#root > div:nth-child(2):not([id]) > div:not([id]) > div:not([id])[data-testid=\"cookie-consent-banner\"] > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#c-pop > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#ctl07_declinebtn","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id])","body > div#cookieNoticePro > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookieReject","body > div#gdrp-cookieoverlay > div:nth-child(3)#cs2gdpr-cookiebanner > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#btn-accept-required-banner","body > div#seeGdprCookieConsent > div:not([id]) > p:nth-child(2):not([id]) > a:nth-child(2)#seeGdprReject","body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(2)#popin_tc_privacy_button_2","body > div#SgCookieOptin > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cookieman-modal > div:not([id]) > div:not([id]) > div:not([id]) > button:nth-child(6):not([id])","body > div#c20343 > div:nth-child(1)#ikanos-privacy-cookielayer > div:nth-child(2):not([id]) > form:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div#consent-manager > div:nth-child(1)#consent-banner > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#consent-banner-btn-close","body > div#mm-2 > div:nth-child(2)#cookie-consent > div:not([id]) > form:nth-child(3):not([id]) > div:nth-child(5):not([id]) > button:nth-child(2):not([id])","body > div#root > div:not([id]) > div:nth-child(2):not([id]) > main:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])","body > div#application > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > a:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(6):not([id]) > div:nth-child(2)#BorlabsCookieBox > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > p:nth-child(5):not([id]) > a:not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > a:not([id])","body > dialog#ai-hinweis > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > center:not([id]) > button:nth-child(1)#policy_notwendig","body > div:not([id]) > div:nth-child(1)#ccm-widget > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(3):not([id])","body > div#BannerRegion > div:nth-child(1)#Banner_cookie_0 > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2)#rejectAllBtn","body > comply-consent-manager:not([id]) > div#comply-consent-manager > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#__next > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id])[data-testid=\"cookie_notice_reject_all_button\"]","body > div#tc-privacy-wrapper > div:nth-child(2)#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(2)#popin_tc_privacy_button_2","body > div#__nuxt > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > section:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div#cdk-overlay-0 > mat-dialog-container:nth-child(2)#mat-mdc-dialog-0 > div:not([id]) > div:not([id]) > hra-consent-layer-ui:not([id]) > hra-cookie-buttons:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id]) > span:nth-child(2):not([id])","body > div#cookie-note-main > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-accept-required","body > aside:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(5):not([id]) > button:nth-child(4):not([id])","body > div#cookiebanner-body > div:nth-child(1)#cookiebanner > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:not([id])","body > div#app > div:nth-child(1)#header > div:nth-child(2)#cookie_banner > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#__nuxt > div#__layout > div#app > div:nth-child(6):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div#__nuxt > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > section:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > section#shopify-pc__banner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#shopify-pc__banner__btn-decline","body > div#__nuxt > div#__layout > div:not([id]) > section:not([id]) > div:nth-child(2):not([id]) > section:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#consent-manager > div:nth-child(1)#consent-banner > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#consent-banner-btn-close","body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > p:nth-child(2):not([id]) > a:not([id])","body > div#tc-privacy-wrapper > div:nth-child(2)#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(3)#popin_tc_privacy_button_3","body > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])","body > div#modal-wrap > section#modal-content > div:not([id]) > div:nth-child(2)#cookie-banner > div:not([id]) > div:nth-child(1)#s1 > p:nth-child(5):not([id]) > a:nth-child(4)#button_reject","body > div#cookie-consent-banner > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#btn-reject-all","body > div#cc-button > div#cc-text > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#page > main:nth-child(2)#index > div:nth-child(3)#cookie-settings-modal > div:not([id]) > div#cookie-settings > div:nth-child(4):not([id]) > button:nth-child(3):not([id])","body > div#__nuxt > div:nth-child(8)#cookie-banner > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#consentBanner > div:not([id]) > div#gdpr-banner-container[data-testid=\"gdpr-banner-container\"] > dialog#gdpr-banner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#gdpr-banner-cmp-button[data-testid=\"gdpr-banner-decline-button\"]","body > div#consentWidget > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#denyBtn","body > div#portal-footer > div:nth-child(3):not([id]) > div:nth-child(2)#footer-analytics > div#CookieConsent > div:not([id]) > p:nth-child(2):not([id]) > span:nth-child(3):not([id]) > button:not([id])","body > div#cookieman-modal > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(1):not([id])","#tc-privacy-wrapper","[data-testid=\"consentManager\"]","[data-testid=\"privacyBanner-rejectAll\"]","body > div#ww_bzga_matomo_cookiebanner > div:not([id]) > p:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#ddt-M1 > div:not([id]) > div:nth-child(1)#ddt-Seite1 > div:nth-child(2)#ddt-sectionFirst > p:nth-child(4):not([id]) > a:nth-child(2):not([id])","body > div:not([id]) > div#cookies-bar > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div#csm-wrapper > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body > div#cookie-consent > div:not([id]) > form:nth-child(3):not([id]) > div:nth-child(5):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2)#cookie-consent[data-testid=\"cookie-consent-banner\"] > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(3)#popin_tc_privacy_button_3","body > div#_evidon-barrier-wrapper > div:nth-child(2)#_evidon-banner > div:nth-child(1)#_evidon-banner-content > div:nth-child(5):not([id]) > button:nth-child(2)#_evidon-barrier-declinebutton","div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2)#BorlabsCookieBox > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > p:nth-child(2):not([id]) > a:not([id])","body > div#consent_modal[data-testid=\"Over18ModalVariant1Modal\"] > div:nth-child(2):not([id])[data-testid=\"Over18ModalVariant1Content\"] > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1)#reject-all-cookies-btn","body > div:not([id]) > div:nth-child(1)#matomoCookieNotification > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#disallowMatomoCookieNotification","body > div:not([id]) > aside:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > span:nth-child(1):not([id]) > button:not([id])","body > div#__nuxt > div:not([id]) > div:nth-child(6):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(1)#cookies-eu-banner > div:not([id]) > div:not([id]) > button:nth-child(4)#cookies-eu-reject","body > div:not([id]) > div:not([id]) > div:not([id]) > ul:not([id]) > li:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#__nuxt > div:not([id]) > div:nth-child(8):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div#optInId > div:nth-child(4):not([id]) > button:nth-child(2)#Ablehnen","body > div:not([id]) > div#cpnb > div#w357_cpnb_outer > div:not([id]) > div:nth-child(2):not([id]) > span:nth-child(2)#cpnb-decline-btn","body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#a-page > div:nth-child(5)#sc-content-container > div:nth-child(1):not([id]) > div:nth-child(12):not([id]) > div:nth-child(1) > div:nth-child(2)#cookie-consent-window > div:not([id]) > div:nth-child(2) > div:nth-child(1)#cookie-consent-continue > div:not([id]) > a:not([id])","body > div:not([id]) > div:nth-child(1)#ccm-widget > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#__next > div:not([id]) > div:not([id]) > main:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(4):not([id]) > div:nth-child(1):not([id])","body > div#acris--page-wrap--cookie-permission > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-permission--accept-only-functional-button","body > div#cookieConsentBanner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#consentMinimal","body > div#elGuestTerms > div:not([id]) > div:nth-child(2):not([id]) > form:not([id]) > button:nth-child(3):not([id])","body > div#mm-0 > div:nth-child(2)#cookie-consent > div:not([id]) > form:nth-child(3):not([id]) > div:nth-child(5):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id])","body > div#cookiebar > div:not([id]) > span:nth-child(3)#declineCookie > button:not([id])","body > main#content > aside:nth-child(10):not([id]) > div:not([id]) > wm-stack:nth-child(2):not([id]) > wm-button:nth-child(1):not([id]) > button:not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])","body > div#tc-privacy-wrapper > div#footer_tc_privacy > div:nth-child(1)#footer_tc_privacy_container_text > div#footer_tc_privacy_text > h2:nth-child(1):not([id]) > button#footer_tc_privacy_button_2","body > div#bandeau_cgv > div:not([id]) > div:not([id]) > a:nth-child(1)#dismiss-cookies","body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > section:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])","body > article:not([id]) > header:nth-child(2)#header > div:nth-child(1)#cookie-modal > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div#root > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookieRefuse","body > div#cookie-banner > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(3)#reject-cookies","body > div:not([id]) > div:not([id]) > div:not([id]) > div#P0-0 > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])","body > div#ppms_cm_consent_popup_7a8e4f13-52de-496c-9239-96129f02cf08 > div#ppms_cm_popup_overlay > div#ppms_cm_popup_wrapper > div:nth-child(1)#ppms_cm_popup > div:nth-child(3)#ppms_cm_popup_main_id > div:nth-child(2)#ppms-124c44a9-52c6-4136-9964-9a6be955271a > button:nth-child(2)#ppms_cm_disagree","body > div#cookie > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > a:nth-child(2):not([id]) > span:not([id]) > span:not([id])","body > div#orejime > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])","body > div#cookie-message > a:nth-child(2):not([id])","body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(1)#popin_tc_privacy_container_text > div#popin_tc_privacy_text > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#refuse_all","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#main > div:nth-child(11)#cookbar_overlay > div#cookbar > span:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > a:nth-child(3):not([id])","body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(1)#popin_tc_privacy_button","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > main#main > dialog:nth-child(25):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > div#cookie-banner > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:not([id])","body > div:not([id]) > div:nth-child(1):not([id])[data-testid=\"privacy-banner\"] > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2)#react-aria526766221-\\:r0\\:[data-testid=\"privacy-banner-decline-all-btn-desktop\"]","body > div:not([id]) > form:nth-child(4):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button#cookie_consent_use_only_functional_cookies","body > div#cookiesplus-modal-container > div:not([id]) > div:nth-child(1)#cookiesplus-modal > div:nth-child(3)#cookiesplus-content > div:not([id]) > form#cookiesplus-form > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > app-root:not([id]) > div:not([id]) > app-cookie-banner:nth-child(3):not([id]) > div:nth-child(1):not([id]) > div:nth-child(2)#reject-cookie-link > button#reject-cookie","body > main:not([id]) > footer:nth-child(4)#footer > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3)#acb-banner > div:nth-child(2)#acb-action > button:nth-child(1)#acb-deny-all-button","body > div#st-cmp-v2 > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > span:not([id]) > div:not([id])","body > div#cookie-consent > div:nth-child(1):not([id]) > button:nth-child(1)#cookie-deny-button","body > div#advencyRgpd > button:nth-child(3)#refuseAll","body > div#rgpd > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(1):not([id])","body > div#consent > user-consent:nth-child(1):not([id]) > consent-dialog:not([id]) > consent-content:not([id]) > consent-message:nth-child(1):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(2):not([id])","body > div#bottom-banner > div:nth-child(3):not([id]) > div:nth-child(1)#cookies-win > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id])[data-testid=\"cookie-consent-banner\"] > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(2)#BorlabsCookieBox > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > p:nth-child(8):not([id]) > a:not([id])","body > div#___gatsby > div:nth-child(1)#gatsby-focus-wrapper > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body > div#privacy-banner > div:nth-child(3):not([id]) > button:nth-child(1)#privacy-rejected","body > div#cookie > div:not([id]) > div:nth-child(2)#Buttondivanalytic > button:nth-child(2):not([id])","body > div:not([id]) > p:nth-child(2):not([id]) > button:nth-child(2)#seopress-user-consent-close","body#top > div:not([id]) > form:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#cookie-notice > div:not([id]) > span:nth-child(2)#cn-notice-buttons > button:nth-child(2)#cn-refuse-cookie","body:not([id]) > div#BannerRegion > div:nth-child(1)#Banner_cookie_0 > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2)#rejectAllBtn","body:not([id]) > div#tc-privacy-wrapper > div#footer_tc_privacy > div:nth-child(2)#footer_tc_privacy_container_button > button:nth-child(2)#footer_tc_privacy_button_2","body#html-body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body:not([id]) > div#modal-root > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id]) > div:not([id])","body:not([id]) > div#root > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cookie-banner-container > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cookie-law > div:not([id]) > div:nth-child(1):not([id]) > button:nth-child(12):not([id])","body:not([id]) > div#__next > div:not([id]) > div:nth-child(8):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body:not([id]) > div#root > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id])","body:not([id]) > header#header > div:nth-child(1)#CookiesConsent > div:not([id]) > div:nth-child(2):not([id]) > form:nth-child(2):not([id]) > div:nth-child(5):not([id]) > button:not([id])","body:not([id]) > div#__next > div:not([id]) > div:nth-child(6)#cw-footer-container > footer:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id]) > span:nth-child(2):not([id]) > span:nth-child(1):not([id])","body > div#cookie_alert > div:nth-child(2)#cookie_alert_container > div#cookie_alert_text > div:nth-child(2):not([id]) > div:nth-child(2)#js-cookie_alert_button_decline > a#cookie_alert_decline","body > div > div:not([id]) > div:nth-child(1) > div:nth-child(2)#cookieDisclaimer > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:not([id])","body:not([id]) > dialog:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body:not([id]) > dialog:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body#unlogged-body > div#cookie-banner-deezer > div#gdpr-dir-tag > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button#gdpr-btn-refuse-all","body:not([id]) > section:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body:not([id]) > section#cookie-policy > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body:not([id]) > div#cc--main > div#cc_div > div:nth-child(1)#cm > div#c-inr > div:nth-child(2)#c-bns > button:nth-child(1)#c-s-bn","body > div#headlessui-portal-root > div:not([id]) > div:nth-child(2):not([id]) > div#headlessui-dialog-_r_0_ > div:nth-child(2):not([id]) > div#headlessui-dialog-panel-_r_6_ > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(3):not([id])","body:not([id]) > div#cookie-wall > div#cwi > div:nth-child(4)#cw-controls > div:not([id]) > div:nth-child(4):not([id]) > button:nth-child(2)#cwc-reject > span:not([id])","body > div:not([id]) > div#csm-wrapper > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#sliding-popup > div#cookiepopup > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div#elGuestTerms > div:not([id]) > div:nth-child(2):not([id]) > form:not([id]) > button:nth-child(3):not([id])","body:not([id]) > div#consent-box > p:not([id]) > span:not([id]) > button:nth-child(2)#decline-cookies","body > div#__next > div:nth-child(3)#cookieBanner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > form:nth-child(2):not([id]) > button:nth-child(2)#cookieConsentRejectAll","body:not([id]) > section:not([id]).privacy-banner > div:not([id]).privacy-banner__wrap > div:not([id]).privacy-content > div:not([id]).privacy-banner__grid-wrap > div:not([id]).privacy-banner__grid-col.privacy-banner__inner > div:nth-child(3):not([id]).privacy-banner__actions.privacy-banner__set.privacy-banner__btn-wrapper--stacked > button:nth-child(2):not([id]).privacy-banner__btn.privacy-banner__btn--secondary.privacy-banner__reject","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#confirmSelection","body:not([id]) > div:not([id]) > div:nth-child(5):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])","body:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2)#gdpr-popup-v3-button-mandatory","body#hgcBody > div#cookies-banner > a:nth-child(6)#btnCookieBannerNo","body:not([id]) > dialog#biccy-banner > div#biccy-prompt > div:nth-child(2):not([id]) > button:nth-child(2)#biccy-reject-button","body:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div > div:nth-child(1) > div:nth-child(3) > div:nth-child(2)","body > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > button:nth-child(3)","body > aside#cookies-policy > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > form:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(14):not([id]) > div#m-cookienotice > div:not([id]) > div:nth-child(3)#action-custom-css > a:nth-child(2):not([id])","body > div#__nuxt > div#__layout > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div#dux-privacy > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])","body:not([id]) > div#__nuxt > div#__layout > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","[data-testid='reject-button']","body > div > div:nth-child(10) > div:nth-child(2) > div > div:nth-child(2) > div:nth-child(2)","body > div#shopui-cookie-popup-container > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > a:not([id])","body > section:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body:not([id]) > div#__nuxt > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cookies_overlay > div#cookies_banner > div:nth-child(2)#cookies_decision > button:nth-child(2)#cookies_read_declined","body:not([id]) > div#__next > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div#cookie-consent-popup > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-reject","body > div#cookie-consent-banner > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2)#btn-reject-all","body > div:not([id]) > div:nth-child(78)#cookie-banner > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cribbon > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2)#select-only-necessary > span:not([id])","body > div#app > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#modal-cookiesettings > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div:nth-child(1)#react-content > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id]) > span:not([id])","body > div:not([id]) > div#cookieconsent > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(1)#cookie-deny","body > div#cookie-bar-2019 > div:nth-child(4):not([id]) > a#declineLink","body > div#__next > div:nth-child(2)#cookieBanner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])[data-testid=\"refuse-all-cookies\"]","body > aside#cookie-consent-banner > div:not([id]) > form:not([id]) > div:nth-child(2):not([id]) > fieldset:nth-child(3):not([id]) > ul:not([id]) > li:nth-child(1):not([id]) > button:not([id])","body > dialog:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > footer:nth-child(3):not([id]) > div:nth-child(3):not([id]) > span:not([id])","body > div#cookie-popup > div:nth-child(2):not([id]) > button:nth-child(2)#reject-cookies","body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","div[data-test-consent-banner-popup] button[aria-label=\"Niet accepteren\"]","body > dialog:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > p:nth-child(2):not([id]) > a:nth-child(1):not([id])","body > div:not([id]) > div:nth-child(1)#react-content > div:nth-child(8):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div#consent-modal > div:not([id]) > div:nth-child(1)#consent-intro > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button#consent-deny-all","body > div:not([id]) > div:nth-child(5):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cookielaw_banner > div:nth-child(2):not([id]) > a:nth-child(2)#cookielaw_reject","body > div#__next > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(8):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#_app > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#radix-_r_0_ > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3):not([id])","body > div#nimbu-consent > div:not([id]) > div:not([id]) > div:not([id]) > p:nth-child(2):not([id]) > button:nth-child(2):not([id])",".ind-cbar[data-testid=\"ind-cbar\"]",".ind-cbar[data-testid=\"ind-cbar\"] button[save-cookie][data-value=\"0\"]","body > div:not([id]) > div#container > section:nth-child(1):not([id]) > div:not([id]) > div#block-mumc-info-cookiesui > div#cookiesjsr > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > web-overlay:not([id]) > web-cookie-consent:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#wpca-lay-out-wrapper > div:nth-child(1)#wpca-bar > div:nth-child(2)#wpca-bar-meta > button:nth-child(3):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#cookiebanner-decline[data-testid=\"button-cookie-decline\"]","body > div#cookiebanner > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > span:nth-child(2):not([id]) > a:nth-child(2)#cookie-niet-akkoord","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > section#cookie-consent > div:nth-child(7):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1)#button-«r0»","body > aside#cookies-policy > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > form:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > a:nth-child(4):not([id])","body > div#cookies-eu-wrapper > div#cookies-eu-banner > div:nth-child(2)#cookies-eu-buttons > button:nth-child(1)#cookies-eu-reject","body > div#wrapper > footer:nth-child(3):not([id]) > div#footer > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])","body > div#cc-card > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > a:nth-child(2)#cc-dismiss-btn","body > div#__nuxt > div:not([id]) > div:nth-child(3):not([id]) > section#modal > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#cookie-bar > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id]) > span:not([id])","body > div#CNID_4eb59999-7a35-450d-a08f-1661b81e5bc4 > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#refuseAll","body > div:not([id]) > div:nth-child(3)#cookie-consent[data-testid=\"cookie-consent-banner\"] > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#_rootSiteLayout > aside:nth-child(5):not([id]) > div:nth-child(3):not([id]) > aside:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3):not([id])","body > footer:not([id]) > div:nth-child(2)#cookieParent > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#noCookies","body > div#siteWrapper > div:nth-child(1):not([id]) > section:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2)#bcSubmitConsentToNone","body > aside:not([id]) > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])","body > div:not([id]) > div:not([id]) > button:nth-child(4):not([id])","body > shn-dialog#firstTimeVisitorCookieDialog > dialog:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > section#cc-window-overlay > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])","body > div#cookieconsent > section:not([id]) > div:not([id]) > p:nth-child(6):not([id]) > a:not([id])","body > ticketswap-portal:not([id]) > ul:not([id]) > div:not([id]) > div:not([id]) > span:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2)#ez-cookie-notification > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#ez-cookie-notification__decline","body > div#__nuxt > div:nth-child(2)#__layout > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2)#cookie-consent > div:not([id]) > dialog:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div#cookie-consent-modal-description > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id]) > span:not([id])","body > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > section#chakra-modal-\\:rd\\: > div#chakra-modal--body-\\:rd\\: > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > form:not([id]) > button:nth-child(2)#cookie_settings_disallowed","body > div#app > div:not([id]) > div:nth-child(10):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > div:nth-child(1)#cookie-banner > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3)#cookie-banner-reject","body > main#maincontent > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#svid10_17c33ae315e94c3ae6647bf > div:nth-child(1)#svid12_3f29801717d5618f8df9bf4 > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(4)#afCookieDecline","body > aza-app:not([id]) > aza-shell:not([id]) > div:nth-child(2):not([id]) > aza-cookie-message:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id]) > span:not([id])","body > div#app > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#geotargetlygeoconsent1749551372435container > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#ppms_cm_consent_popup_d0973bf6-9332-4ce3-bc7c-09678b958daf > div#ppms_cm_popup_overlay > div:nth-child(2)#ppms_cm_popup_wrapper > div#ppms_cm_popup > div#ppms_cm_popup_main_id > div#ppms_cm_popup_responsive_wrapper_id > div:nth-child(2)#ppms-4ad6f5ba-7508-4caa-bd23-e8e9a4bd64b2 > div:nth-child(2)#ppms-85b001a4-b886-4f7e-82d5-bd34f50f3266 > button:nth-child(2)#ppms_cm_reject-all","body > div#__nuxt > div:nth-child(2)#main-wrapper > div:nth-child(5):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#shopify-section-sections--20055816765655__privacy-banner > cookie-bar:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > form:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#cookie-consent-modal > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(4):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div#radix-_r_2_ > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > section#component-cookie-banner > div:nth-child(1):not([id]) > footer:nth-child(4):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2)#cookie-banner-accept-essentials","body > form#cookieConsentForm > div#cookie-consent-modal > div:not([id]) > div#cookie-consent-modal-content > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div#__nuxt > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div#cookie_banner > div:not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > container:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div#versionized-cookie-banner > div:nth-child(2):not([id]) > ul:not([id]) > li:nth-child(2):not([id]) > button#btn-reject-cookies","body:not([id]) > div#consent-banner > div:nth-child(2)#truste-consent-track > div:nth-child(3)#truste-consent-content > div:nth-child(3):not([id]) > div#truste-consent-buttons > button:nth-child(3)#truste-consent-required","body > div#__next > div:not([id]) > div:nth-child(1)#cookieBanner[data-testid=\"cookie-banner\"] > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > p:not([id]) > a:nth-child(2):not([id])","body > div[class] > div:nth-child(2) > div:nth-child(2) > button:nth-child(2)","body > div#cmpbox > div:not([id]) > div:nth-child(1)#cmpboxcontent > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > a:not([id])","body > div[id][cookie-banner-data-theme] > div > div > div > div:nth-child(2) > div:nth-child(2) > button","body:not([id]) > div#seers-cmp-cookie-data-hol > div:nth-child(2)#SeersCMPBannerMainBar > div:nth-child(2):not([id]) > a:nth-child(2):not([id])","body > div:not([id]) > div:nth-child(3)#gdpr_cookie_info_bar-wr > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])","body > div[id][class][data-role][data-controller][style] > div > div:nth-child(2) > form > button:nth-child(3)","body > div[class][tabindex] > div > div > div:nth-child(2) > div:nth-child(2) > button:nth-child(2)","body > div[id] > div:nth-child(2) > div:nth-child(4) > div > div:nth-child(2) > button:nth-child(2)","body > div#cassie-widget > div:nth-child(4)#cassie_cookie_module > div:nth-child(2)#cassie_pre_banner > div:nth-child(3)#cassie_pre_banner__footer > button:nth-child(2)#cassie_reject_all_pre_banner","body > div:not([id]) > div:nth-child(17):not([id]) > div:not([id]) > a:nth-child(3):not([id])","body > aside:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","body > div:not([id]) > div:not([id]) > div#ch2-dialog > div:nth-child(2):not([id]) > button:nth-child(1):not([id])","body > div[class][role][aria-labelledby][aria-live][lang] > div:nth-child(1) > div:nth-child(3) > div:nth-child(2)","body > div[id] > div > div:nth-child(1) > div > div > div > div:nth-child(2) > button:nth-child(2)","body:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])","#popup-cookies","#popup-cookies .cancelar-popup","disclaimerCookies=12=false&14=false&15=false","#cookie-consent[style*=\"max-height\"] #cookie-status-reject","[data-react-class=\"CookieNotice\"]",".cc-window[aria-describedby=\"cookieconsent:desc\"]","[data-react-class=\"CookieNotice\"] button",".cc-window[aria-describedby=\"cookieconsent:desc\"] .cc-dismiss",".cookie-notice-layout .cookie-notice-dismiss",".ui-alert.bottom-fixed a[data-href*='cookie-policy']",".ui-alert.bottom-fixed",".ui-alert.bottom-fixed button.close","body.enable-cookie-control",".cookie-dialog-initial",".cookie-dialog-initial button.g-button.outline","cookie_preferences=%7B%22allow%22%3A%5B%5D","#cookie_modal_placeholder dialog.bm-modal--cookie","Analytics_consent=2","Marketing_consent=2",".MuiDialog-root:has([data-uit=\"accept-all\"], [data-uit=\"store-changes\"])","[role=\"dialog\"] #approveAllCookies[data-uit=\"accept-all\"]","[role=\"dialog\"] [data-uit=\"show-details\"]","[role=\"dialog\"] [data-uit=\"store-changes\"]","[role=\"dialog\"] input[role=\"switch\"]:checked","[role=\"dialog\"] [data-uit=\"accept-all\"], [role=\"dialog\"] [data-uit=\"store-changes\"]",".cookie-alert",".cookie-alert .inner-cookie-alert .consent-actions",".cookie-alert-v2",".cookie-alert-v2 .consent-actions button:nth-of-type(2)",".cookie-alert .consent-actions button.btn-outline-light",".cookie-alert .consent-settings",".cookie-alert .consent-settings input[type=\"checkbox\"]:not([disabled]):checked",".cookie-alert .consent-settings button[type=\"submit\"]","__consent=1","*[aria-labelledby=\"consent-banner-title\"]","#bbccookies-prompt:has(#bbccookies-reject-button)","#consent-banner-title","#bbccookies-reject-button","button[data-testid=\"reject-button\"]","ckns_explicit=1","#cookiePrompt:has(#bbccookies-continue-button)","#bbccookies-continue-button","#bbccookies-prompt","#note .cpref","#note .cpref #cPrefToggle","#cPrefToggle","#cPrefModal label[for=\"tab-4r\"]","#cPrefSave","section.cookie","section.cookie .cookie__container .cookie__close","section.cookie.show .cookie__container","section.cookie.show .cookie__close",".modalwindow-container.bar .modalwindow","#bibliotheek-nl-page",".modalwindow-container.bar .modalwindow button.button.primary.notok",".sygnal24-gdpr-modal-wrap",".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-modal",".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-options input:checked:not([disabled])",".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-accept-choice","gdpr-consent=[\"necessary\"]","[role=dialog] [data-cy=allowCookiesButton]","[role=dialog] [data-cy=allowCookiesButton] ~ a[href=\"/articles/cookies\"]",".container > h3 ~ button",".container > h3 > input[type=checkbox]:checked:not([disabled])","BokadirektCookiePreferencesMP=Mandatory",".keks-privacy-layer",".keks-privacy-layer #cube-cmp-reject-all",".keks-privacy-layer[open]","acceptedCategories%22%3A%5B%22REQRD%22%5D",".blp-necessary-cookies-banner",".blp-necessary-cookies-banner__button","has-dismissed-necessary-cookies-banner=true","#banner-terms-dismiss","\"haveConsent\":true","#banner-terms","dismissedTermsNotice",".cookieHolder",".cookieHolder .cookie-link","GeneralCookieState=cookiestate","[role=\"dialog\"][aria-modal=\"false\"]:has(a[data-anchor-id=\"cookie-policy\"])","[role=\"dialog\"][aria-modal=\"false\"]:has(a[data-anchor-id=\"cookie-policy\"]) button:last-child","div:has(> h3):has(> p a[data-anchor-id=\"cookie-policy\"]) + div > button:last-child","div:has(> h3):has(> p a[data-anchor-id=\"cookie-policy\"]) ~ div:last-child > button:only-child","CTC=","div.modal.cookiesModal.is-open","div.cookiesModal__buttonWrapper > button[data-closecause=\"close-by-manage-cookies\"]","button#js-manage-data-privacy-save-button","#privacy-banner-lh .lh-close-button","lh-warning-test=manual-no",".cc-cookies .main",".cc-cookies .main .btn-cookies-config button",".cc-cookies .main[style*='display: block'] .btn-cookies-config button","#modalConfigCookies #acceptAdditionalCookies","#modalConfigCookies #acceptAdditionalCookies:checked","#btnConfigCookies button","cookie-agreed=false","#cookie-notification","#cookie-notification .cookie_pref_wrapper .pref-opt.refuse","#cookie_banner #myModal","#cookie_banner #myModal #popupCross","#myModal #popupCross",".incentive-banner","#js-cookie-banner","#js-cookie-banner .js-cookie-settings-btn","#js-cookie-banner .cookie-banner-content","#js-cookie-banner-modal .cookie-settings","#js-cookie-banner-modal .js-cookie-setting-switch.btn-toggle-on","#js-cookie-banner-modal .js-done-btn","rac=1",".cookie-banner",".cookie-banner .all4-cc-primary-button",".cookie-banner button[aria-label=\"Reject non-essential cookies and continue.\"]","C4_CC=eyJ2ZXJzaW9uIjoxLCJjb25zZW50ZWQiOnRydWUs","dialog[data-cookie-consent]:not([aria-modal]):has(form[data-privacy-consent-form])","dialog[data-cookie-consent] form[data-privacy-consent-form] button[name=\"action\"][value=\"reject\"]","dialog[data-cookie-consent]:has(form[data-privacy-consent-form])","dialog[data-cookie-consent]","#usecookie","#usecookie #usercookie_close","div[role=\"dialog\"][aria-label=\"Cookie settings\"]","xpath///div[@role=\"dialog\"][@aria-label=\"Cookie settings\"]//button[normalize-space()=\"Cookie settings\"]","xpath///div[@role=\"dialog\"][@aria-label=\"Cookie settings\"]//button[normalize-space()=\"Do not accept\"]",".cookiesInfo .closeCookiesInfo",".cookiesInfo",".js-cookie-banner","#js-cookie-banner__button-reject","#js-cookie-banner__button-hide","#csr-cookie-message","#csr-cookie-message #accept_essential_cookies_button","cookies_accepted=essential",".cookie-bar-backdrop","#js-cookie-notification .js-reject-cookie","#js-cookie-notification.opened","#js-cookie-notification.opened .js-reject-cookie","cookie-notification=REJECTED","#consent-banner","#consent-banner #truste-consent-track","#truste-consent-required","cmapi_cookie_privacy=permit_1_required",".cookieconsent[data-init=cookieConsent]",".cookieconsent.cookieconsent--active",".cookieconsent [data-cookieconsent=button]","acceptCookies=true",".cookie-prompt-container",".cookie-prompt-container #custom-cookie-banner-container",".cookie-prompt-container #analytic-cookie:checked",".cookie-prompt-container #analytic-cookie",".cookie-prompt-container .confirm-cookies","cookie_policy=false","[data-consent-button][data-value=accept_partial]","div.fixed.z-50.rounded-xl:has(> p > a[href*=\"privac\"]):has(> button.button-primary)","[data-testid='cookie-banner-reject-button']","CMCCP=AD%3D0","#costco-consent-manager [data-testid=\"Popup\"]","#costco-consent-manager [data-testid=\"Popup\"], script[src*=\"/consent-ui/costco-consent-manager\"]","#costco-consent-manager","#cookie-disclaimer","#cookiesel",".box-cookie",".box-cookie .box-cookie__inner",".box-cookie .btn-normal.is-small","disney_cc=ok","#cuvva-app-injection-site button[data-testid=\"accept-cookies\"]","cuvva.app.website.cookie-policy.consent.v2=","#cuvva-app-injection-site button[aria-label=\"Reject all\"]","cuvva.app.website.cookie-policy.consent.v2={%22preferences%22:{%22functional%22:true%2C%22analytics%22:false%2C%22marketing%22:false","div[class*=\"Overlay__container\"]:has(div[class*=\"TCF2Popup\"])","div[class*=\"TCF2Popup\"]","[class*=\"TCF2Popup\"] a[href^=\"https://www.dailymotion.com/legal/cookiemanagement\"]","button[class*=\"TCF2ContinueWithoutAcceptingButton\"]","dm-euconsent-v2","[class*=\"PrivacyBar_gdprAgreement\"] [class*=\"PrivacyBar_managePrefsBtn\"]","[class*=\"PrivacyBar_gdprAgreement\"]","[class*=\"CookieManagementModal_confirmBtn\"]","[class*=\"CookieManagementModal_dropdownHeader\"] [class*=\"SwitchButton_toggleSwitch\"] input:checked","%22targeting%22:false","gdpr-consent-popup","div[role=\"dialog\"][class*=\"CustomCookieBanner\"]","#onetrust-consent-sdk .ot-pc-refuse-all-handler","ngc-cookie-banner","div.cookie-footer-container","#cookies-modal","dialog.js-cookie-bar","dialog.js-cookie-bar .js-reject-all","CookieLevel=Functional",".MuiDialog-root [role=dialog] button[aria-label^=\"Odrzuć wszystkie i zamknij popup\"]",".cc-window.cc-visible",".cc-window .cc-dialog",".cc-window.cc-visible .cc-consent-require-only","dji_consentmanager","[id^=cookie-consent-banner]","#cookie-consent-denied","cookie-consent=denied","#cookiebanner.cookieAcceptBar","#cookiebanner.cookieAcceptBar #cookiebot-container","#cookiebot-container div.manage-preferences","#cookiePreferencesModal-card","#cookiePreferencesModal-card input[type=checkbox][data-type]:checked","#cookiePreferencesModal-card #cookieModalButton","marketing%3Afalse","div[class*=\"cookie-banner-\"]","div[class*=\"cookie-banner-\"] [class*=\"cookie-footer-\"]","div[class*=\"cookie-banner-\"] [class*=\"cookie-footer-\"] > button:not([data-testid=\"cookie_banner_notice\"])","#ari-nw-x","#ari-nw-x .ari-nw-btn","#ari-nw-x button.ari-opx-btn[data-key='consent:set']","#ss-su #ss-ck-a0","#ss-su #ss-ck-f0","#ss-su #ss-ck-s0","#ss-su #ss-rl-f1-btn","#ss-ck-f0.ari-h1","#ss-ck-s0.ari-h1","#ss-ck-a0.ari-h1",".cc-type-info[aria-describedby=\"cookieconsent:desc\"] .cc-dismiss","#cookiePopup [data-trigger=launchCookieDetails]","#cookiesModal [data-trigger=saveCookiePrefs]","cookiePrefs=","#cookiePopup","#cookiesModal","#cookiesModal #functionalCookies:checked","#cookiesModal #functionalCookies","#cookiesModal #advertisingCookies:checked","#cookiesModal #advertisingCookies","#gdpr-banner","#gdpr-banner-decline",".cookie-wrapper",".cookie-wrapper > .cookie-notice","[data-test-id=cookie-notice-reject]","#edp-cookies-banner","#edp-cookies-banner .edp-cookies-refuse","edp_cookie_agree=0","#ef-ccpa","#ef-button-ccpa-decline","#huk_cookie_prefernce_panel","#huk_cookie_prefernce_panel #EU_OPIN_REJECT","EKD_OPTIN=1",".cookie-bar__wrapper:has(.cookie-bar__message--top)",".cookie-bar__wrapper .cookie-bar__message--top",".cookie-bar__wrapper .cookie-bar__container","[data-testid=\"cookie-banner\"]","[data-testid=\"accept-all-cookies-button\"] ~ [data-testid=\"cookie-settings-button\"]","[data-testid=\"reject-all-cookies-button\"]","[data-testid=\"cookie-settings-button\"]","[data-testid=\"accept-all-cookies-button\"]",".modal:has(> .modal-content > .cookie-consent)",".cookie-consent #cookieDisagree","#consent-cookie-modal","#consent-cookie-modal #cookie-selection-button","#consent-cookie-modal input[type=checkbox]:checked:not(:disabled)","EMR-CookieConsent-Advertising=0","#block-eh-default-cookiebannerfixedblock","#block-eh-default-cookiebannerfixedblock .js-cookie-alert","#block-eh-default-cookiebannerfixedblock .js-cookie-alert .alert-close","#gdprBanner","#gdprBanner .js-close-btn","#app > div:has(a[href*=\"business.safety.google\"])","#app > div:has(a[href*=\"business.safety.google\"]) p + div > button","#app > div:has(a[href*=\"business.safety.google\"]) p + div > button:last-child","[role=dialog] form input#MARKETING","[role=dialog] form input[type=checkbox]:checked","[role=dialog] form button[type=submit]","cconsent=1000",".cookie-banner-container",".cookie-banner-container button.preferences","#ccc-optional-categories .checkbox-toggle-input:checked","\"analytics\":\"revoked\"",".global-cookie.js-cookie-banner",".global-cookie.js-cookie-banner .global-cookie__button",".global-cookie.js-cookie-banner:not(.global-cookie__hidden)","_consent_banner_read=true","#clb.clb-container","#clb.clb-container #moreSettings","#clb #moreSettings","#clb #clb-panel-2","#clb #switch2[data-active=true]","#clb #saveSettings","dws01-level=1","#es-cookie-banner","#es-cookie-banner #es-consent-settings-btn","#es-consent-settings-btn","#onetrust-consent-sdk input.category-switch-handler:checked",".cookies-line",".cookies-line a[href=\"/cookies-policy\"]",".cookies-line.show","[data-cookie-hint]","[data-cookie-hint] [data-cookie-hint-save-settings]","[data-cookie-hint] [data-cookie-first]","[data-cookie-hint] [data-cookie-hint-settings]","[data-cookie-settings] #cookie-setting-1","cookieHint=1","cookieAllowed=1","div#klaro","xpath///div[contains(@class,'pointer-events-none')]//button[normalize-space()='Accept all' or normalize-space()='Tout accepter']","xpath///button[normalize-space()='Customize' or normalize-space()='Personnaliser']","xpath///button[normalize-space()='Decline' or normalize-space()='Refuser']","escaparium_cookie_consent_decided=1","[data-cy=\"cookies-dialog\"]","[data-cy=\"cookies-dialog\"] [data-cy=\"personalize-cookies-button\"]","#personalize-menu [data-cy=\"accept-essentials-button\"]",".cdk-overlay-container",".cdk-overlay-container app-esaa-cookie-component",".btn-cookie-refuser","#cookie-consent-banner .wt-cck--container",".wt-cck--actions-button[href=\"#refuse\"]","%22cm%22%3Atrue%2C%22all1st%22%3Afalse","#tf-modal-container:has(.cookie-modal__footer)","#tf-modal-container .cookie-modal__footer .js-nl-modal-decline","#tf-modal-container .cookie-modal__footer","efrg_v1_tracking_full=0","common-tracking-optin","common-tracking-optin p.opt-in__text-item:nth-of-type(2) > a:last-of-type",".privacy-bar",".privacy-bar #close-rgpd-notice","#close-rgpd-notice","body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id])","[data-testid=\"cookie-policy-manage-dialog-decline-button\"]","#cookie-bar #cookieBarClose","#cookie-bar[aria-hidden=\"false\"]","#cookie-bar #cookieBarClose .cookie-bar-close","FSE-COOKIEBAR=hide",".c-cookie-notice.js-cookie-bar",".c-cookie-notice.js-cookie-bar .c-cookie-notice__button",".c-cookie-notice.js-cookie-bar.show .c-cookie-notice__button",".fancybox-wrap:has(#cookiemanager-popup)","#cookiemanager-popup #cookie-modal-close","cookieConsent={\"cookie\":\"rejected\",\"cookieThird\":\"rejected\"}","#gdrp",".dx-cookie-banner:has(.dx-cookie-banner-close)",".dx-cookie-banner .dx-cookie-banner-close","CookiePolicy=OK",".cookieCheckContainer",".cookieCheckContainer .closeBtn","ACP=1","#cookie-mask","#cookie-mask #cookieContainer","#cookieContainer #btn-cookie-accept-edit","#cookier-page-2 #btn-cookie-accept-nothing","cookie_accepted={\"nothing\": 1}","gf-notifications .notification:has(a[href^=\"https://policies.google.com/technologies/cookies\"])","gf-notifications .notification a[href^=\"https://policies.google.com/technologies/cookies\"]","gf-notifications .notification:has(a[href^=\"https://policies.google.com/technologies/cookies\"]) button.notification__close",".fk-cookie-warning",".fk-cookie-warning .cookie-warning-content",".fk-cookie-warning .cookie-warning-content button:nth-of-type(2)","fk_hide_cookie_warning=true",".cmp__consent .cmp__preferences-button",".cmp__consent",".cmp__service-groups__buttons button:not(.button--primary)","C0002:0,C0003:0,C0004:0","#nee_fpl_cookie_policy_banner","#fpl_cookie_policy_banner_close",".cookies-block",".cookies-block button","fuqer-allow-cookies=1",".cm-custom-cookie-line",".cm-custom-cookie-line a[onclick*='fn_show_cookie_popup']","#cookie_popup form[name=cookie_settings]","#cookie_popup input.consent-checkbox:checked:not([disabled])","#cookie_popup input[type=submit][name*='save_settings']","consent_cookie=%7B%22ad_storage%22%3A%22denied%22","#privacy_modal","#modalCookies","#modalCookies #ck_marketing","#modalCookies a[data-action=\"preferencias\"]","#modalCookies .preferencias","#modalCookies .preferencias input[type=checkbox]:checked:not([disabled])","#modalCookies a[data-action=\"aceptar\"]","gc-cookie=%7B%22estadisticas%22%3A0%2C%22marketing%22%3A0%7D",".cookie-consent",".modal-cookie",".push-banner-consent",".push-banner-consent button.close","#editconsent","#gu-cookie-control","#gu_analytics_switch_off","#gu_ads_switch_off","#gu-consent-confirm","gu_consent_set=true","gu_analytics=false","gu_remarketing=false",".cookies-modal",".show-cookies-modal .cookies-modal #cookies-accept",".show-cookies-modal .cookies-modal #cookies-reject","#cookieBanner a[href*='cookies_agreed=']","#cookieBanner span[onclick*='cookieBanner']",".cookie-consent-modal.active",".cookie-consent-modal #checkbox_analiticas",".cookie-consent-modal button.config",".cookie-consent-modal #checkbox_analiticas:checked",".cookie-consent-modal .btn.accept","cookies_allowed=true","#cookies-info","#cookies-info > .main-container > button","#cookies-info.active","#privacy-banner","#privacy-banner #privacy-banner-close","gs_privacy_accepted=true",".fixed [data-testid=closeCookieBanner]","#perfModal","#perfModal #refuseCookies","#perfModal #refuseCookies:not(.perfModal__btn__frozen)","OptanonAlertBoxClosed=","div.fixed.inset-0.drop-shadow-2xl","div.fixed.inset-0.drop-shadow-2xl button[aria-haspopup=\"dialog\"]","div[role=\"dialog\"] button[type=\"submit\"]","cookieConsent=true",".cookie-banner .closeme","[data-testid=consent-banner]","[data-testid=manage-preferences]","[data-testid=consent-mgr-dialog] [data-ga-button=save-preferences]",".notices--bottom_fixer .js-notice[data-notice-id=\"1\"]",".notices--bottom_fixer .js-notice[data-notice-id=\"1\"] .js-noticeDismiss","div[role=\"dialog\"][aria-label^=\"Privacy Disclosure\"]","#CookieConsent","#CookieConsentDeclined",".notification-banner:has(a[href*=\"/cookie-policy/\"])",".notification-banner a[href*=\"/cookie-policy/\"]",".notification-banner:has(a[href*=\"/cookie-policy/\"]) button.close-notification-banner","#consent-container","#consent-container #consent","#consent button[data-bs-target='#cookieSettings']","#cookieSettings .modal-footer","#grantAdStorageCookies:checked","#cookieSettings button[onclick*='saveCookieSettings(false)']","#consent-container #consent,#cookieSettings","#header-gdpr","#header-gdpr #header-gdpr-in-btn button","#header-gdpr.is-active","gdprCookieData=ok","#modal-cookies","#modal-cookies-options","#modal-cookies .cookies-settings-link","#cookieMarketingSwitch:checked","#cookieMarketingSwitch","#modal-cookies-options a[href*='confermaImpostazioni']","\"marketing\":false","#capa_galleta","#capa_galleta #acepto_galleta","#notifica-cookies","#notifica-cookies .btn-chiudi","[data-testid=consent-banner] [data-testid=reject-button]","COOKIE_PREF=ANL_0|PSN_0|PRTN_0","xpath///div[contains(., \"Vill du tillåta användningen av cookies från Instagram i den här webbläsaren?\") or contains(., \"Allow the use of cookies from Instagram on this browser?\") or contains(., \"Povolit v prohlížeči použití souborů cookie z Instagramu?\") or contains(., \"Dopustiti upotrebu kolačića s Instagrama na ovom pregledniku?\") or contains(., \"Разрешить использование файлов cookie от Instagram в этом браузере?\") or contains(., \"Vuoi consentire l'uso dei cookie di Instagram su questo browser?\") or contains(., \"Povoliť používanie cookies zo služby Instagram v tomto prehliadači?\") or contains(., \"Die Verwendung von Cookies durch Instagram in diesem Browser erlauben?\") or contains(., \"Sallitaanko Instagramin evästeiden käyttö tällä selaimella?\") or contains(., \"Engedélyezed az Instagram cookie-jainak használatát ebben a böngészőben?\") or contains(., \"Het gebruik van cookies van Instagram toestaan in deze browser?\") or contains(., \"Bu tarayıcıda Instagram'dan çerez kullanımına izin verilsin mi?\") or contains(., \"Permitir o uso de cookies do Instagram neste navegador?\") or contains(., \"Permiţi folosirea modulelor cookie de la Instagram în acest browser?\") or contains(., \"Autoriser l’utilisation des cookies d’Instagram sur ce navigateur ?\") or contains(., \"¿Permitir el uso de cookies de Instagram en este navegador?\") or contains(., \"Zezwolić na użycie plików cookie z Instagramu w tej przeglądarce?\") or contains(., \"Να επιτρέπεται η χρήση cookies από τo Instagram σε αυτό το πρόγραμμα περιήγησης;\") or contains(., \"Разрешавате ли използването на бисквитки от Instagram на този браузър?\") or contains(., \"Vil du tillade brugen af cookies fra Instagram i denne browser?\") or contains(., \"Vil du tillate bruk av informasjonskapsler fra Instagram i denne nettleseren?\")]","xpath///button[contains(., 'Отклонить необязательные файлы cookie') or contains(., 'Decline optional cookies') or contains(., 'Refuser les cookies optionnels') or contains(., 'Hylkää valinnaiset evästeet') or contains(., 'Afvis valgfrie cookies') or contains(., 'Odmietnuť nepovinné cookies') or contains(., 'Απόρριψη προαιρετικών cookies') or contains(., 'Neka valfria cookies') or contains(., 'Optionale Cookies ablehnen') or contains(., 'Rifiuta cookie facoltativi') or contains(., 'Odbij neobavezne kolačiće') or contains(., 'Avvis valgfrie informasjonskapsler') or contains(., 'İsteğe bağlı çerezleri reddet') or contains(., 'Recusar cookies opcionais') or contains(., 'Optionele cookies afwijzen') or contains(., 'Rechazar cookies opcionales') or contains(., 'Odrzuć opcjonalne pliki cookie') or contains(., 'Отхвърляне на бисквитките по избор') or contains(., 'Odmítnout volitelné soubory cookie') or contains(., 'Refuză modulele cookie opţionale') or contains(., 'A nem kötelező cookie-k elutasítása')]",".js-cookie-message",".js-cookie-message #cookie-chiudi","ISP_Cookie=1.1","IntesaSanpaoloTracciatura=1","#cookiebox","#cookiebox a.close",".header-slideout-overlay-cookie",".pop-cookie","#rti-privacy-open-modal-btn-id","#rti-privacy-close-btn-id","#iworks_cookie_notice","iWorks_Footer_Notice_close=hide","body.loaded","#iworks-footer-notice-button-close","#cp-wrapper","#cp-wrapper #cp-small","#cp-small button[onclick*='cp-large']","#cp-large","#cp-large input[type=checkbox]:checked:not([disabled])","#cp-large form > input[type=button]:not([onclick*='setConsentAll'])","div.fixed:has(#marketingCookies)","#marketingCookies","#statisticCookies[aria-checked=\"true\"], #marketingCookies[aria-checked=\"true\"]","xpath///div[.//button[@id='marketingCookies']]//button[normalize-space()='Auswahl bestätigen']","cookieChoiceDone=true","acceptMarketing=false","acceptStatistic=false","#cookiebanner-popup","#jg-chrome-header","#cookiebanner-popup #accept-essential-Cookies","necessary:true%2Cpreferences:false",".consent-banner",".consent-banner .consent-banner__actions button.basic-button",".consent-banner__actions button.basic-button.secondary",".consent-modal__footer button.basic-button.secondary",".consent-modal .base-modal__body a","label.consent-switch input[type=checkbox]:checked",".consent-modal__footer button.basic-button.primary",".s_box_avvisocookie",".s_box_avvisocookie a[onclick*=juzaphoto_refuse_all_cookies]","juzaphoto_refuse_all_cookies=ok",".content-container.gdpr-banner, .content-container.non-gdpr-banner",".gdpr-banner .customize-button",".non-gdpr-banner .privacy-text-content button","[role=dialog] .confirm-choices","[role=dialog] input.toggle-switch[aria-labelledby=performance]:checked","[role=dialog] input.toggle-switch[aria-labelledby=research]:checked","[role=dialog] input.toggle-switch[aria-labelledby=remarketing]:checked","#root > .chakra-stack:has(> div > p > a[href=\"/cookies\"])","button[aria-label^=\"Tilpass informasjonskap\"]","xpath///button[contains(., \"Lagre val\")]",".kvib-switch__root[data-state=\"checked\"]","#react-consent-modal","#react-consent-modal .flex.flex-column","#react-consent-modal .flex.flex-row.justify-between button:first-child",".cookie:has(.cookie__inner .cookie__button)",".cookie > .cookie__inner > .cookie__button > a","#loader.is--show",".cookie","cookiesubmit=1","#ccpa-request-consent","#ccpa-request-consent .settings button","#ccpa-request-consent.ccpa-banner--visible .settings button",".ReactModal__Content:has(.toggle-grid) .modal__footer button.button--vibrant--filled",".ReactModal__Content:has(.toggle-grid)","#ccpa-request-consent button.close","#gdpr-banner-container","#gdpr-banner-container #gdpr-banner [data-testid=gdpr-banner-decline-button]","#cookie-notice #close-notice","notice=true","#cookie-notice-full-consent","#cookie-notice-full-consent .cn-accept-all-cookies",".cookieconsent .cc_banner-wrapper",".cookieconsent .cc_banner-wrapper [onclick*='refuseAllCookiesPreferences']",".cookieconsent .cc_banner",".cc_banner [onclick*='refuseAllCookiesPreferences']","_cprefs=%7B%22stats%22%3A1%2C%22fct%22%3A1%2C%22mkt%22%3A1%7D","#qc-cmp2-ui, #qc-cmp2-usp","#qc-cmp2-usp .qc-usp-ui-content button[mode=\"primary\"]","#qc-cmp2-mspa-success-modal-button-footer-container button","#qc-cmp2-container button.qc-cmp2-link-inline","#reject-all-btn","#save-and-exit","#js-cookie-section","#js-cookie-section #js-cookie-consent-deny","#js-cookie-section.show","cookieConsent=false","#gdpr","#gdpr #gdpr-button","div:has(> div > a[href*='/privacy-policy'])",".cookie-preferences-banner",".cookie-preferences-banner .reject-all-cookies",".cookie-preferences-banner .dismiss-banner","analytics%22%3Afalse","[class*=\"ConsentModal_consent-modal__modal-overlay\"]","[data-test=\"cookie-necessary-button\"]","[data-test=\"age-gate-overlay\"]","AGE_GATE=","%22key%22%3A%22analytics%22%2C%22value%22%3Afalse","[class*=\"CookiesBanner_cookies-banner\"]","[class*=\"CookiesBanner_cookies-banner\"] [class*=\"CookiesBanner_buttons\"] button","[class*=\"CookiesBanner_buttons\"] button:first-child","[role=\"dialog\"] [class*=\"_actions_\"] button:first-child","#cookieNotice","#cookieNotice > a.btncookieNoticesettings","section.consent-banner","section.consent-banner button.hide-consent","#cookie-consent-popup","#cookie-consent-popup #cookie-consent-accept-selected","#cookie-consent-popup input[type=checkbox]:checked:not(:disabled)","analytics_cookies=false!personalizationAndMarketing_cookies=false",".consent-categories-modal-wrapper","#consent-categories-modal [data-modal-consent-open-settings]","#edit-consent-app input[name=consent-category][value=nc]:checked","#edit-consent-app input[name=consent-category]:checked:not(:disabled)","#consent-categories-settings [data-modal-submit]","#consent-categories-modal","#cookie-banner #cookie-consent-settings","#cookie-banner #cookie-consent-view","#cookie-banner #cookie-settings-view","#cookie-form input[type=checkbox]:checked:not(:disabled)","#cookie-banner #cookie-settings-save","analytic%3A0",".cookie-overlay","#cookiePopup .reject-cookie","_site_acceptance=0","div:has(> #notice-cookie-block)","[data-dialog-ref-name=\"cookie-text-popup\"]","#notice-cookie-block #btn-manage-cookie","#btn-manage-cookie-save-preferences","#cookie-text-popup input[type=\"checkbox\"]:checked","%22marketing%22%3Afalse%2C%22analytic%22%3Afalse","app-cookie-modal .top-info-cookie","app-cookie-modal .top-info-cookie .close-x","PatientPortalCookieMonit=1",".js-gdpr-banner-top-hide",".js-gdpr-banner .js-gdpr-banner-top-hide",".js-gdpr-banner-top-hide .js-gdpr-banner-disagree","cookie_banner=false",".popuppanel4 a[href*=\"/info/cookie/\"]",".popuppanel4 .js-popupclose",".popuppanel4",".c-cookie-modal",".c-cookie-modal #cookieModal",".c-cookie-modal__buttons--container button[aria-label=\"Settings\"]",".c-cookie-modal__options",".c-cookie-modal__options input[role=\"switch\"]:checked:not([disabled])",".c-cookie-modal__buttons--container button[aria-label=\"Save Cookie Settings\"]",".makita-footer-warning",".makita-footer-warning .js-makita-modal[data-src*='privacysettings']",".about-cookies a[data-post*='allowcookie=false']",".cookies-notification-wrapper .cookie-accept-all-cta",".cookies-notification-wrapper .customise-cookies-cta button",".cookies-notification-wrapper .cookie-details-section",".cookies-notification-wrapper .cookie-details-section input[type=checkbox]:checked:not(:disabled)",".cookies-notification-wrapper .cookies-notification-bottom div:not(.hideCookiesPreferenceBtn) > button","#cookies-banner","#cookies-banner [class*=\"CookiesFooter-module\"]","#cookies-banner [class*=\"CookiesFooter-module\"] > button:nth-child(2):not([id])","#cookies-banner [class*=\"CookiesFooter-module\"] > button:first-child:not([id])","#cookies-banner [class*=\"CookiesSettings-module\"][class*=\"buttonsWrapper\"] > button:nth-child(2)","\"targeting\":\"DENIED\"",".navbar-privacy","nav.navbar-privacy .privacy-continue","#generic-modal .privacy-accept","nav.navbar-privacy",".cookie-banner[data-block-name=\"cookie-banner\"]",".cookie-banner[data-block-name=\"cookie-banner\"] .alert-close",".cookie_info",".cookie_info > span.cookie_ok","section[aria-label=\"Cookie preferences\"]","xpath///section[@aria-label=\"Cookie preferences\"]//button[normalize-space()=\"Cookie Settings\"]","div[role=\"dialog\"][aria-labelledby=\"consent-settings-title\"]","xpath///label[contains(., \"Necessary and functional cookies\")]//input[@name=\"cookie-tier\"]","div[role=\"dialog\"][aria-labelledby=\"consent-settings-title\"] button:not([aria-label])","div:has(> div > div > div[role=alert] > a[href^=\"https://policy.medium.com/medium-privacy-policy-\"])","dialog.cookie-banner","dialog.cookie-banner .customise-cookie","dialog.cookie-banner button.reject","dialog.cookie-dialog button.save","dialog.cookie-dialog .toggle-control.on:not(.disabled)","dialog.consent-dialog .consent-settings .consent-category input[data-category]","dialog.consent-dialog","dialog.consent-dialog .consent-wrapper > .consent-buttons > .consent-button-secondary","dialog.consent-dialog .consent-settings.active","dialog.consent-dialog .consent-category input[type=checkbox]:checked:not([disabled])","dialog.consent-dialog .consent-settings .consent-buttons > .consent-button:not(.consent-button-secondary)","%22ad_storage%22%3A%22denied%22","div[aria-label=\"Cookie Policy Banner\"]","dialog.cookieconsent__dialog",".cookieconsent__base[data-component=\"cookieconsent\"]",".cookieconsent__buttonAcceptNecessary","consent_choice=",".cookie-modal.open",".cookie-modal.open .cookie-box",".cookie-modal.open .btn-box .simple-btn.cancel","#consent-tracking .btn-necessary","\"marketingCookie\":false","#mde-consent-modal-container","#mde-consent-modal-dialog","#mde-consent-modal-dialog .mde-consent-decline-btn","mdeConsentData=","[role='region'][aria-label='Cookie consent']","xpath///div[@role='region'][@aria-label='Cookie consent']//button[normalize-space(.)='Reject']","[role='dialog'][data-diagnostic-boundary='modal-shell'] button[aria-label='Close']","#cookie-banner-wrapper","#cookie-banner-wrapper #cookie_banner_save","#cookie-banner-wrapper input[type=checkbox]:checked:not(:disabled)","mq-alert-cookies","#cmp-banner-sdk",".cmp-sdk-container","#cmp-reject-all-handler",".cookie-new-bg","#cookie-popup-short","#cookie-popup-short .manage-cookies","#cookie-popup-detailed .save-settings","#cookie-popup-detailed input.cookie-toggle:checked","#onetrust-banner-sdk",".privacy-confirmation",".privacy-confirmation .pc-buttons",".privacy-confirmation [data-cy=accept-core-button], .privacy-confirmation .pc-buttons > button.ui-parts-button-fill:not([data-cy])","dialog[data-test=\"common-consent\"]","#nlportal-cookie-consent .modal","dialog[data-test=\"common-consent\"] [data-test=\"consent-reject-all\"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons > button","dialog[data-test=\"common-consent\"] [data-test=\"consent-reject-all\"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons > button:nth-child(2)","dialog[data-test=\"common-consent\"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons",".cookie-policy-wrapper .cookie-policy-content",".cookie-policy-wrapper #declineCookies","cookies_policy=analyticsCookies%3Doff%26functionalityCookies%3Doff","div#cookieWarning","a#btnCookiesDenyAll","button[aria-label='Close cookie banner']","[data-show-cookie-banner=\"true\"]","[data-show-cookie-banner-overlay=\"true\"]","[data-show-cookie-banner=\"true\"], [data-show-cookie-banner-overlay=\"true\"]","[class*=ConsentManager]","[class*=ConsentManager_cookieBar]","xpath///button[contains(@class, \"ConsentManager_cookieBarButton\") and contains(., \"weigeren\")]","#cookie-banner #reject-cookies","#cookie-banner.nhsuk-cookie-banner","#cookie-banner [data-qa=\"cookie-banner-close\"]","#cookie-banner [data-qa=\"cookie-banner\"]",".cookies:has(.closecookies)",".cookies .closecookies","[data-testid=cookie-dialog-root]","input[type=radio][id$=-declineLabel]","[data-testid=confirm-choice-button]","#CookieReportsPanel #CookieReportsBanner .wscrOk2","#CookieReportsBanner .wscrSwitch input[type=checkbox]:checked:not([disabled]) + label","#CookieReportsBanner .wscrOk2","wscrCookieConsentShared=1=true&2=false&3=false&4=false&5=false","[role=dialog] #cookie-accept-all-secondary","[role=dialog] #cookie-accept-all-secondary + button","consent_cookie=necessary","nwhlit-gdpr-banner",".cookie-control",".cookie-control [data-cc-capture] button[name=\"save\"]",".cookie-control .cc-capture__message",".cookie-control [data-expandable-trigger]",".cookie-control input[name=\"cookie_control_optin_level[]\"]:checked","cookie_control_optin_level=0","gdpr-banner","xpath///button[contains(., 'Imposta le tue preferenze')]","input[data-part='checkbox-input'][name='analytics']","input[data-part='checkbox-input'][name='analytics']:checked","input[data-part='checkbox-input'][name='marketing']:checked","input[data-part='checkbox-input'][name='marketing']","xpath///button[contains(., 'Salva le mie impostazioni')]","cookie_consent=a%3D0%26m%3D0",".cookie-banner:has(.cookie-banner__close)",".cookie-banner .cookie-banner__close",".cookies-agreement-notification,.modal-new:has([data-module=SetupCookies])",".cookies-agreement-notification",".cookies-agreement-notification .cb_setup","[data-module=SetupCookies]","[data-module=SetupCookies] input[type=checkbox]:checked:not(:disabled)","[name=button_save_choice]","#gdpr-selection-screen","#gdpr-selection-screen #gdpr-permissionlevel-1","#gdpr-selection-screen #gdpr-screen-content","#gdpr-selection-screen .button-container button","MascGdrpPermission=1","#alert_cookies","#alert_cookies #alert_cookies_close","div.b-cookies-informer","div.b-cookies-informer__nav > button:nth-child(1)","div.b-cookies-informer__switchers","div.b-cookies-informer__switchers input:not([disabled])","div.b-cookies-informer__nav > button",".cookie-popup",".cookie-popup .cookie-popup__button","[aria-labelledby=cookieConsentTitle]","[aria-labelledby=cookieConsentTitle] button[aria-haspopup=dialog] + button","consent=rejected","#cookie-consent .cookie-all__btn","#cookie-consent .cookie-consent__switch.active:not(.always_on)","#cookie-consent .cookie-selection__btn","cookie_consent_essential=true","cookie_consent_marketing=true",".o5-dynamic-alerts__container:has(a[href*=\"privacy-policy\"])",".o5-dynamic-alerts__container:has(a[href*=\"privacy-policy\"]) .o5-dynamic-alerts__close","#id01.w3-modal","#id01.w3-modal button[onclick*=\"setCookie('polityka'\"]","#orbys-cookies","#orbys-cookies .occ-btn","osf-cookie-consent-banner","osf-cookie-consent-banner p-message","#footerCurtainCookie","#footerCurtainCookie .footerCookieLink","SL_cookie=NO",".cookie-manager",".cookie-manager .cookie-notice.open",".cookie-notice button.owid-btn--outline-dark-blue.cookie-notice__button","#cookie-consent ~ .banner-shadow","#cookie-consent .cc-window[aria-describedby=\"cookieconsent:desc\"]","#cookie-consent, #cookie-consent ~ .banner-shadow","footer .ccpabanner","#bandeaucookie","#bandeaucookie #cookieOk",".cookie-consent-wrapper",".cookie-consent-wrapper a[color=transparent]","input[name=ga-cookies]","input[name=ga-cookies]:checked, input[name=fbq-cookies]:checked","[class*=CookieConsentModal__ButtonContainer] a:not(.cancel-btn)","cookieconsent=0",".cc-policy-overlay",".cc-policy",".cc-policy .cc-settings","consent=S.false-T.false","pekao-cookies","pekao-cookies .cookies-wrapper","pekao-cookies .cookies-button button","np24Cookies=","[data-ui-test=pm-cookie-banner]","[data-ui-test=pm-cookie-banner-decline-button]","pm_cookie_consent_level=1",".cookie-consent-popup",".cookie-consent-popup .cookie-consent-accept",".cookie-consent-popup .cookie-consent-accept .elementor-button","cookie_consent=accepted",".BusinessCookieConsent",".BusinessCookieConsent [data-id=cookie-consent-banner-buttons]","[data-id=cookie-consent-banner-buttons] > div:nth-child(2) button","#cookieMessage[data-cookie-boundary]",".cookie-bg",".cookie-bg .cookie-inner .cookie-btn--accept",".cookie-bg .cookie-inner",".cookie-bg .personalise-btn",".cookie-bg form .cookie-list",".cookie-bg form .cookie-item input[type=checkbox]:checked:not([disabled])",".cookie-bg form button[type=submit]","gdpr-ga=false","gdpr-fbp=false","[data-testid=cookieBar]",".notification-bar.cookie-consent","[data-testid=adConsentModal]","[data-testid=adConsentDisagreeButton]","[data-testid=cookieBarRejectButton]","[data-testid=cookieBarRejectButton], .notification-bar.cookie-consent .cookie-consent-reject","plex_tv_cookie_consent=2","#cookie-consent button","#cookie-consent input[type=checkbox]:checked:not(:disabled)","plosCookieConsentStatus=false","[data-testid=cookie-consent-bar-desktop], [data-testid=cookie-consent-bar-mobile]","[data-testid=manage-cookies-button-desktop]","[data-testid=manage-cookies-button-mobile]","[data-testid=cookie-consent-modal]","[data-testid=cookie-consent-modal] input[type=checkbox]:checked","[data-testid=cookie-consent-save-button]","pmo_c_acc=true","pmo_c_mark=true","#notification-stack > div:has(> header > [style*='ui-icons-lock.svg'] ~ button)","#notification-stack header:has([style*='ui-icons-lock.svg']) button","#notification-stack header:has([style*='ui-icons-lock.svg'])","#cookieBanner.cbShort","#cookieBanner.cbShort .cbCloseButton","#cookieBanner #cookieBannerContent","#cookieBanner #cookieBannerContent, #globalCookieBanner","#globalCookieBanner .js-customizeGlobalCookies","#cookieBanner [data-label=accept_essential]","#cookieBanner button.cbSecondaryCTA","#cookie-form","#cookie-form .reject","_cookieNoticeSettings=%7B%22performance%22%3Afalse%2C%22targeting%22%3Afalse%2C%22analytic%22%3Afalse%7D","xpath///li[contains(@class, 'ToastRoot')][contains(., 'cookie banner')]","xpath///li[contains(@class, 'ToastRoot')][contains(., 'cookie banner')]//button[@data-radix-toast-announce-alt='Close']","pnl-cookie-wall-widget","CookiePermissionInfo",".alert .accept-cookies,form.js-cookies",".alert:has(.accept-cookies)","form.js-cookies button","form.js-cookies input[type=checkbox]","form.js-cookies input[type=checkbox]:checked:not(:disabled)","form.js-cookies button[type=submit]",".alert:has(.accept-cookies) a[href='/account/cookies']","#cookiesPopup","#cookiesPopup button.MuiButton-outlined","#cookiesPopup .MuiSwitch-root","#cookiesPopup button","#tc-banner","#tc-consent #tc-banner","#tc-banner .tc-accept-btn",".tc-checkbox:checked:not([disabled])","UserConsentedToTastyCookies=[\"nodvandiga\"]",".c-modal.is-active",".c-modal.is-active .is-dismiss","div.cookie:has(a.cookie-okay-button)","div.cookie a.cookie-okay-button","[data-testid=\"cookie-consent-sticky-footer\"]","[data-testid=\"cookie-consent-sticky-footer\"][aria-hidden=\"false\"]","[data-testid=\"cookie-consent-sticky-footer\"] button[aria-label]:first-child","[data-testid=\"_cookie_modal_test\"]","[data-testid=\"_cookie_modal_test\"] label:has(input[type=\"checkbox\"]:checked)","[data-testid=\"_cookie_modal_test\"] button[aria-label=\"button-pmui\"]","\"analytics_storage\":\"denied\"",".cookies .cookies__container",".cookies .cookies__close button.cookies__button","cookieAgreements=true",".gdpr[data-gdprservice]",".gdpr[data-gdprservice]:not(.hide)","#__rptl-cookiebanner #__rptl-cookiebanner-reject",".DialogHandlerContainer.visible:has(.cookie-dialog)","#cookiesStrip:has([data-testid='accept-cookies'])",".DialogHandlerContainer.visible:has(.cookie-dialog), #cookiesStrip:has([data-testid='accept-cookies'])","#cookiesStrip [data-testid='skip-cookies']","span.cookie-option-large>div>span.link-no-decoration.gui-text",".cookie-dialog form .CookieConsentOption input[type='checkbox']:not([name='permanent']):checked",".cookie-dialog button[type='submit']","[bundlename=reddit_cookie_banner]","#data-protection-consent-dialog rpl-modal-card > button.button-primary","#data-protection-consent-dialog rpl-modal-card > button.button-secondary","eu_cookie={%22opted%22:true%2C%22nonessential%22:false}","#cookiebanner","#cookiebanner #acceptNecessaryCookiesBtn","refbConsent={%22categories%22:[%22necessary%22]%2C","%22consent_date%22:1","#cb_wrapper-std #overlay-std","#cb_wrapper-std #cookieApiData","#cb_wrapper-std #overlay-std #userSelect","#cb_wrapper-std #userSelect","#footer > .container > .d-flex > button.btn-outline-primary","div:has(> button#cookieBar-button)","#cookieBar-button","#cookiePopUp","#manageCookieSettingsPopUp","#cookiePopUp[data-control=cookies]","#cookiePopUp [data-bs-target='#manageCookieSettingsPopUp']","#decline-cookies-button","cookie_consents=","#cookie_container","#cookie_container #accept_cookies_btn",".cookie-overlay .cookie-consent .cc-controls",".cookie-consent .cc-controls .custom-button.--secondary-option + .custom-button.--secondary-option","rittalCC=1",".cookie-banner-wrapper",".cookie-banner-wrapper .cookie-banner",".cookie-banner-wrapper button.btn-secondary-lg","RBXcb","#cookie-policy-info","div.cookie-btn-box > div[aria-label=\"Reject\"]",".cookie-policy-lightbox-bottom > div[aria-label=\"Save Settings\"]","#gdpr-notification","#gdpr-notification #banner-link-preferences","#banner-link-preferences","#cookie-modal .cookie-modal-content","#cookie-modal-input:checked","#cookie-modal-input","#cookie-modal-dismiss","gdpr_accepts_cookies=false","[role=dialog] form #cookie_consent_accept_all_button","[role=dialog] form:has(#cookie_consent_accept_all_button) button[type=button]","[role=dialog] form input#analytical","[role=dialog] form input#analytical:checked","[role=dialog] form:has(input#analytical) button[type=submit]:not(#cookie_consent_accept_all_button)","#m-cookienotice","#manage-cookies","#accept-selected",".cookie-consent .cookie-close",".cookie-consent.is-show .cookie-close","cookie=true","rspb-cookie-banner","rspb-cookie-banner .buttons button.btn-light","rspb-cookie-banner [data-testid=\"options\"]","rspb-cookie-banner button[label=\"Save settings\"]","RSPB.AllowMarketingCookies=No",".cookies-banner-shown","#ConsentBar","#ConsentBar [data-js--cookie=\"cookies-accept-functional\"]","#gdprconsent.gdprcontainer","#gdprconsent .gdprbutton a","gdpr-consent=0","script[src*='consent.cookiebot.com/uc.js']","#cookiebanner #DeclineAll","statistics:false%2Cmarketing:false","#cookie-popup-with-overlay","#cookie-popup-with-overlay [data-ref='cookie.no-thanks']","RY_COOKIE_CONSENT","div.cookie-bar","#popup-notice","#popup-notice .popup__close","saturdaysnyc-notice=1","#kakrutan","#kakrutan scb-button[value='inget']",".cc-window.cc-type-info[aria-describedby=\"cookieconsent:desc\"] .cc-dismiss","body.cookie-overlay","body > div#__next > div#app > div:nth-child(7):not([id])","xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]","xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]//button[normalize-space(.)='Reject Optional']","xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]//button[contains(normalize-space(.), 'MANAGE PREFERENCES')]","xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Manage Preferences')]]//button[normalize-space(.)='Save Preferences']","\"functional\":false","\"performance\":false","\"personalization\":false","[data-qa=\"GDPRBanner-Container\"]","[data-qa=\"GDPRBanner-Container\"] [data-qa=\"GDPRBanner-Button\"]","#panelAsk","#panelAsk #btnAcceptAllCookies","#cookieContainer #cookies","#cookieContainer #cookies .cookies_inner button[onclick*='Rechazar']","%7E%7Cparcial","#cookie-info","#cookie-info .button-row button.btn-secondary","#cookie-info #no-ad-cookies","#cookie-info form button.save-button",".sw-cookie=1",".cookie-consent[data-cookieconsent], .gdpr-tab",".cookie-consent[data-cookieconsent], .gdpr-tab #gdpr_tab_content","__hs_opt_out=","__hs_opt_out=yes","[class*=\"cookie-consent-required\"]","html[data-cookie-consent-required] [data-testid=\"accept-all-cookie-button\"]","[data-testid=\"accept-all-cookie-button\"]","body[data-scroll-locked]","[data-testid=\"customize-cookie-button\"]","[data-testid=\"confirm-settings-cookie-button\"]","[data-testid=\"cookie-banner\"] button:has(+ button)","dialog[open]:has(input[name^=\"cookiesetting.\"])","dialog[open] input[name^=\"cookiesetting.\"]:checked:not([disabled])","dialog[open]:has(input[name^=\"cookiesetting.\"]) > div > div.p-4 > button","body > div[class*=_shein_privacy]","body > div[class*=_shein_privacy] > div:nth-of-type(2) > div:nth-of-type(4) > div:nth-of-type(3)",".cmp-cookies-notification",".cmp-cookies-notification .cmp-cookies-notification__btn-cookie-accept","#cookie-bar .cb-enable,[class^=\"app_gdpr--\"] button","#pnlCookieAcceptance","#pnlCookieAcceptance #divCookiesManage","aside[x-data=\"cookieConsent\"]","#shopify-pc__banner, aside[x-data=\"cookieConsent\"] > div.opacity-100","custom-cookie-consent#cookieBubble.banner-show","custom-cookie-consent#cookieBubble #configureBtn","custom-cookie-consent#cookieBubble.banner-show #configureBtn",".custom-cookie-modal #acceptNecessaryBtn","[data-testid=\"cookie-wall\"]","[data-testid=\"cookie-wall\"] .cookie-bar__footer button[data-id=\"0\"]","acceptCookies=0","skv-cookie-banner","SKVCookieAllow=strictlyNecessary","#cookieBannerContent","[data-tracking-element-id=cookie_banner_essential_only]","[data-test-id=cookie-consent-banner]","[data-test-id=cookie-consent-banner] #accept-necessary-cookies-button","cookie-accept-necessary=accepted","#app > div:has(> div:last-child > button:first-child + button:last-child)","#app > div:not(:has(input[role=switch])) > div:last-child > button:last-child:not(:first-child)","#app > div:has(input[role=switch]) > div:last-child > button:first-child","#app > div:has(input[role=switch]) input[role=switch][aria-checked=true]:not([disabled])","_s.cookie_consent=marketing=0:analytics=0",".sm-alert[data-cookie^='cookie.disclaimer']",".sm-alert.is-visible[data-cookie^='cookie.disclaimer'] .sm-alert__button","disclaimer=closed",".m-gdpr-banner",".o-overlay--gdpr",".m-gdpr-banner .js-m-gdpr-banner__button-manage",".m-gdpr-banner.state-m-gdpr-banner--visible",".m-gdpr-settings .js-m-gdpr-settings__button-custom",".m-gdpr-settings input:checked:not(:disabled)","#cookiesModal #cookiesModalCloseBtn","#cookiesModalCloseBtn","app-cookie-consent","app-cookie-consent button.underline","app-cookie-consent ui-switch button.switch","app-cookie-consent ui-switch button.switch.checked:not(.disabled)","app-cookie-consent app-btn button","#cookie-consent-message","#cookie-consent-message #cookie-consent-reject","#cookie-consent-reject","cookieconsent_status=0",".plug-gdpr-wrapper.js-gdpr-wrapper",".plug-gdpr-wrapper.js-gdpr-wrapper .js-gdpr-button",".plug-gdpr-wrapper--show.js-gdpr-wrapper","[aria-describedby=\"cookieconsent:desc\"], .cc_overlay_bg","#js-cookie-notification","div.fixed.inset-0:has(.lucide-cookie)","xpath///div[contains(@class, 'inset-0')]//button[contains(., 'Refuser tous')]",".consent__wrapper",".consent","button.consentSettings","button#consentSubmit","dialog[class*=\"CookieModal-module\"]","dialog[class*=\"CookieModal-module\"] button[class*=\"__secondaryButton\"]","[role=\"dialog\"] [class*=\"SettingsModal-module\"]","[role=\"dialog\"] [class*=\"SettingsModal-module\"] input[type=\"checkbox\"]:checked","[role=\"dialog\"]:has([class*=\"SettingsModal-module\"]) [class*=\"__footer\"] button","targTK=false","#banniere_cookies","#banniere_cookies span[onclick]",".CookieConsent__root",".CookieConsent__root .CookieConsent__modal",".CookieConsent__root button[data-consent-action=reject-all], #CookieConsent_reject_all","\"improved_experience\":false,\"partners\":false","#cookieChoiceInfo","#cookieChoiceInfo #cookieChoiceLearnMore","[id$='_ManageCookiesContent'] input[name$='BtnConfirmChoices']","[id$='_ManageCookiesContent'] input[type=checkbox]:checked","analyticsCookieConsent=n","#myModal.showmodal","#myModal.showmodal .showmodal-close","div:has([href=\"cookiePrivacyLink\"]) + div:has(> [role=button][aria-label])","div:has([href=\"cookiePrivacyLink\"]) + div:has(> [role=button][aria-label]) > [role=button][aria-label]:nth-child(2)","privacy_setting_detail=%7B%22adsChoice%22%3A%220","[aria-label=consent-banner]","xpath///button[contains(., 'Reject all')]","interactionCount=1","#tsla-reject-cookie","tsla-cookie-consent=rejected","[data-testid=\"cookies-banner\"]","[data-testid=\"cookies-banner\"] .cookies-banner__close-icon-wrapper","[data-testid=\"cookies-banner\"] .cookies-banner__description","[data-testid=\"desktop-close-button\"]","[data-testid=\"cookies-banner\"] .d-none-desktop .cookies-banner__close-icon-wrapper",".cookie-popups__container",".cookie-popups__first-consent-popup","[data-test-id=\"cookie-manage-settings-button\"]",".cookie-popups__preferences-popup",".cookie-popups__advertising-toggle:checked","[data-test-id=\"cookie-advertising-slider\"]","[data-test-id=\"cookie-save-preferences-button\"]","lts-cookie-consent=1","#user-consent","#user-consent .page.main button.manage","#user-consent .page.main","#user-consent .page.secondary","#user-consent .page.secondary input[type=checkbox]:checked:not([disabled])","#user-consent .page.secondary button.save","\"marketing\":\"denied\"","#consent-banner button[data-testid='close-button']","[data-callback=\"accounts/hide-banner/CookiesBanner\"]","[data-callback=\"accounts/hide-banner/CookiesBanner\"] button[class*=\"ManageLink\"]","[data-testid=\"modal-body-content\"] [class*=\"IndividualBox\"] input[type=\"checkbox\"]","[data-testid=\"modal-body-content\"] [class*=\"IndividualBox\"] input[type=\"checkbox\"][aria-disabled=\"false\"]:checked","[data-testid=\"modal-body-content\"] [class*=\"Footer\"] button","%22advertising%22%3Afalse",".optanon-alert-box-wrapper",".optanon-alert-box-wrapper .optanon-toggle-display","#optanon-popup-wrapper","#optanon-menu li.menu-item-on:is(.menu-item-performance,.menu-item-functional,.menu-item-advertising,.menu-item-social) button","#optanon-popup-more-info-bar .optanon-status-editable .optanon-status-on label","#optanon-popup-bottom .optanon-save-settings-button button","%2C2%3A0%2C3%3A0%2C4%3A0","[role=dialog][aria-labelledby=cookie-banner-title]","xpath///div[@role='dialog'][@aria-labelledby='cookie-banner-title']//button[normalize-space()='Manage preferences']","xpath///div[@role='dialog'][.//input[@id='consent-toggle-analytics']]//button[normalize-space()='Reject all']","#consent-toggle-analytics:not(:checked)","xpath///div[@role='dialog'][.//input[@id='consent-toggle-analytics']]//button[normalize-space()='Save preferences']","#cookie-notification #accept-cookie","#cookie-notification:not(.hide)","cookies-accepted=true","div[role=alertdialog][data-nosnippet][aria-describedby]","div[role=alertdialog][data-nosnippet][aria-describedby] > div > div:last-child > div:last-child > button","div[role=dialog][data-nosnippet][aria-labelledby] > div > div:last-of-type > div > div:nth-child(2) > button","[data-test=\"cookie-banner\"]","[data-test-id=cookies_section]","#CookieNotice","#CookieNotice > div[onclick]","Notice=yes","#tkConsentmanager","#tkConsentmanager .g-consentmanager__confirm-selection","tkConsentWirtschaftlicherWerbeeinsatz=0","#cookie-consent #cookie-consent-btn-customise","#cookie-consent #cookie-consent-btn-accept-some","#cookie-consent-btn-customise","#consent-marketing:checked","#consent-marketing","#consent-analytics:checked","#consent-analytics","#cookie-consent-btn-accept-some","%22analytics%22%3Afalse%2C%22marketing%22%3Afalse","#cookie-compliant","#cookie-compliant #saveAndAcceptCookies","#cookie-compliant #cookies-config","#cookie-compliant #cookie_b:checked","#cookie-compliant #cookie_b","#cookie-compliant #cookie_c:checked","#cookie-compliant #cookie_c","ALLOW_COOKIES=a","ALLOW_COOKIES=a-","xpath///div[contains(@class, 'fixed') and contains(., 'Cookieをブロック') and .//button[normalize-space()='Cookieの設定']]","xpath///div[contains(@class, 'fixed') and contains(., 'Cookieをブロック')]//button[normalize-space()='Cookieの設定']","xpath///button[normalize-space()='設定を保存する']",".optIn",".optIn .js-optin-cookie-settings","label[for=\"TAB-02\"]","label[for=\"TAB-02\"] + .tab-content .toggleSwitch__circle","label[for=\"TAB-03\"]","label[for=\"TAB-03\"] + .tab-content .toggleSwitch__circle",".js-modal-save-settings","__performanceCookieFlag__=0","__targetingCookieFlag__=0","div:has(> button#accept-button):has(> button#decline-button)","button#accept-button,button#decline-button","button#decline-button","div[role=dialog][aria-labelledby=privacy-notice-title]","div[aria-labelledby=privacy-notice-title] button[role=switch][aria-checked=true]","div[aria-labelledby=privacy-notice-title] button[role=switch][aria-checked=false]","div[aria-labelledby=privacy-notice-title] button:not([role=switch]):last-child","#consent-modal","#privacy-settings-content","button[type=\"submit\"]","div.one-modal__action-footer-column--secondary > a",".fixed.bottom-0:has([data-test=cookieBannerButton])",".fixed.bottom-0 [data-test=cookieBannerButton]","[class*=\"cookie-warning-wrapper\"]","[class*=\"cookie-warning-wrapper\"] #notAllowCookiesButton","#notAllowCookiesButton","COOKIE_WARNING_REJECTED=true",".tvp-cookie-overlay",".tvp-cookie-overlay .tvp-covl",".tvp-covl .tvp-covl__sb",".tvp-covl .tvp-covl__save",".tvp-covl input.iabd:not(:checked)",".tvp-covl input.iabd","TVPtcs22=","[data-a-target=\"consent-banner\"],.ReactModalPortal:has([data-a-target=consent-modal-save])","[data-a-target=\"consent-banner\"]","[data-a-target=\"consent-banner-accept\"]","[data-a-target=\"consent-banner\"] button:not([data-a-target])","button[data-a-target=\"consent-banner-manage-preferences\"]","input[type=checkbox][data-a-target=tw-checkbox]:not([disabled])","input[type=checkbox][data-a-target=tw-checkbox]:not(:checked):not([disabled])","[data-a-target=consent-modal-save]",".ReactModalPortal:has([data-a-target=consent-modal-save])","#footer_tc_privacy","#privacy__modal__close, #footer_tc_privacy #privacy__links__center","#privacy__modal__close, #footer_tc_privacy","#privacy__modal__close","#footer_tc_privacy #privacy__links__center","#privacy_options #options_tc_privacy_button","UBI_PRIVACY_POLICY_VIEWED=true","UBI_PRIVACY_ADS_OPTOUT=true",".toasterAlert .toaster",".toasterAlert .toaster-content a[href*='/npp/OSPP-']",".toasterAlert .toaster-close",".js-cookie-preferences",".js-cookie-preferences .js-manage-cta",".js-cookie-preferences.is-active",".js-cookie-preferences .js-manage-panel button[type=submit]","label[for=performace-no]","label[for=targeted-advertising-no]","advertisingCookies=false","performanceAnalyticsCookies=false","#__tealiumGDPRcpPrefs #consent-container","#__tealiumGDPRcpPrefs #consent-container #consent-modal-settings","#no-consent-popup-close-modal","#cookieModal","#cookieModal [onclick*=\"cookiesPolicy.selDefAndloadScript\"]","unive.it=1","noiframe=checked","socialpix=checked","app-cookie-consent > .cookie-banner","app-cookie-consent .cookie-banner","app-cookie-consent .cookie-banner > div > button:nth-of-type(2)","#modal-consent-banner","#modal-consent-banner #btn-edit-cookie-consent","#cookie-consent-banner #btn-edit-cookie-consent","#cookie-consent-dialog #btn-accept-some","#consent-ad:checked","#consent-ad","#cookie-consent-dialog",".ucb",".ucb-banner",".ucb-banner .ucb-btn-save","#cookie-blur","#cookie-notice #cookie_notice_manage","COOKIES_ADVERTISING=0","#js-pw-consent-wrapper bgl-modal[test-id='cookie-modal']","#js-pw-consent-wrapper [data-ta-id='pw-consent-rejectAllButton']",".alert-cookie #dismiss-cookie-banner-button","vd_cookie_warning=1",".gdpr_container",".gdpr_modal_container",".gdpr .gdpr_manage_cookies_button",".gdpr .gdpr_container",".gdpr_modal .gdpr_modal_button_reject","vg_consent={\"functionality\":false,\"performance\":false,\"targeting\":false}",".CookieBanner",".CookieBanner #Cookie_Selected",".CookieBanner:not(.out) #Cookie_Selected",".CookieBanner input[type=checkbox]:checked","CookieConsent=required","CookieConsent=required,",".component-lightbox-gdpr",".component-lightbox-gdpr .gdpr_cookie_settings_accept_cookies",".gdpr_cookie_settings_accept_cookies__button-container__button.button--solid--secondary",".gdpr_cookie_settings_cookie_settings",".gdpr_cookie_settings_cookie_settings .component-toggle-button[toggle_selected=True]",".gdpr_cookie_settings_cookie_settings__main-section__button-container__button","_vinnova_gdpr=0",".cookie-policy-modal",".manage-cookies-modal",".cookie-policy-modal .cookie-policy-details button.manage",".manage-cookies-modal .manage-cookies-footer button.btn-outline-primary",".dip-consent,.dip-consent-container",".dip-consent-container",".dip-consent-content",".dip-consent-btn[tabindex=\"2\"]","cookie-banner#cookie-banner-host","C3%3A0","C4%3A0",".footer-signup:has(consent-scheduler > .cookie-consent-js:not(.hidden))","consent-scheduler > .cookie-consent-js",".footer-signup.active consent-scheduler > .cookie-consent-js:not(.hidden)","a[href=\"https://www.walmartcanada.ca/cookie-notice\"]","button[data-dca-intent=\"open\"][role=\"link\"]","xpath///button[contains(., 'Save settings') or contains(., 'Enregistrer les paramètres')]",".MuiDialog-root [role=dialog] img[src*=\"portalCKM-cookie-dialog\"]",".MuiDialog-root [role=dialog] button.MuiButton-outlined",".MuiDialog-root [role=dialog] .MuiFormGroup-root button.MuiButton-outlined",".MuiDialog-root [role=dialog] .MuiFormGroup-root input[type=checkbox]:checked:not(:disabled)",".MuiDialog-root [role=dialog]",".cookie-banner .btn-accept-selected",".cookie-banner .toggle-switch[aria-pressed='true']",".gdpr-popup",".gdpr-popup #gdpr-popup__show-preferences",".gdpr-popup.gdpr-popup--show","#gdpr-popup__show-preferences","#gdpr-popup__preferences button[data-gdpr=button][value=save]","#gdpr-popup__preferences button[data-gdpr=switch][aria-checked=true]","%22interactedWith%22:true","%22marketing%22:%22revoked%22","[role=dialog] [data-testid=view-preferences], .CookieNotice-Dialog [data-testid=Preferences]","[role=dialog] [data-testid=view-preferences]","[role=dialog] [data-testid=save-preferences]",".CookieNotice-Dialog [data-testid=Preferences]",".CookieNotice-Dialog [data-testid=UpdateAndClose]","%22analytics%22:false%2C%22marketing%22:false","[class^=cookie_wrapper]",".shopify-section.cookies:has(.accept-cookies)",".shopify-section.cookies .accept-cookies","#cookiePolicy:has(#cookiePolicyClose)","#cookiePolicy #cookiePolicyWrap #cookiePolicyClose","dialog[aria-labelledby=\"consent-title\"]","div.animate-slideFromLeft.fixed.bottom-0.z-50","dialog[aria-labelledby=\"consent-title\"], div.animate-slideFromLeft.fixed.bottom-0.z-50","dialog[aria-labelledby=\"consent-title\"] button.border-xe-primary-500, div.animate-slideFromLeft button.border-xe-primary-500","[data-testid=\"performance-toggle\"]","dialog[aria-labelledby=\"consent-title\"] button.bg-xe-primary-500, div.animate-slideFromLeft button.bg-xe-primary-500","xeConsentState={%22performance%22:false%2C%22marketing%22:false","[data-role=\"cookies-modal\"]","[data-role=\"cookies-modal\"] [data-opt-hydration=\"cookies-dialog-eu\"]","[data-role=\"cookies-modal\"] [class*=experimentalButtons] button:nth-of-type(2)","[data-role=\"cookies-modal\"] [class*=container]","[class*=cookiesAnnounce]","[class*=cookiesAnnounce] [class*=announceText]","form#consent-dialog button[data-testid=give-consent-button]","form#consent-dialog","form#consent-dialog button[name=read-more]","form#consent-dialog fieldset","form#consent-dialog fieldset input[type=checkbox]:checked:not([disabled])","cookies_marketing_ok=false","#cookieBar","#cookieBar .js-cookies-btn","#cookieBar [data-event=cookies-show-settings]","#cookiesPopup .js-save-settings","#cookiesPopup .js-switch.active:not(.is-required)","\"ad_storage\":\"denied\"","div.cookie.flex.flex-wrap","xpath///div[contains(@class,'cookie')]//button[normalize-space()='Deny']","#consent-page","#consent-page button[value=reject]","#colorbox.colorbox-cookie-consent","#cboxOverlay.colorbox-cookie-consent","#cookie-consent form.cookie-consent","#colorbox input.cookie-consent-reject-all","ConsentMarketing=False",".cookies-box",".cookies-box .cookies-btn-customize",".manage-consent-preferences-dialog, .el-dialog[aria-label='Manage Consent Preferences']",".manage-consent-preferences-dialog .van-checkbox__icon--checked, .el-dialog[aria-label='Manage Consent Preferences'] .el-checkbox.is-checked",".manage-consent-preferences-dialog .van-dialog__confirm, .el-dialog[aria-label='Manage Consent Preferences'] .el-dialog__footer button","yuntrackAccept=agree","#cookie_modal_wrapper","#cookie_modal_wrapper #cookie_modal_button_choose","#consent-init","#consent-init #consent-configure","#consent-update #consent-configuration-save","zinio-cookie-consent",".cookies.main-class .customize-btn",".cookies.main-class .cookies-container .customize-btn",".cookies.main-class .cookies-hidden .el-switch",".cookies-hidden .el-switch.is-checked:not(.is-disabled)",".cookies.main-class .cookies-hidden .accept-btn","validCookies=general--"],"r":[[1,"123inkt",2,"",22,[0],[{"e":1}],[{"check":"any","v":2}],[{"c":1}],[],{}],[1,"abconcerts.be",2,"",22,[3],[{"e":4}],[{"v":4}],[{"if":{"e":5},"then":[{"k":5}],"else":[{"k":6},{"c":7}]}],[],{"intermediate":false}],[1,"abebooks",2,"",22,[8],[{"e":9}],[{"v":10}],[{"c":11},{"check":"none","timeout":2000,"optional":true,"wv":10}],[{"cc":12}],{}],[1,"accept-cookie-box",1,"",22,[13],[{"e":14}],[{"v":13}],[{"h":13}],[],{}],[1,"acos-cms",2,"",22,[15],[{"e":16}],[{"v":16}],[{"c":17},{"check":"none","wv":16}],[{"cc":18}],{"intermediate":false}],[1,"acris",2,"",22,[19],[{"e":20}],[{"v":21}],[{"check":"any","wv":22},{"wait":500},{"c":22}],[],{}],[1,"admetricspro",0,"",22,[23,24],[{"e":25}],[{"v":26}],[{"if":{"e":27},"then":[{"all":true,"optional":true,"k":28},{"c":29}],"else":[{"c":30},{"c":31}]}],[{"check":"none","timeout":3000,"wv":26}],{}],[1,"adnuntius",2,"",22,[32],[{"e":33}],[{"v":32}],[{"c":33}],[{"check":"none","v":32}],{}],[1,"adopt",2,"",22,[34],[{"e":35}],[{"v":34}],[{"c":36}],[{"eval":"EVAL_ADOPT_TEST"}],{}],[1,"Adroll",2,"",22,[37],[{"e":37}],[{"v":37}],[{"c":38}],[{"negated":true,"cc":39}],{}],[1,"adstate",2,"",22,[40],[{"exists":["adstate-settings-component app-wrapper","#cookie-pop-up-only-necessary"]}],[{"visible":["adstate-settings-component app-wrapper","app-cookie-pop-up"]}],[{"waitForThenClick":["adstate-settings-component app-wrapper","#cookie-pop-up-only-necessary"]}],[{"waitForVisible":["adstate-settings-component app-wrapper","app-cookie-pop-up"],"check":"none","timeout":2000}],{}],[1,"affinity.serif.com",2,"",22,[],[{"e":41}],[{"v":42}],[{"k":43}],[{"wait":500},{"cc":44},{"negated":true,"cc":45}],{}],[1,"amasty-gdpr",0,"",22,[],[{"e":46}],[{"v":46}],[{"timeout":10000,"w":47},{"if":{"v":48},"then":[{"c":49}],"else":[{"k":50},{"wv":51},{"all":true,"optional":true,"k":52},{"retry":3,"retryInterval":500,"c":53}]}],[{"check":"none","timeout":5000,"wv":46}],{}],[1,"amasty-gdpr-hyva",0,"",22,[],[{"e":54}],[{"v":55},{"negated":true,"e":56}],[{"check":"none","timeout":5000,"wv":57},{"if":{"e":58},"then":[{"c":58},{"check":"none","timeout":3000,"optional":true,"wv":55},{"if":{"v":55},"then":[{"k":58}]}],"else":[{"c":59},{"timeout":2000,"optional":true,"wv":57},{"if":{"v":57},"then":[],"else":[{"k":59}]},{"wv":57},{"timeout":5000,"wv":60},{"all":true,"optional":true,"k":61},{"c":57},{"check":"none","timeout":10000,"optional":true,"wv":57},{"check":"none","timeout":1000,"optional":true,"wv":55},{"if":{"v":55},"then":[{"optional":true,"k":62}]}]}],[{"any":[{"e":56},{"check":"none","timeout":5000,"wv":55}]}],{}],[1,"amazon-hiring",2,"",22,[],[{"e":63}],[{"v":63}],[{"k":64},{"check":"none","timeout":2000,"wv":63},{"if":{"e":65},"then":[{"k":65}]},{"check":"none","timeout":2000,"wv":66}],[],{}],[1,"amazon.com",2,"",22,[67],[{"e":67}],[{"check":"any","v":68}],[{"wv":69},{"wait":5000},{"k":69}],[],{}],[1,"amex",0,"",22,[70],[{"e":70}],[{"v":70}],[{"c":71}],[],{}],[1,"anthropic",2,"",22,[],[{"e":72}],[{"v":72}],[{"c":73}],[{"cc":74}],{}],[1,"AppConsent",2,"",22,[75],[{"e":76}],[{"v":75}],[{"waitFor":["iframe[title='Consent window']",".button__refuseAll, .button__skip"]},{"if":{"exists":["iframe[title='Consent window']",".button__refuseAll"]},"then":[{"click":["iframe[title='Consent window']",".button__refuseAll"]}],"else":[{"click":["iframe[title='Consent window']",".button__skip"]}]}],[{"timeout":1000,"check":"none","wv":75}],{}],[1,"AppConsent legacy",2,"",22,[77],[{"e":78}],[{"v":77}],[{"waitFor":["iframe[srcdoc*='frame-root']",".button__skip, .button__openPrivacyCenter"]},{"if":{"exists":["iframe[srcdoc*='frame-root']",".button__skip"]},"then":[{"click":["iframe[srcdoc*='frame-root']",".button__skip"]}],"else":[{"click":["iframe[srcdoc*='frame-root']",".button__openPrivacyCenter"]},{"waitForThenClick":["iframe[srcdoc*='frame-root']",".button__refuseAll"]},{"waitForThenClick":["iframe[srcdoc*='frame-root']",".button__save"]}]}],[{"timeout":1000,"check":"none","wv":77}],{}],[1,"aquasana.com",2,"",22,[79],[{"v":79}],[{"v":79}],[{"if":{"e":80},"then":[{"k":80}],"else":[{"h":79}]}],[],{}],[1,"arbeitsagentur",2,"",22,[81],[{"e":82}],[{"e":83}],[{"waitForThenClick":["bahf-cookie-disclaimer-dpl3","#bahf-cookie-disclaimer-modal .ba-btn-contrast"]}],[{"cc":84}],{}],[1,"arto",0,"",22,[85],[{"e":86}],[{"v":87}],[{"c":87}],[{"cc":88}],{}],[1,"as-adventure",2,"",22,[89,90,91],[{"e":92}],[{"check":"any","v":93}],[{"all":true,"retry":10,"retryInterval":500,"c":92}],[{"timeout":2000,"check":"none","wv":93}],{}],[1,"asahi-interactive",2,"",22,[94],[{"e":95}],[{"v":94}],[{"c":96}],[{"cc":97}],{}],[1,"aspnet-cookieinfo",0,"",22,[98],[{"e":99}],[{"v":98}],[{"c":99}],[{"cc":100}],{}],[1,"asus",2,"",22,[101],[{"e":102}],[{"v":102}],[{"if":{"e":103},"then":[{"k":103}],"else":[{"c":104},{"c":105}]}],[],{}],[1,"autodoc",2,"",22,[106],[{"e":107}],[{"v":107}],[{"c":107}],[{"wait":2000},{"cc":108}],{}],[1,"automattic-cmp-optout",2,"",22,[109],[{"e":109}],[{"v":109}],[{"k":110},{"all":true,"c":111},{"k":112}],[],{}],[1,"autoscout24",2,"",22,[113],[{"e":114}],[{"v":114}],[{"c":115}],[{"wait":500},{"cc":116}],{}],[1,"avacy",2,"",22,[117,118],[{"e":119}],[{"check":"any","v":119}],[{"if":{"check":"any","v":120},"then":[{"c":120}],"else":[{"c":121}]}],[],{}],[1,"avada-cookie-consent",2,"",22,[122],[{"e":123}],[{"check":"any","v":123}],[{"c":123},{"any":[{"check":"none","timeout":1000,"wv":122},{"c":124}]}],[{"cc":125}],{}],[1,"avada-privacy-bar",2,"",22,[126],[{"e":127}],[{"check":"any","v":126}],[{"if":{"e":128},"then":[{"all":true,"k":128}],"else":[{"all":true,"optional":true,"k":129},{"all":true,"k":130}]}],[{"check":"none","timeout":1000,"wv":126}],{}],[1,"avada-privacy-bar-cosmetic",1,"",22,[126],[{"e":130}],[{"check":"any","v":126}],[{"h":126}],[],{}],[1,"avvio",2,"",22,[131],[{"e":132}],[{"check":"any","v":133}],[{"if":{"v":134},"then":[{"c":135}]},{"wv":136},{"if":{"e":137},"then":[{"all":true,"k":138}]},{"k":136},{"check":"none","wv":131}],[{"cc":139}],{}],[1,"aws.amazon.com",2,"",22,[140,141,142,143],[{"e":140}],[{"v":140}],[{"if":{"e":144},"then":[{"k":144}],"else":[{"k":145},{"w":146},{"all":true,"optional":true,"k":147},{"k":148}]}],[],{}],[1,"axeptio",2,"",22,[149],[{"e":149}],[{"any":[{"e":150},{"v":151},{"visible":[".axeptio_mount .needsclick",".axeptio_widget"]},{"cc":152}]}],[{"if":{"e":153},"then":[{"waitForVisible":[".axeptio_mount .needsclick","button#axeptio_btn_dismiss,button.ax-discardButton,button#axeptio_btn_close"]},{"wait":300},{"if":{"exists":[".axeptio_mount .needsclick","button#axeptio_btn_dismiss,button.ax-discardButton"]},"then":[{"click":[".axeptio_mount .needsclick","button#axeptio_btn_dismiss,button.ax-discardButton"]}],"else":[{"click":[".axeptio_mount .needsclick","button#axeptio_btn_close"]}]}],"else":[{"wv":154},{"wait":300},{"if":{"e":155},"then":[{"k":155}],"else":[{"k":156}]}]}],[{"cc":157}],{}],[1,"aylo-cookie-banner",2,"",22,[158],[{"e":159},{"e":160}],[{"v":159},{"any":[{"v":161},{"eval":"EVAL_AYLO_COOKIE_MANAGER_READY"}]}],[{"if":{"v":162},"then":[{"c":162}],"else":[{"if":{"v":163},"then":[{"wait":8000},{"c":163}],"else":[{"c":164}]}]},{"optional":true,"c":165}],[{"any":[{"cc":166},{"cc":167}]}],{}],[1,"b-cookie",1,"",22,[168],[{"e":168}],[{"v":168}],[{"h":168}],[],{}],[1,"baden-wuerttemberg.de",2,"",22,[169],[{"e":169}],[{"v":169}],[{"if":{"e":170},"then":[{"k":170}],"else":[{"all":true,"optional":true,"k":171},{"k":172}]}],[],{}],[1,"bancaditalia",2,"",22,[173],[{"e":174}],[{"v":173}],[{"c":174}],[{"cc":175}],{}],[1,"bathnes-cookie-banner",2,"",22,[176],[{"e":176}],[{"v":177}],[{"c":177}],[{"check":"none","timeout":1000,"wv":176}],{}],[1,"bbb.org",0,"",22,[178],[{"e":179}],[{"v":180}],[{"wv":181},{"wait":500},{"k":181},{"w":182},{"all":true,"optional":true,"k":183},{"k":184},{"c":185}],[],{}],[1,"bbva",2,"",22,[186],[{"e":187}],[{"v":187}],[{"c":187},{"check":"none","wv":188}],[{"cc":189}],{}],[1,"bdirect-booking-engine",2,"",22,[190],[{"e":191}],[{"v":191}],[{"retry":2,"c":192}],[{"cc":193}],{"intermediate":false}],[1,"beetle-tracking",2,"",22,[194],[{"exists":["beetle-tracking-consent-modal",".consent"]}],[{"visible":["beetle-tracking-consent-modal",".consent__dialog-wrapper"]}],[{"waitForThenClick":["beetle-tracking-consent-modal",".consent__button-decline-all"],"retry":10,"retryInterval":500}],[{"cc":195}],{}],[1,"bigcommerce-consent-manager",0,"",22,[196],[{"v":196},{"eval":"EVAL_BIGCOMMERCE_CONSENT_MANAGER_DETECT"}],[{"check":"any","v":197}],[{"c":198}],[{"cc":199}],{}],[1,"bigcrunch",2,"",10,[200,201],[{"exists":["#bc-cmp-host, #bc-cmp-host-auto","#bc-cmp-banner"]}],[{"visible":["#bc-cmp-host, #bc-cmp-host-auto","#bc-cmp-banner-container:not([style*=\"display: none\"]) #bc-cmp-banner"]}],[{"waitForThenClick":["#bc-cmp-host, #bc-cmp-host-auto","#bc-cmp-banner [data-action=reject-all]"]}],[{"waitForVisible":["#bc-cmp-host, #bc-cmp-host-auto","#bc-cmp-banner-container:not([style*=\"display: none\"]) #bc-cmp-banner"],"timeout":2000,"check":"none"}],{}],[1,"bigid",2,"",22,[202],[{"e":202}],[{"visible":["#bigidcmp-banner-widget","#cmp-accept-all"]}],[{"if":{"exists":["#bigidcmp-banner-widget","#cmp-reject-all"]},"then":[{"waitForThenClick":["#bigidcmp-banner-widget","#cmp-reject-all"]}],"else":[{"if":{"exists":["#bigidcmp-banner-widget","#cmp-custom-permissions"]},"then":[{"waitForThenClick":["#bigidcmp-banner-widget","#cmp-custom-permissions"]},{"waitForVisible":["#bigidcmp-banner-widget","#cmp-submit"]},{"click":["#bigidcmp-banner-widget","button[role=\"switch\"]:not([disabled]) > span[class*=\"translate-x-[1.1rem]\"]"],"all":true,"optional":true},{"waitForThenClick":["#bigidcmp-banner-widget","#cmp-submit"]}],"else":[{"waitForThenClick":["#bigidcmp-banner-widget","div[tabindex=\"0\"]:has(> svg #times-solid)"]}]}]}],[{"cc":203},{"cc":204}],{}],[1,"bing.com",2,"",22,[205],[{"e":206}],[{"v":206},{"v":207}],[{"wait":500},{"c":208}],[{"cc":209}],{}],[1,"bleau-cookiecontrol",2,"",22,[210],[{"e":211}],[{"v":212}],[{"c":211}],[{"check":"none","wv":210},{"cc":213}],{}],[1,"blocksy",0,"",10,[214],[{"e":215}],[{"v":214}],[{"c":216}],[{"cc":217}],{"intermediate":false}],[1,"bluepark",2,"",22,[218],[{"e":219}],[{"v":220}],[{"c":220}],[{"check":"none","timeout":3000,"wv":221}],{}],[1,"bnes-cc",2,"",22,[222],[{"e":223}],[{"v":224}],[{"if":{"e":225},"then":[{"c":225}],"else":[{"c":223},{"wv":226},{"if":{"e":227},"then":[{"k":228}]},{"if":{"e":229},"then":[{"k":230}]},{"k":226}]}],[{"cc":231},{"negated":true,"cc":232}],{}],[1,"bold-cookie-consent",0,"",22,[233,234],[{"e":235}],[{"if":{"v":234},"then":[{"v":234}],"else":[{"v":233},{"check":"any","v":236}]}],[{"if":{"v":234},"then":[{"k":237},{"check":"none","timeout":3000,"optional":true,"wv":234}],"else":[{"if":{"check":"any","v":238},"then":[{"k":238}],"else":[{"k":239},{"wv":235},{"all":true,"optional":true,"k":240},{"k":241}]},{"check":"none","timeout":3000,"optional":true,"wv":233}]}],[{"if":{"e":234},"then":[{"check":"none","v":234}],"else":[{"check":"none","v":233}]}],{}],[1,"borlabs",2,"",22,[242],[{"e":243}],[{"v":244}],[{"timeout":3000,"optional":true,"w":245},{"if":{"e":246},"then":[{"k":246}],"else":[{"if":{"e":247},"then":[{"k":247}],"else":[{"if":{"e":248},"then":[{"k":248}],"else":[{"if":{"e":249},"then":[{"k":249},{"wv":250},{"all":true,"optional":true,"k":251},{"k":252},{"wait":500}]}]}]}]}],[{"eval":"EVAL_BORLABS_0"}],{}],[1,"bosch-dock-privacy-settings",2,"",22,[253],[{"e":253}],[{"visible":["dock-privacy-settings","#decline-all-modal-dialog button"]}],[{"waitForThenClick":["dock-privacy-settings","#decline-all-modal-dialog button"]}],[{"waitForVisible":["dock-privacy-settings","#decline-all-modal-dialog button"],"timeout":1000,"check":"none"}],{}],[1,"bouvet-cookiepanel",2,"",22,[254],[{"e":254}],[{"v":254}],[{"c":255}],[{"cc":256}],{}],[1,"brainsum-cookieconsent",2,"",22,[257],[{"e":258}],[{"v":259}],[{"if":{"v":260},"then":[{"k":260}],"else":[{"k":261},{"wv":262},{"all":true,"optional":true,"k":263},{"all":true,"optional":true,"k":264},{"k":262}]}],[{"check":"none","wv":259},{"cc":213}],{}],[1,"bswhealth",0,"",22,[265],[{"e":265}],[{"v":266}],[{"c":267},{"wv":268},{"all":true,"optional":true,"c":269},{"c":266}],[{"cc":270}],{}],[1,"bullionbypost",2,"",22,[],[{"e":271},{"e":272}],[{"v":271}],[{"if":{"e":273},"then":[{"k":274}]},{"c":275},{"if":{"e":276},"then":[{"wait":1000},{"k":275}]},{"if":{"e":276},"then":[{"wait":1000},{"k":275}]},{"if":{"e":276},"then":[{"wait":1000},{"k":275}]},{"if":{"e":276},"then":[{"wait":1000},{"k":275}]},{"if":{"e":276},"then":[{"wait":1000},{"k":275}]}],[{"cc":277},{"cc":278}],{}],[1,"bundesarchiv-cookiebanner",2,"",22,[279,280],[{"e":281}],[{"v":281}],[{"if":{"e":282},"then":[{"all":true,"k":283}]},{"c":281}],[{"timeout":2000,"check":"none","wv":281}],{}],[1,"bundesregierung.de",2,"",22,[284],[{"e":284}],[{"v":285}],[{"wait":500},{"c":286}],[{"cc":287}],{}],[2,"burpee.com",2,"",22,[288,289],[{"e":289},{"negated":true,"e":290}],[{"v":291}],[{"if":{"e":292},"then":[{"c":292}],"else":[{"if":{"e":293},"then":[{"c":293}],"else":[{"if":{"e":294},"then":[{"c":294},{"all":true,"k":295},{"k":296}],"else":[{"h":297},{"removeClass":"cookie-notification-active","selector":"body","optional":true}]}]}]}],[],{}],[1,"bwr-cookie",2,"",22,[298],[{"e":299}],[{"v":300}],[{"all":true,"optional":true,"k":301},{"c":299},{"check":"none","timeout":2000,"optional":true,"wv":298}],[{"cc":302}],{}],[1,"bynder",2,"",22,[303],[{"e":304}],[{"v":304}],[{"c":304}],[{"cc":305},{"cc":306}],{}],[1,"c-banner-allow-cookies",0,"",10,[307],[{"e":308}],[{"v":307}],[{"c":308},{"check":"none","wv":307}],[{"cc":309}],{}],[1,"cassie",0,"",10,[310],[{"e":311}],[{"v":312}],[{"c":313}],[],{}],[1,"cc_banner",1,"",22,[314],[{"e":314}],[{"v":315}],[{"h":314}],[],{}],[1,"cc-banner-springer",2,"",22,[316],[{"e":316}],[{"v":316}],[{"if":{"e":317},"then":[{"k":317}],"else":[{"c":318},{"w":319},{"all":true,"optional":true,"k":320},{"if":{"e":321},"then":[{"k":321}],"else":[{"k":322}]}]}],[{"eval":"EVAL_CC_BANNER2_0"}],{}],[1,"ccm19",2,"",22,[323],[{"any":[{"e":324},{"e":325}]}],[{"v":323}],[{"if":{"e":326},"then":[{"c":326}],"else":[{"c":327},{"c":328}]}],[{"timeout":2000,"check":"none","wv":323}],{}],[1,"ceneo",2,"",22,[329],[{"e":330}],[{"v":330}],[{"c":330}],[{"timeout":1000,"check":"none","wv":329}],{}],[1,"cf-gdpr-cookie-consent",2,"",22,[331],[{"e":332}],[{"v":332}],[{"c":332},{"wv":333},{"if":{"e":334},"then":[{"all":true,"k":334}]},{"k":333},{"check":"none","wv":331}],[{"cc":335},{"cc":336},{"cc":337}],{}],[1,"check24",2,"",22,[338],[{"e":339}],[{"v":340}],[{"c":339}],[{"check":"none","v":338}],{}],[1,"check24-partnerprogramm-de",2,"",22,[341],[{"e":342}],[{"check":"any","v":342}],[{"c":343}],[],{}],[1,"chefcookie",2,"",22,[344],[{"e":345}],[{"v":346}],[{"c":347}],[{"cc":348}],{}],[1,"ciaopeople.it",2,"",22,[349],[{"e":350}],[{"v":351}],[{"c":352}],[{"check":"none","timeout":5000,"wv":351}],{}],[1,"cinemaplus",2,"",22,[353],[{"e":354}],[{"v":354}],[{"c":354}],[{"check":"none","v":354}],{}],[1,"civic-cookie-control",2,"",22,[355],[{"e":356}],[{"v":357},{"v":356}],[{"if":{"v":358},"then":[{"c":358}],"else":[{"if":{"e":359},"then":[{"c":359},{"wv":360}]},{"if":{"v":358},"then":[{"c":358}],"else":[{"if":{"e":361},"then":[{"c":361}],"else":[{"c":362}]}]}]}],[],{}],[1,"ckies",2,"",22,[363],[{"e":364}],[{"v":363}],[{"c":364}],[{"cc":365}],{}],[1,"cksmodal",2,"",22,[366],[{"e":367}],[{"v":368}],[{"c":369},{"check":"none","wv":366}],[{"cc":370}],{}],[1,"click.io",2,"",22,[371],[{"e":371}],[{"v":371}],[{"w":372},{"wait":500},{"k":372},{"w":373},{"all":true,"k":373},{"k":374}],[{"cc":375}],{}],[1,"clinch",2,"",10,[376],[{"e":376}],[{"v":376}],[{"if":{"e":377},"then":[{"k":377}],"else":[{"k":378},{"all":true,"optional":true,"k":379},{"k":380}]}],[{"cc":381}],{"intermediate":false}],[1,"close-cookie-notice-snippet",1,"",22,[382],[{"e":383}],[{"v":382}],[{"h":382}],[],{}],[1,"cloudflare-zaraz",2,"",22,[384],[{"exists":[".cf_modal_container",".cf_consent-buttons"]}],[{"visible":[".cf_modal_container",".cf_consent-buttons"]}],[{"waitForThenClick":[".cf_modal_container",".cf_consent-buttons #cf_consent-buttons__reject-all"]}],[],{}],[1,"cm-cookie-manager",2,"",22,[385,386],[{"e":387},{"e":388}],[{"v":388}],[{"if":{"v":389},"then":[{"k":389}]},{"wv":387},{"if":{"e":390},"then":[{"all":true,"k":390}]},{"k":387}],[{"check":"none","v":388}],{}],[1,"coki61",2,"",22,[],[{"e":391}],[{"v":392}],[{"c":391}],[{"cc":393}],{}],[1,"columbia-privacy-notice",1,"",22,[394],[{"e":395}],[{"v":394}],[{"h":394}],[{"check":"none","v":394}],{}],[1,"com-consent-layer",2,"",22,[396],[{"exists":["com-consent-layer","dialog"]}],[{"visible":["com-consent-layer","dialog[open]"]}],[{"waitForThenClick":["com-consent-layer","#cmpDenyAll"]}],[{"waitForVisible":["com-consent-layer","dialog[open]"],"timeout":1000,"check":"none"}],{}],[1,"Complianz banner",2,"",22,[397],[{"e":398}],[{"check":"any","v":398}],[{"c":399}],[{"cc":400}],{}],[1,"Complianz categories",2,"",22,[401],[{"e":401}],[{"v":401}],[{"if":{"e":402},"then":[{"k":403}],"else":[{"all":true,"optional":true,"k":404},{"k":405}]}],[],{}],[1,"Complianz notice",1,"",22,[406],[{"e":407}],[{"v":407}],[{"if":{"e":408},"then":[{"k":408}],"else":[{"h":409},{"optional":true,"h":410}]}],[],{}],[1,"Complianz opt-out",2,"",22,[411],[{"e":411}],[{"v":411}],[{"timeout":2000,"optional":true,"w":412},{"if":{"e":408},"then":[{"k":408}],"else":[{"if":{"e":413},"then":[{"k":413},{"c":414},{"c":415}]}]}],[],{}],[1,"Complianz optin",2,"",22,[416],[{"e":416}],[{"v":417}],[{"if":{"v":408},"then":[{"k":408}],"else":[{"if":{"v":418},"then":[{"c":418},{"wv":419},{"all":true,"optional":true,"k":420},{"k":421}],"else":[{"if":{"e":403},"then":[{"k":403}],"else":[{"k":413},{"c":414},{"c":415}]}]}]},{"optional":true,"h":422}],[],{}],[1,"compricer",2,"",22,[423,424],[{"e":425},{"e":426}],[{"v":427}],[{"c":427},{"wv":425},{"all":true,"optional":true,"k":428},{"k":425},{"check":"none","optional":true,"wv":425}],[{"check":"none","timeout":2000,"wv":427},{"negated":true,"e":428}],{}],[1,"concept3d",2,"",22,[429],[{"e":430}],[{"v":430}],[{"c":430},{"wv":431},{"all":true,"optional":true,"k":432},{"c":431}],[{"cc":433}],{}],[1,"conextra",2,"",22,[434,435],[{"e":436}],[{"v":436}],[{"if":{"e":437},"then":[{"c":437}],"else":[{"all":true,"optional":true,"k":438},{"c":439}]}],[{"timeout":1000,"check":"none","wv":436}],{}],[1,"consent-flo",2,"",22,[440],[{"e":441}],[{"v":442}],[{"if":{"e":443},"then":[{"c":443}],"else":[{"c":444},{"wv":445},{"all":true,"optional":true,"k":446},{"c":445}]}],[{"e":447}],{}],[1,"consent-studio",0,"",10,[448,449],[{"e":450}],[{"v":450}],[{"if":{"v":451},"then":[{"k":451}],"else":[{"if":{"check":"any","v":452},"then":[{"k":452}],"else":[{"if":{"e":453},"then":[{"all":true,"k":453}]},{"c":454}]}]},{"check":"none","wv":450}],[{"wait":500},{"cc":455}],{}],[1,"consentaur",2,"",22,[456],[{"e":456}],[{"v":457}],[{"c":457}],[{"cc":458}],{}],[1,"consentmagic",0,"",10,[],[{"v":459}],[{"v":459}],[{"if":{"e":460},"then":[{"retry":5,"retryInterval":500,"c":460}],"else":[{"c":461},{"wv":462},{"all":true,"optional":true,"k":463},{"c":462}]}],[{"cc":464}],{}],[1,"consentmanager-ncmp",2,"",22,[465],[{"e":466}],[{"check":"any","v":466}],[{"wait":500},{"eval":"EVAL_CONSENTMANAGER_NCMP_REJECT"}],[{"cc":467}],{}],[1,"consentmo",2,"",22,[468],[{"exists":["csm-cookie-consent",".csm-wrapper"]}],[{"visible":["csm-cookie-consent",".csm-wrapper button"]}],[{"if":{"exists":["csm-cookie-consent",".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='reject']"]},"then":[{"waitForThenClick":["csm-cookie-consent",".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='reject']"]}],"else":[{"if":{"exists":["csm-cookie-consent",".csm-wrapper [data-csm-button-type='do_not_sell']"]},"then":[{"waitForThenClick":["csm-cookie-consent",".csm-wrapper [data-csm-button-type='do_not_sell']"]},{"waitForThenClick":["csm-cookie-consent",".csm-wrapper [data-csm-button-type='dismiss']"],"timeout":2000,"optional":true}],"else":[{"waitForThenClick":["csm-cookie-consent",".csm-wrapper .cc-settings, .csm-wrapper [data-csm-button-type='preferences']"]},{"waitForVisible":["csm-cookie-consent",".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='accept_selected'], .csm-wrapper [data-preferences-csm-button-type='accept_selected']"]},{"if":{"exists":["csm-cookie-consent",".csm-wrapper .cc-deny"]},"then":[{"click":["csm-cookie-consent",".csm-wrapper .cc-deny"]}],"else":[{"click":["csm-cookie-consent",".csm-wrapper [data-csm-button-type='accept_selected'], .csm-wrapper [data-preferences-csm-button-type='accept_selected']"]}]}]}]}],[{"waitForVisible":["csm-cookie-consent",".csm-wrapper button"],"timeout":1000,"check":"none"}],{}],[1,"Cookie Information Banner",2,"",22,[469],[{"e":469}],[{"v":469}],[{"eval":"EVAL_COOKIEINFORMATION_0"},{"wait":1000},{"if":{"v":470},"then":[{"h":469}]}],[{"cc":471}],{}],[1,"cookie-banner-element",2,"",22,[472],[{"e":472}],[{"visible":["cookie-banner-element#ckb","#ckb[role=\"dialog\"]"]}],[{"waitForThenClick":["cookie-banner-element#ckb","#ckn"]}],[],{}],[1,"cookie-bar-frame",2,"",22,[473],[{"e":474}],[{"v":475}],[{"c":474}],[{"cc":476}],{}],[1,"cookie-consent-spice",0,"",10,[477,478],[{"e":478}],[{"v":478}],[{"c":479}],[],{}],[1,"cookie-info-banner",2,"",22,[480],[{"e":481}],[{"v":482}],[{"c":481}],[{"cc":483},{"negated":true,"cc":484}],{}],[1,"cookie-law-info",2,"",22,[485],[{"e":486},{"eval":"EVAL_COOKIE_LAW_INFO_DETECT"}],[{"v":486}],[{"h":485},{"eval":"EVAL_COOKIE_LAW_INFO_0"}],[{"negated":true,"cc":487}],{}],[1,"cookie-manager-popup",0,"",10,[488],[{"e":489}],[{"v":289}],[{"if":{"e":490},"then":[{"k":490}],"else":[{"c":488},{"wv":491},{"all":true,"optional":true,"k":492},{"k":493}]}],[{"eval":"EVAL_COOKIE_MANAGER_POPUP_0"}],{"intermediate":false}],[1,"cookie-notice-checkboxes",2,"",22,[494],[{"e":495}],[{"v":495}],[{"if":{"e":496},"then":[{"c":496}],"else":[{"if":{"e":497},"then":[{"all":true,"k":497}]},{"c":498}]}],[{"check":"none","v":498}],{}],[1,"cookie-popup-close-cookies",2,"",22,[499],[{"e":500},{"e":501}],[{"e":502}],[{"eval":"EVAL_COOKIE_POPUP_CLOSE"},{"timeout":2000,"w":503}],[{"negated":true,"cc":504}],{}],[1,"cookie-popup-cookieno",2,"",22,[505],[{"e":506}],[{"v":499}],[{"c":506},{"check":"none","timeout":3000,"wv":499}],[],{}],[1,"cookie-popup-cookieok",1,"",22,[507],[{"e":508}],[{"v":499}],[{"h":499}],[],{}],[1,"cookie-pref-form",2,"",22,[509],[{"e":510}],[{"v":509}],[{"if":{"e":511},"then":[{"c":511}],"else":[{"c":512},{"wv":513},{"all":true,"optional":true,"k":514},{"c":513}]}],[],{}],[1,"cookie-script",2,"",22,[515,516],[{"e":517}],[{"v":518}],[{"if":{"e":519},"then":[{"wait":100},{"k":519}],"else":[{"if":{"e":520},"then":[{"k":520},{"timeout":3000,"optional":true,"wv":521},{"if":{"e":522},"then":[{"c":519}],"else":[{"if":{"v":523},"then":[{"if":{"e":524},"then":[{"all":true,"k":524}]},{"retry":6,"retryInterval":1000,"c":523}],"else":[{"k":525}]}]}],"else":[{"if":{"e":523},"then":[{"all":true,"optional":true,"k":524},{"k":523}],"else":[{"k":525}]}]}]}],[],{}],[1,"cookieacceptbar",1,"",22,[526],[{"e":526}],[{"v":526}],[{"h":526}],[],{}],[1,"cookiebot.be",2,"",22,[527],[{"e":528}],[{"v":527}],[{"c":528}],[{"cc":529}],{}],[1,"cookieconsent2",2,"",22,[530],[{"e":530}],[{"e":531},{"e":532}],[{"if":{"e":533},"then":[{"c":533}],"else":[{"c":534},{"wait":500},{"all":true,"optional":true,"k":535},{"c":536}]}],[{"cc":537}],{}],[1,"cookieconsent2-legacy",2,"",22,[538],[{"e":539}],[{"e":540}],[{"c":541},{"timeout":1000,"optional":true,"w":542},{"if":{"e":542},"then":[{"all":true,"optional":true,"k":543},{"c":544}]}],[{"any":[{"cc":537},{"cc":545}]}],{}],[1,"cookieconsent3",2,"",22,[546],[{"e":546}],[{"v":547}],[{"if":{"e":548},"then":[{"c":548}],"else":[{"c":549},{"c":550}]}],[{"cc":537}],{}],[1,"cookiecuttr",0,"",10,[551],[{"e":552}],[{"check":"any","v":553}],[{"if":{"e":554},"then":[{"k":554}],"else":[{"h":551}]}],[],{}],[1,"cookiefirst.com",2,"",22,[555],[{"e":556}],[{"check":"any","v":557}],[{"if":{"e":558},"then":[{"k":558}],"else":[{"if":{"e":559},"then":[{"timeout":5000,"wv":559},{"k":559},{"wait":1500}],"else":[{"if":{"e":560},"then":[{"k":560},{"timeout":1000,"wv":561},{"eval":"EVAL_COOKIEFIRST_1"},{"wait":1000},{"k":562}],"else":[{"k":558}]}]}]}],[{"eval":"EVAL_COOKIEFIRST_0"}],{}],[1,"cookiehub",2,"",22,[563],[{"e":564}],[{"v":564}],[{"if":{"e":565},"then":[{"k":565},{"wv":566},{"if":{"e":567},"then":[{"k":567}],"else":[{"all":true,"optional":true,"k":568},{"k":569}]}],"else":[{"h":563}]}],[{"cc":570}],{}],[1,"cookieinfo",1,"",22,[571],[{"e":571}],[{"v":571}],[{"c":572}],[],{}],[1,"cookiejs-banner",2,"",22,[573],[{"e":574}],[{"v":575}],[{"c":576}],[{"cc":577}],{}],[1,"cookiejs-modal",2,"",22,[573],[{"e":578}],[{"v":579}],[{"c":580}],[{"cc":581}],{}],[1,"cookielegit",2,"",22,[582],[{"e":582}],[{"v":583}],[{"if":{"e":584},"then":[{"c":584}],"else":[{"c":585},{"wv":586},{"optional":true,"k":587},{"optional":true,"k":588},{"k":586}]}],[{"cc":589},{"cc":590}],{}],[1,"cookieman",2,"",10,[591],[{"e":592}],[{"check":"any","v":592}],[{"if":{"e":593},"then":[{"retry":3,"retryInterval":500,"c":593}],"else":[{"c":594},{"timeout":2000,"optional":true,"wv":595},{"all":true,"optional":true,"k":596},{"retry":3,"retryInterval":500,"c":597}]}],[{"cc":598},{"timeout":2000,"check":"none","wv":592}],{}],[1,"cookiepermission-cp-overlay",0,"",10,[599],[{"e":600}],[{"v":599}],[{"c":600},{"check":"none","wv":599}],[{"cc":601}],{}],[1,"cookieprompter",0,"",10,[602],[{"e":602}],[{"v":602}],[{"if":{"e":603},"then":[{"k":603}],"else":[{"c":604}]},{"check":"none","wv":602}],[{"cc":605}],{}],[1,"cookiereports",2,"",22,[606,607],[{"e":608}],[{"v":606}],[{"eval":"EVAL_COOKIEREPORTS_OPT_OUT"}],[{"eval":"EVAL_COOKIEREPORTS_TEST"}],{}],[1,"cookiesinfo-closecookies",2,"",22,[],[{"e":609}],[{"v":609}],[{"c":609}],[{"check":"none","timeout":2000,"wv":610}],{}],[1,"cookiesjsr",2,"",22,[611],[{"e":612}],[{"v":611}],[{"if":{"v":613},"then":[{"k":613}],"else":[{"c":614},{"wv":615},{"if":{"v":616},"then":[{"k":616}],"else":[{"all":true,"optional":true,"k":617},{"c":618}]}]},{"timeout":2000,"check":"none","wv":611}],[],{}],[1,"cookietractor",2,"",22,[619],[{"e":620}],[{"v":620}],[{"all":true,"optional":true,"k":621},{"c":622}],[{"timeout":1000,"check":"none","wv":620}],{}],[1,"cookieyes",2,"",22,[623],[{"e":624}],[{"v":624}],[{"if":{"e":625},"then":[{"c":625}],"else":[{"if":{"e":626},"then":[{"c":626},{"w":627},{"all":true,"optional":true,"k":628},{"c":629},{"optional":true,"wv":630},{"optional":true,"c":631}],"else":[{"if":{"e":632},"then":[{"k":632},{"w":633},{"all":true,"optional":true,"k":634},{"c":635}],"else":[{"h":636}]}]}]}],[{"cc":637}],{}],[1,"cookieyes-legacy",2,"",22,[638],[{"e":638}],[{"v":638}],[{"if":{"v":639},"then":[{"c":639}],"else":[{"c":640},{"wv":641},{"all":true,"optional":true,"k":642},{"k":641}]}],[{"cc":643},{"any":[{"cc":644},{"cc":645}]}],{}],[1,"cookiez",2,"",22,[646],[{"e":647}],[{"v":648}],[{"c":648}],[{"wait":1000},{"cc":649}],{}],[1,"coolblue",0,"",10,[650],[{"e":651}],[{"v":652}],[{"c":653}],[],{}],[1,"cornerstone-brands",2,"",22,[654,655],[{"any":[{"e":656},{"e":657}]}],[{"any":[{"v":654},{"v":655}]}],[{"timeout":5000,"optional":true,"c":656},{"timeout":6000,"optional":true,"c":657}],[{"check":"none","timeout":2000,"wv":658}],{}],[1,"corona-in-zahlen.de",2,"",22,[659],[{"e":659}],[{"v":659}],[{"k":660},{"k":661}],[],{}],[1,"costco-travel",2,"",22,[],[{"e":662},{"e":663}],[{"v":664}],[{"c":662},{"wv":665},{"all":true,"optional":true,"k":666},{"all":true,"optional":true,"k":667},{"k":665}],[],{}],[1,"craft-cookie-consent",2,"",22,[668],[{"e":669}],[{"v":670}],[{"all":true,"optional":true,"k":671},{"if":{"v":672},"then":[{"k":672}],"else":[{"k":673},{"wv":674},{"if":{"v":675},"then":[{"k":675}],"else":[{"k":672}]}]}],[{"w":676}],{}],[1,"ct-ultimate-gdpr",2,"",22,[677],[{"e":677}],[{"timeout":30000,"wv":677}],[{"if":{"v":678},"then":[{"k":678}],"else":[{"if":{"v":679},"then":[{"k":679},{"c":680},{"k":681}],"else":[{"h":677}]}]}],[{"wait":500},{"cc":682}],{}],[1,"curseforge",1,"",22,[683],[{"e":684}],[{"v":684}],[{"h":683}],[],{}],[1,"cz-eshop-cookies-consent",2,"",22,[685],[{"e":686}],[{"v":687}],[{"retry":10,"retryInterval":500,"c":686}],[{"cc":688},{"negated":true,"cc":689}],{}],[1,"dack365",2,"",22,[690],[{"e":691}],[{"v":692}],[{"c":692},{"c":693}],[{"check":"none","timeout":5000,"wv":694}],{}],[1,"daikin",2,"",22,[695],[{"e":696}],[{"v":695}],[{"c":696}],[{"cc":697}],{}],[1,"dailymotion-us",1,"",22,[698],[{"e":699}],[{"v":699}],[{"h":699}],[],{}],[1,"dan-com",2,"",10,[],[{"e":700}],[{"v":700}],[{"c":701}],[],{}],[1,"danskebank",0,"",10,[702],[{"e":703}],[{"v":704}],[{"c":705},{"check":"none","wv":704}],[{"cc":706}],{}],[1,"datagrail",2,"",22,[707],[{"e":707},{"exists":[".dg-consent-banner",".dg-app"]}],[{"v":707}],[{"if":{"exists":[".dg-consent-banner","button.dg-button.reject_all, button.dg-button.accept_some"]},"then":[{"waitForThenClick":[".dg-consent-banner","button.dg-button.reject_all, button.dg-button.accept_some"]}],"else":[{"if":{"exists":[".dg-consent-banner",".dg-browser-signal-notice"]},"then":[{"if":{"exists":[".dg-consent-banner","button.dg-button.open_layer"]},"then":[{"waitForThenClick":[".dg-consent-banner","button.dg-button.open_layer"]},{"waitForThenClick":[".dg-consent-banner","button.dg-button.reject_all, button.dg-button.accept_some, button.dg-button.essential_only, button.dg-button.custom"]}],"else":[{"waitForThenClick":[".dg-consent-banner","button.dg-header-close"]}]}],"else":[{"waitForThenClick":[".dg-consent-banner","button.dg-button.open_layer"]},{"waitForThenClick":[".dg-consent-banner","button.dg-button.reject_all, button.dg-button.accept_some, button.dg-button.essential_only"]}]}]}],[{"any":[{"cc":708},{"exists":[".dg-consent-banner",".dg-browser-signal-notice"]}]}],{}],[1,"datasign",0,"",22,[],[{"e":709}],[{"visible":["#datasign_cmp__host","#datasign_cmp__cmp_summary"]}],[{"if":{"exists":["#datasign_cmp__host","#datasign_cmp__cmp_content input[type=checkbox]:not([disabled])"]},"then":[{"waitForThenClick":["#datasign_cmp__host","#datasign_cmp__config-button, #datasign_cmp__cmp_summary [aria-controls=datasign_cmp__cmp_content]"]},{"waitForVisible":["#datasign_cmp__host","#datasign_cmp__cmp_content_apply-button"]},{"click":["#datasign_cmp__host","#datasign_cmp__cmp_content input[type=checkbox]:checked:not([disabled])"],"all":true,"optional":true},{"click":["#datasign_cmp__host","#datasign_cmp__cmp_content_apply-button"]}],"else":[{"click":["#datasign_cmp__host","#datasign_cmp__cmp_summary .datasign__dialogCloseButton--index-module"]}]}],[{"waitForVisible":["#datasign_cmp__host","#datasign_cmp__cmp_summary"],"check":"none","timeout":3000}],{}],[1,"de-volksbank",2,"",22,[],[{"e":710}],[{"e":711}],[{"c":712}],[{"cc":713}],{}],[1,"dfactory-cookie-notice",2,"",22,[714],[{"e":715}],[{"v":716}],[{"if":{"e":717},"then":[{"c":717}],"else":[{"c":718}]}],[{"cc":719}],{}],[1,"didomi",2,"",22,[720],[{"e":721}],[{"check":"any","v":722}],[{"if":{"e":723},"then":[{"c":723}],"else":[{"eval":"EVAL_DIDOMI_OPT_OUT"}]}],[{"eval":"EVAL_DIDOMI_TEST"}],{}],[1,"dintel",2,"",22,[724],[{"exists":["dnt-cookies",".dnt-cookies__footer"]}],[{"visible":["dnt-cookies",".dnt-cookies--is-open"]}],[{"waitForThenClick":["dnt-cookies",".dnt-cookies__footer dnt-button[type^=secondary]"]},{"waitForVisible":["dnt-cookies",".dnt-cookies--is-open"],"check":"none","timeout":2000,"optional":true}],[{"cc":725}],{}],[1,"django-gdpr-cookie-consent",2,"",22,[726,727],[{"e":728}],[{"v":728}],[{"if":{"e":729},"then":[{"c":729}],"else":[{"c":730},{"c":731},{"k":732}]},{"check":"none","timeout":10000,"wv":733}],[{"cc":734}],{}],[1,"dmgmedia",2,"",22,[735],[{"e":736}],[{"v":736}],[{"c":737},{"wv":738},{"all":true,"c":739},{"waitForThenClick":["[data-project=\"mol-fe-cmp\"] [class*=footer]","xpath///button[contains(., 'Save & Exit')]"]}],[],{}],[1,"dmgmedia-us",2,"",22,[740],[{"e":741}],[{"wv":741}],[{"c":742},{"wv":743},{"c":744},{"c":745}],[],{}],[1,"doordash-storefront",2,"",22,[746],[{"e":746}],[{"v":746}],[{"retry":15,"retryInterval":300,"c":747}],[{"cc":748}],{}],[1,"dpgmedia-nl",2,"",22,[749],[{"e":749}],[{"visible":["#pg-shadow-host-dom","#pg-modal"]}],[{"if":{"visible":["#pg-shadow-host-dom","#pg-reject-btn"]},"then":[{"click":["#pg-shadow-host-dom","#pg-reject-btn"]}],"else":[{"waitForThenClick":["#pg-shadow-host-dom","#pg-configure-btn"]},{"waitForThenClick":["#pg-shadow-host-dom","#pg-reject-btn"]}]}],[],{}],[1,"dreamlab-cmp",2,"",22,[750],[{"e":751}],[{"v":750}],[{"c":752},{"c":753}],[{"cc":754}],{}],[1,"drouot-rgpd",2,"",22,[755,756],[{"e":757}],[{"v":755}],[{"c":758}],[{"cc":759}],{}],[1,"Drupal",2,"",22,[],[{"e":760}],[{"v":760}],[{"k":761}],[],{}],[1,"duda-cookie-notification",0,"",10,[762],[{"e":763}],[{"v":764}],[{"retry":3,"retryInterval":500,"c":765}],[{"check":"none","v":766}],{"intermediate":false}],[1,"dunelm.com",2,"",22,[767],[{"e":768}],[{"v":768}],[{"k":769},{"k":770}],[{"cc":771},{"cc":772}],{}],[1,"e-grip",2,"",22,[],[{"e":773}],[{"v":774}],[{"if":{"e":775},"then":[{"c":775}],"else":[{"c":776},{"timeout":2000,"w":777},{"if":{"e":778},"then":[{"k":779}]},{"k":780}]}],[{"cc":734},{"negated":true,"cc":781}],{}],[1,"ecbeing",1,"",22,[782],[{"e":783}],[{"v":784}],[{"h":784}],[],{}],[1,"eccmm",2,"",22,[],[{"exists":["#eccm-shadow-host",".eccmm"]}],[{"visible":["#eccm-shadow-host",".eccmm-dialog.eccmm-visible"]}],[{"waitForThenClick":["#eccm-shadow-host",".eccmm-dialog .eccmm-deny-all-btn--footer"]}],[{"waitForVisible":["#eccm-shadow-host",".eccmm-dialog"],"check":"none","timeout":2000}],{}],[1,"econda-pp2",0,"",22,[785,786],[{"e":787}],[{"check":"any","v":788}],[{"c":788}],[{"cc":789}],{}],[1,"educamadrid",2,"",22,[790],[{"e":791}],[{"v":792}],[{"c":793},{"c":794}],[{"timeout":3000,"w":795},{"cc":796}],{}],[1,"ee-consent-notice",2,"",22,[797],[{"e":798}],[{"v":799}],[{"if":{"e":800},"then":[{"c":800}],"else":[{"eval":"EVAL_EE_CONSENT_DECLINE_0"},{"c":801}]}],[],{}],[1,"elsevier-pure",2,"",22,[802],[{"e":803}],[{"v":803}],[{"c":804}],[{"timeout":1000,"check":"none","wv":803}],{}],[1,"Ensighten",2,"",22,[805,806],[{"any":[{"v":807},{"v":808}]}],[{"any":[{"v":807},{"v":808}]}],[{"wait":500},{"if":{"v":807},"then":[{"if":{"check":"any","v":809},"then":[{"c":809}],"else":[{"if":{"check":"any","v":810},"then":[{"c":810},{"timeout":1000,"w":808},{"all":true,"optional":true,"k":811},{"c":812}],"else":[{"c":813}]}]}],"else":[{"all":true,"optional":true,"k":811},{"c":812}]}],[],{}],[1,"epaas",2,"",22,[814],[{"e":814}],[{"visible":["epaas-consent-drawer-shell","section.consentDrawer"]}],[{"if":{"exists":["epaas-consent-drawer-shell","button.reject-button"]},"then":[{"waitForThenClick":["epaas-consent-drawer-shell","button.reject-button"]}],"else":[{"waitForThenClick":["epaas-consent-drawer-shell","button.personalize-button"]},{"waitFor":["epaas-consent-drawer-shell","epaas-policy-page-shell"]},{"waitFor":["epaas-consent-drawer-shell","epaas-policy-page-shell","label[class*='category-header__switch']"],"optional":true},{"click":["epaas-consent-drawer-shell","epaas-policy-page-shell","label.category-header__switch--on input"],"all":true,"optional":true},{"waitFor":["epaas-consent-drawer-shell","section.consentDrawer.layered button.accept-button"]},{"if":{"exists":["epaas-consent-drawer-shell","button.save-button"]},"then":[{"click":["epaas-consent-drawer-shell","button.save-button"]}],"else":[{"waitFor":["epaas-consent-drawer-shell","epaas-policy-page-shell","label.category-header__switch--off"]},{"click":["epaas-consent-drawer-shell","button.accept-button"]}]}]}],[{"cc":815}],{}],[1,"erdee-media",2,"",22,[816],[{"e":816}],[{"v":817}],[{"c":818}],[],{}],[1,"eset",0,"",22,[819],[{"e":820}],[{"v":820}],[{"if":{"v":821},"then":[{"k":821}],"else":[{"k":822},{"wv":823},{"all":true,"optional":true,"k":824},{"k":823}]}],[{"wait":2000},{"cc":825}],{}],[1,"etracker",2,"",22,[826,827],[{"e":828}],[{"v":828}],[{"c":828}],[{"timeout":3000,"check":"none","wv":826},{"cc":829}],{}],[1,"etsy",2,"",22,[830,831],[{"e":830}],[{"v":830}],[{"k":832},{"timeout":3000,"wv":833},{"wait":1000},{"eval":"EVAL_ETSY_0"},{"eval":"EVAL_ETSY_1"}],[],{}],[1,"EU Cookie Law",1,"",22,[834],[{"e":835}],[{"wait":500},{"v":835}],[{"h":835}],[{"negated":true,"cc":836}],{}],[1,"eu-cookie-compliance-banner",2,"",22,[],[{"e":837}],[{"e":837}],[{"k":838}],[{"negated":true,"cc":839}],{}],[1,"eu-cookie-law-popup",2,"",22,[840],[{"e":841}],[{"check":"any","v":841}],[{"c":841}],[{"check":"none","timeout":2000,"wv":841}],{}],[1,"EZoic",2,"",22,[842],[{"e":842}],[{"v":842}],[{"wait":500},{"k":843},{"w":844},{"all":true,"optional":true,"k":845},{"c":846}],[{"cc":847}],{}],[1,"fanatics",2,"",22,[848],[{"e":848}],[{"v":848}],[{"c":849}],[{"cc":850}],{}],[1,"fastcmp",0,"",22,[851],[{"e":852}],[{"v":852}],[{"waitForThenClick":["iframe#fast-cmp-iframe",".fast-cmp-home-refuse button"]}],[{"cc":853}],{}],[1,"fastweb-cookie-center",2,"",22,[854],[{"e":855}],[{"v":856}],[{"waitForThenClick":["iframe.ck_if","#Main > .close img"]},{"check":"none","timeout":5000,"wv":854}],[{"check":"none","v":857}],{}],[1,"fedex",0,"",22,[858],[{"e":858}],[{"v":859}],[{"c":860}],[{"cc":861}],{}],[1,"fera-cookies",2,"",22,[862],[{"e":863}],[{"v":864}],[{"if":{"v":865},"then":[{"k":865}],"else":[{"c":866}]},{"timeout":2000,"optional":true,"c":867}],[{"cc":868},{"negated":true,"cc":869}],{}],[1,"fever",2,"",22,[870],[{"e":871}],[{"v":870}],[{"c":871},{"if":{"e":872},"then":[{"k":873}]},{"c":874}],[{"cc":875}],{}],[1,"fever-cookie-advice",2,"",22,[876],[{"e":876}],[{"v":876}],[{"c":877},{"wv":878},{"c":879}],[{"wait":500},{"cc":880}],{}],[1,"fides",2,"",22,[881],[{"e":882}],[{"v":882},{"check":"none","v":883},{"eval":"EVAL_FIDES_DETECT_POPUP"}],[{"w":884},{"if":{"v":885},"then":[{"retry":5,"retryInterval":500,"c":886}],"else":[{"k":887},{"retry":5,"retryInterval":500,"c":888}]}],[],{}],[1,"finna",2,"",22,[889],[{"e":890}],[{"v":890}],[{"retry":10,"retryInterval":500,"c":890}],[],{}],[1,"finsweet",0,"",22,[891],[{"any":[{"e":891},{"exists":["[fs-consent-element=root]","[fs-consent-element=banner]"]}]}],[{"any":[{"v":892},{"visible":["[fs-consent-element=root]","[fs-consent-element=banner] [fs-consent-element=allow]"]}]}],[{"wait":500},{"if":{"e":893},"then":[{"k":893}],"else":[{"if":{"exists":["[fs-consent-element=root]","[fs-consent-element=banner] [fs-consent-element=deny]"]},"then":[{"click":["[fs-consent-element=root]","[fs-consent-element=banner] [fs-consent-element=deny]"]}],"else":[{"h":894}]}]}],[],{}],[1,"first-visit-notice",1,"",22,[895],[{"e":896}],[{"v":895}],[{"h":895}],[],{}],[1,"fixpart",2,"",22,[897],[{"e":898}],[{"v":897}],[{"c":899}],[{"cc":900}],{}],[1,"fnsp-cookieconsent",2,"",22,[901],[{"e":902}],[{"v":903}],[{"c":904}],[{"cc":905}],{}],[1,"ford-dse",2,"",22,[906],[{"e":907}],[{"v":908}],[{"c":907},{"w":909}],[{"cc":910}],{}],[1,"fullertonhotels.com",0,"",10,[],[{"exists":["#ifrmCookieBanner","#sp-decline"]}],[{"visible":["#ifrmCookieBanner","#sp-decline"]}],[{"wait":500},{"waitForThenClick":["#ifrmCookieBanner","#sp-decline"]}],[],{}],[1,"funding-choices",2,"",22,[911],[{"e":912}],[{"e":913}],[{"if":{"e":914},"then":[{"k":914}],"else":[{"e":915}]},{"all":true,"optional":true,"k":916},{"optional":true,"k":917}],[],{}],[1,"gallup",2,"",22,[918],[{"e":919}],[{"v":919}],[{"c":919},{"wait":500},{"c":920}],[{"cc":921}],{}],[1,"gdpr-legal-cookie",2,"",22,[922],[{"any":[{"eval":"EVAL_GDPR_LEGAL_COOKIE_DETECT_CMP"},{"e":923}]}],[{"check":"any","v":924}],[{"c":925}],[{"eval":"EVAL_GDPR_LEGAL_COOKIE_TEST"}],{}],[1,"gear4music",2,"",10,[926],[{"e":927}],[{"v":926}],[{"c":928},{"check":"none","timeout":2000,"wv":926}],[{"wait":1000},{"cc":929}],{}],[1,"gemini.google.com",2,"",22,[930],[{"e":931}],[{"v":930}],[{"c":932}],[],{}],[2,"getproven",1,"",22,[933],[{"e":934}],[{"v":934}],[{"h":933},{"removeClass":"cdk-global-scrollblock","selector":"html","optional":true}],[],{}],[1,"giustizia-it",2,"",22,[935],[{"e":936}],[{"v":937}],[{"all":true,"optional":true,"k":938},{"c":939}],[{"cc":940}],{}],[1,"gobasic",2,"",22,[941],[{"e":942}],[{"v":942}],[{"c":942}],[{"cc":943}],{}],[1,"godaddy-privacy-widget",2,"",22,[944],[{"exists":["#gtm_privacy","#privacy_widget"]}],[{"visible":["#gtm_privacy","#privacy_widget"]}],[{"waitForThenClick":["#gtm_privacy","#pw_decline"]}],[{"cc":945}],{}],[1,"godaddy-website-builder",2,"",22,[946],[{"e":947}],[{"v":948}],[{"c":947}],[],{}],[1,"godaddy-website-builder-cosmetic",1,"",22,[946],[{"e":946},{"negated":true,"e":947}],[{"v":948}],[{"h":946}],[],{}],[1,"google-consent-standalone",2,"",22,[],[{"e":949},{"e":950}],[{"v":949}],[{"c":951}],[],{}],[1,"google-cookiebar",0,"",22,[952],[{"e":952}],[{"v":952}],[{"if":{"e":953},"then":[{"k":953}],"else":[{"h":952}]}],[],{}],[1,"google.com",2,"",22,[954],[{"e":954},{"e":955}],[{"v":956}],[{"c":956}],[{"cc":957}],{}],[1,"gov.uk",2,"",22,[],[{"e":958}],[{"e":959}],[{"wait":300},{"if":{"visible":[".govuk-cookie-banner__message","xpath///button[contains(., 'Reject')] | //a[contains(., 'Reject')] | //input[contains(@value, 'Reject')] | //button[contains(., 'do not use analytics cookies')]"]},"then":[{"click":[".govuk-cookie-banner__message","xpath///button[contains(., 'Reject')] | //a[contains(., 'Reject')] | //input[contains(@value, 'Reject')] | //button[contains(., 'do not use analytics cookies')]"]}]},{"waitForVisible":[".govuk-cookie-banner__message","xpath///button[contains(., 'Hide')] | //a[contains(., 'Hide')] | //input[contains(@value, 'Hide')]"]},{"click":[".govuk-cookie-banner__message","xpath///button[contains(., 'Hide')] | //a[contains(., 'Hide')] | //input[contains(@value, 'Hide')]"]}],[],{}],[1,"gravito",2,"",22,[960],[{"e":961}],[{"v":961}],[{"if":{"v":962},"then":[{"k":962}],"else":[{"c":963},{"c":964}]},{"check":"none","timeout":2000,"optional":true,"wv":961}],[{"cc":965}],{}],[1,"grupa-pracuj",0,"",22,[],[{"e":966}],[{"check":"any","v":966}],[{"if":{"e":967},"then":[{"c":968},{"wv":969},{"all":true,"optional":true,"k":970},{"c":971}],"else":[{"c":972},{"wv":973},{"all":true,"optional":true,"k":974},{"c":975}]}],[{"any":[{"cc":976},{"cc":977}]}],{}],[1,"grupa-rmf",2,"",22,[978],[{"e":979}],[{"v":978}],[{"wv":980},{"k":980},{"wv":981},{"k":981},{"wv":982},{"if":{"e":983},"then":[{"k":982}]},{"wv":984},{"k":984},{"check":"none","wv":978}],[],{}],[1,"gsb-cookie-banner",2,"",22,[985],[{"e":986}],[{"check":"any","v":987}],[{"c":987}],[{"cc":287}],{}],[1,"gsb-cookiebanner-selection",2,"",22,[988,989],[{"e":990}],[{"v":990}],[{"all":true,"optional":true,"k":991},{"c":990}],[{"cc":992}],{}],[1,"guesty",0,"",22,[993],[{"e":994}],[{"v":993}],[{"c":995}],[{"cc":996}],{}],[1,"gwo",2,"",22,[997],[{"e":997}],[{"v":998}],[{"if":{"e":999},"then":[],"else":[{"c":1000}]},{"w":1001},{"all":true,"optional":true,"k":1002},{"optional":true,"k":1003},{"k":1000}],[{"cc":1004}],{}],[1,"hacon-next-gen",2,"",22,[],[{"exists":["next-gen-map-based-route","next-gen-cookie-dialog"]}],[{"visible":["next-gen-map-based-route","next-gen-cookie-dialog next-gen-page.cookie-dialog"]}],[{"if":{"exists":["next-gen-map-based-route","next-gen-cookie-dialog input[type=checkbox]:checked"]},"then":[{"click":["next-gen-map-based-route","next-gen-cookie-dialog input[type=checkbox]:checked"],"all":true}]},{"waitForThenClick":["next-gen-map-based-route","next-gen-cookie-dialog next-gen-page-footer button[variant=secondary]"]}],[{"cc":1005}],{}],[1,"handelsbanken",2,"",22,[1006],[{"e":1007}],[{"v":1007}],[{"c":1008}],[{"cc":1009}],{}],[1,"healthline-media",2,"",22,[1010],[{"e":1011}],[{"e":1011}],[{"if":{"e":1012},"then":[{"k":1012}],"else":[{"wv":1013},{"k":1014}]}],[],{}],[1,"hema",2,"",22,[288],[{"v":1015}],[{"v":1015}],[{"c":1016}],[{"cc":1017}],{}],[1,"hkdir",2,"",22,[1018],[{"e":1019},{"e":1020}],[{"v":1018}],[{"c":1021}],[{"cc":1022}],{}],[1,"hl.co.uk",2,"",22,[1023,1024],[{"e":1024}],[{"e":1024}],[{"k":1025},{"h":1026},{"w":1027},{"optional":true,"k":1028},{"w":1029},{"optional":true,"k":1030},{"k":1031}],[],{}],[1,"holidaymedia",2,"",22,[1032],[{"e":1033}],[{"v":1032}],[{"timeout":2000,"c":1034}],[],{}],[1,"hometogo",2,"",22,[1035],[{"e":1036}],[{"v":1035}],[{"if":{"e":1037},"then":[{"c":1037}],"else":[{"c":1038},{"c":1039}]}],[{"cc":734}],{}],[1,"hu-manity",2,"",22,[1040],[{"e":1041}],[{"v":1041}],[{"c":1042}],[],{}],[1,"hubspot",2,"",22,[],[{"e":1043}],[{"v":1043}],[{"if":{"e":1044},"then":[{"k":1044}],"else":[{"v":1045},{"k":1045}]}],[],{}],[1,"ibkr",2,"",22,[1046],[{"e":1047}],[{"v":1046}],[{"if":{"v":1048},"then":[{"k":1048}],"else":[{"k":1047},{"c":1049}]}],[{"cc":1050}],{}],[1,"idxrcookies",2,"",22,[1051],[{"e":1052}],[{"v":1052}],[{"c":1052}],[],{}],[1,"ihavecookies",2,"",22,[1053],[{"e":1054}],[{"v":1053}],[{"c":1054},{"wv":1055},{"all":true,"optional":true,"k":1056},{"if":{"v":1057},"then":[{"k":1057}],"else":[{"k":1058}]},{"check":"none","timeout":2000,"optional":true,"wv":1053}],[{"cc":1059}],{}],[1,"ilovepdf",2,"",22,[],[{"e":1060}],[{"v":1060}],[{"c":1060},{"c":1061}],[{"cc":1062}],{}],[1,"impress-co-jp",2,"",22,[1063],[{"e":1064}],[{"v":1064}],[{"c":1064}],[{"cc":1065}],{}],[1,"in2cookiemodal",2,"",22,[1066],[{"e":1066}],[{"v":1066}],[{"if":{"v":1067},"then":[{"k":1067}],"else":[{"all":true,"optional":true,"k":1068},{"c":1069}]},{"check":"none","timeout":2000,"optional":true,"wv":1066}],[{"cc":1070}],{}],[1,"incomit",2,"",22,[1071],[{"exists":["cookie-consent-element",".incom-cookie-module"]}],[{"visible":["cookie-consent-element",".incom-cookie-module #main-cookie-view"]}],[{"waitForThenClick":["cookie-consent-element","#main-cookie-view nav button.btn:not(#cookie-accept-all)"]}],[{"cc":1072}],{}],[1,"indy-systems",1,"",22,[1073],[{"e":1074}],[{"v":1073}],[{"h":1073}],[],{}],[1,"infomaniak-rgpd",2,"",22,[1075],[{"e":1075}],[{"visible":["module-rgpd-component",".modal"]}],[{"waitForThenClick":["module-rgpd-component",".buttons > button:nth-of-type(2)"],"retry":3}],[{"cc":1076}],{}],[1,"inmobi",2,"",22,[1077],[{"e":1078}],[{"v":1078}],[{"c":1079}],[{"cc":1080}],{}],[1,"insided",0,"",10,[1081],[{"e":1082}],[{"v":1082}],[{"c":1082}],[{"check":"none","v":1082}],{}],[1,"interia",2,"",22,[1083],[{"e":1084}],[{"v":1083}],[{"c":1084},{"c":1085}],[{"check":"none","timeout":3000,"wv":1083}],{}],[1,"ionos.de",2,"",22,[1086,1087],[{"e":1087}],[{"v":1087}],[{"k":1088},{"k":1089}],[],{}],[1,"islington-council",2,"",22,[1090],[{"e":1091}],[{"v":1090}],[{"timeout":10000,"w":1092},{"c":1091},{"c":1093}],[{"cc":1094},{"cc":1095}],{}],[1,"iubenda",2,"",22,[1096],[{"e":1096}],[{"any":[{"v":1097},{"v":1098}]}],[{"if":{"e":1099},"then":[{"k":1099}],"else":[{"if":{"e":1100},"then":[{"c":1100},{"c":1101},{"c":1102}],"else":[{"if":{"e":1098},"then":[{"k":1098},{"c":1103},{"timeout":2000,"optional":true,"c":1104}],"else":[{"h":1096}]}]}]}],[{"any":[{"eval":"EVAL_IUBENDA_1"},{"cc":1105}]}],{}],[1,"iWink",2,"",22,[1106],[{"e":1106}],[{"v":1106}],[{"c":1107}],[{"cc":1108}],{}],[1,"jcookie",1,"",22,[1109],[{"e":1110}],[{"v":1111}],[{"h":1109}],[],{}],[1,"jetpack-eu-cookie-law",1,"",22,[1112],[{"e":1112}],[{"v":1112}],[{"h":1112}],[],{}],[1,"jobindex",2,"",22,[1113],[{"e":1113}],[{"v":1113}],[{"if":{"e":1114},"then":[{"all":true,"k":1114}]},{"c":1115}],[{"cc":458}],{}],[1,"johnlewis.com",2,"",22,[1116],[{"e":1116}],[{"e":1116}],[{"k":1117},{"wait":500},{"all":true,"optional":true,"k":1118},{"k":1119}],[],{}],[1,"jokul-cookie-consent",2,"",22,[],[{"e":1120}],[{"v":1120}],[{"if":{"e":1121},"then":[{"c":1121}],"else":[{"if":{"e":1122},"then":[{"all":true,"k":1122}]},{"c":1120}]}],[{"cc":1123}],{}],[1,"jollyroom",2,"",22,[1124],[{"e":1125}],[{"v":1126}],[{"c":1127},{"if":{"e":1128},"then":[{"all":true,"k":1128}]},{"retry":5,"retryInterval":500,"c":1125}],[{"check":"none","v":1129}],{}],[1,"jpmorgan-chase",2,"",22,[1130],[{"e":1131}],[{"v":1131}],[{"c":1131}],[{"cc":1132}],{}],[1,"jquery.cookieBar",1,"",22,[1133],[{"e":1134}],[{"check":"any","v":1134}],[{"h":1133}],[{"check":"none","v":1134},{"negated":true,"cc":1135}],{}],[1,"kamsoft-cookiesmanager",2,"",22,[1136],[{"e":1137}],[{"v":1137}],[{"if":{"e":1138},"then":[{"c":1138}],"else":[{"c":1139},{"wv":1140},{"all":true,"optional":true,"k":1141},{"k":1140}]}],[],{}],[1,"kaspersky-cookies-notification",1,"",22,[1142],[{"e":1143},{"e":1144}],[{"v":1144}],[{"h":1145}],[],{}],[1,"kconsent",0,"",10,[1146],[{"e":1147}],[{"v":1148}],[{"c":1149}],[],{}],[1,"ketch",2,"",10,[1150,1151,1152],[{"any":[{"e":1150},{"e":1151},{"e":1152},{"e":1153}]}],[{"any":[{"v":1150},{"v":1151},{"v":1152}]}],[{"if":{"e":1154},"then":[{"c":1154},{"if":{"v":1155},"then":[{"k":1156}]}],"else":[{"if":{"e":1157},"then":[{"c":1157}],"else":[{"if":{"e":1158},"then":[{"if":{"e":1159},"then":[{"c":1159}],"else":[{"if":{"e":1160},"then":[{"k":1160}]}]}]}]}]},{"timeout":1000,"optional":true,"w":1161},{"if":{"e":1161},"then":[{"if":{"e":1162},"then":[{"c":1162}],"else":[{"all":true,"optional":true,"k":1163}]},{"k":1156}]}],[{"cc":1164}],{"intermediate":false}],[1,"klaxit-cookie-consent",2,"",22,[1165],[{"e":1166}],[{"v":1167}],[{"c":1168}],[{"cc":1169}],{}],[1,"klp-cookie-banner",2,"",22,[1170],[{"e":1170}],[{"v":1171}],[{"c":1172}],[{"wait":500},{"cc":1173}],{}],[1,"kolibri-cookie-widget",2,"",22,[1174],[{"e":1174}],[{"v":1174}],[{"c":1175},{"check":"none","timeout":5000,"wv":1174}],[{"cc":1176}],{}],[1,"krieger-consent-form",2,"",22,[1177],[{"e":1178}],[{"v":1179}],[{"all":true,"optional":true,"k":1180},{"c":1181}],[{"cc":1182}],{}],[1,"krown-cookie-banner",0,"",22,[1183],[{"e":1184}],[{"v":1184}],[{"c":1184}],[{"wait":500},{"eval":"EVAL_KROWN_COOKIE_BANNER_TEST"}],{}],[1,"kulturit-ccm",0,"",22,[1185],[{"exists":["#kit-ccm",".ccm-container dialog"]}],[{"visible":["#kit-ccm",".ccm-container dialog[open] .action-buttons"]}],[{"waitForThenClick":["#kit-ccm","dialog[open] .action-buttons button:not(.accept-selected):last-of-type"]}],[{"waitForVisible":["#kit-ccm",".ccm-container dialog .action-buttons"],"check":"none","timeout":2000}],{}],[1,"kwik-fit",0,"",22,[1186,1187],[{"e":1188}],[{"v":1189}],[{"c":1190},{"wv":1191},{"all":true,"optional":true,"k":1192},{"c":1193},{"check":"none","wv":1186}],[],{}],[1,"la7-cmp",2,"",22,[1194],[{"e":1195}],[{"v":1195}],[{"c":1195}],[{"cc":1196}],{}],[1,"lab-network-consent",2,"",22,[1197],[{"e":1198}],[{"v":1197}],[{"c":1198}],[{"cc":1199}],{}],[1,"laravel-cookie-consent",2,"",22,[1200],[{"e":1200}],[{"v":1200}],[{"c":1201},{"wv":1202},{"all":true,"optional":true,"k":1203},{"c":1204},{"check":"none","wv":1200}],[{"cc":1205}],{}],[1,"lawwwing",2,"",22,[1206],[{"e":1206}],[{"v":1207}],[{"c":1208},{"check":"none","timeout":2000,"wv":1209}],[{"cc":1210}],{}],[1,"legally-ok",2,"",22,[1211],[{"exists":["#jmdCookieConsentWrapper","#cookieConsent"]}],[{"visible":["#jmdCookieConsentWrapper","#cookieConsent"]}],[{"waitForThenClick":["#jmdCookieConsentWrapper","#cookieConsent .js-select-none"]}],[{"cc":125}],{}],[1,"lg-cookiecontrol",2,"",22,[1212],[{"e":1213}],[{"v":1212}],[{"if":{"e":1214},"then":[{"k":1214}],"else":[{"c":1215}]}],[{"cc":1216}],{}],[1,"lia",2,"",22,[1217],[{"e":1217}],[{"e":1218},{"v":1217}],[{"c":1219}],[],{}],[1,"liferay-cookies-banner",2,"",22,[1220],[{"e":1220},{"negated":true,"e":1221}],[{"v":1220}],[{"c":1222}],[{"cc":1223}],{}],[1,"lightbox",2,"",22,[1224],[{"e":1225}],[{"v":1225}],[{"k":1226}],[],{}],[1,"lineagrafica",1,"",22,[1227],[{"e":1227}],[{"e":1227}],[{"h":1227}],[],{}],[1,"lineagrafica-reject",2,"",22,[1228],[{"e":1229}],[{"v":1229}],[{"c":1229}],[{"check":"none","timeout":2000,"wv":1230}],{}],[1,"linkedin.com",2,"",22,[1231],[{"e":1231}],[{"v":1231}],[{"wv":1232},{"wait":500},{"c":1232}],[{"check":"none","wv":1231}],{}],[1,"lta",0,"",10,[1233],[{"e":1233}],[{"v":1233}],[{"c":1234},{"wv":1235},{"all":true,"optional":true,"k":1236},{"k":1237}],[{"cc":1238}],{}],[1,"macaron",2,"",22,[1239],[{"e":1239}],[{"v":1240}],[{"if":{"e":1241},"then":[{"k":1241}],"else":[{"c":1242},{"w":1243},{"wv":1244},{"all":true,"optional":true,"c":1245},{"c":1246}]}],[{"cc":1247}],{}],[1,"mars-cookies-prompt",2,"",22,[1248],[{"e":1249}],[{"v":1249}],[{"if":{"e":1250},"then":[{"k":1251}]},{"wv":1252},{"if":{"e":1253},"then":[{"all":true,"k":1253}]},{"k":1254}],[{"cc":1255}],{}],[1,"mco-consent",2,"",22,[1256,1257,1258,1259],[{"e":1260}],[{"v":1261}],[{"c":1261}],[{"cc":1262}],{}],[1,"mediamarkt.de",2,"",22,[1263,1264],[{"e":1265}],[{"e":1265}],[{"k":1266}],[],{}],[1,"mensaje-cookies",2,"",22,[1267,1268],[{"e":1269},{"any":[{"e":1270},{"e":1271}]}],[{"v":1272}],[{"if":{"e":1270},"then":[{"c":1270}],"else":[{"c":1273},{"c":1271}]},{"check":"none","timeout":3000,"wv":1272}],[{"check":"none","v":1272}],{}],[1,"mercedes-benz-cmm",2,"",22,[1274],[{"exists":["cmm-cookie-banner",".cmm-cookie-banner__wrapper"]}],[{"visible":["cmm-cookie-banner",".cmm-cookie-banner__wrapper.visible"]}],[{"if":{"exists":["cmm-cookie-banner","wb7-button[data-test=handle-deny-button]"]},"then":[{"waitForThenClick":["cmm-cookie-banner","wb7-button[data-test=handle-deny-button]"]}],"else":[{"waitForThenClick":["cmm-cookie-banner","wb7-button[data-test=toggle-cookie-details]"]},{"waitForVisible":["cmm-cookie-banner","wb7-button[data-test=handle-confirm-selection-button]"]},{"click":["cmm-cookie-banner","input[data-test=handle-category-change]:checked:not([disabled])"],"all":true,"optional":true},{"waitForThenClick":["cmm-cookie-banner","wb7-button[data-test=handle-confirm-selection-button]"]}]}],[{"waitForVisible":["cmm-cookie-banner",".cmm-cookie-banner__wrapper.visible"],"timeout":2000,"check":"none"}],{}],[1,"meridiancu",2,"",22,[1275],[{"e":1276}],[{"v":1277}],[{"c":1278},{"wv":1279},{"optional":true,"k":1280},{"c":1281}],[{"cc":1282}],{}],[1,"meta-cookie-dialog",2,"",22,[1283,1284],[{"e":1285}],[{"v":1285}],[{"retry":3,"retryInterval":500,"c":1286},{"check":"none","wv":1286}],[],{}],[1,"meteored",2,"",22,[1287],[{"e":1288}],[{"v":1288}],[{"c":1289},{"retry":5,"retryInterval":500,"c":1290}],[{"timeout":1000,"check":"none","wv":1287},{"cc":1291}],{}],[1,"microsoft.com",2,"",22,[1292],[{"e":1292}],[{"e":1292}],[{"eval":"EVAL_MICROSOFT_0"}],[{"eval":"EVAL_MICROSOFT_2"}],{}],[2,"milestone-internet",1,"",22,[1293],[{"e":1294}],[{"v":1294}],[{"h":1293},{"removeClass":"pushItDown","selector":".pushItDown","optional":true}],[],{}],[1,"minitool",1,"",22,[1295],[{"e":1296}],[{"v":1295}],[{"h":1295}],[{"check":"none","v":1295}],{}],[1,"mirasvit-gdpr",2,"",22,[1297,1298,1299,1300],[{"e":1301}],[{"check":"any","v":1301}],[{"if":{"check":"any","v":1302},"then":[{"any":[{"k":1303},{"k":1304}]}],"else":[{"any":[{"k":1305},{"k":1306}]},{"check":"any","timeout":5000,"wv":1307},{"all":true,"timeout":2000,"optional":true,"c":1308},{"any":[{"k":1309},{"k":1310},{"k":1311}]}]},{"check":"none","timeout":10000,"wv":1301}],[{"cc":1312},{"check":"none","v":1301}],{}],[1,"miteco",2,"",22,[1313,1314],[{"e":1315}],[{"v":1316}],[{"c":1315},{"wv":1317},{"if":{"e":1318},"then":[{"k":1319}]},{"k":1317}],[],{}],[1,"mittanbud",0,"",22,[],[{"e":1320}],[{"v":1321}],[{"c":1322}],[{"cc":1323},{"cc":204}],{}],[1,"mkdocs-material",2,"",22,[1324,1325],[{"e":1326}],[{"v":1327}],[{"all":true,"optional":true,"k":1328},{"c":1329}],[],{}],[1,"mobirise-cookies-alert",2,"",22,[1330],[{"e":1331}],[{"v":1330}],[{"retry":3,"retryInterval":1500,"c":1331}],[{"check":"none","timeout":4000,"wv":1330}],{}],[1,"mobirise-cookies-alert-cosmetic",1,"",22,[1330],[{"e":1330},{"negated":true,"e":1331}],[{"v":1330}],[{"h":1330}],[],{}],[1,"moebel-de-group",2,"",22,[1332],[{"e":1333}],[{"v":1333}],[{"retry":2,"retryInterval":3500,"c":1333}],[{"timeout":4000,"check":"none","wv":1333}],{}],[1,"moneysavingexpert.com",2,"",22,[],[{"e":1334}],[{"v":1334}],[{"k":1335},{"k":1336}],[],{}],[1,"Moove",2,"",22,[1337],[{"e":1337}],[{"v":1338}],[{"if":{"e":1339},"then":[{"k":1339}],"else":[{"if":{"e":1340},"then":[{"k":1340},{"wv":1341},{"eval":"EVAL_MOOVE_0"},{"k":1342}],"else":[{"h":1337}]}]}],[{"check":"none","v":1337}],{}],[1,"msg-cookie",1,"",22,[1343],[{"e":1344}],[{"v":1344}],[{"h":1345}],[],{}],[1,"musti",2,"",22,[1346],[{"e":1347}],[{"v":1346}],[{"c":1348}],[{"check":"none","timeout":2000,"wv":1346}],{}],[1,"ncsoft-cookie-toast",2,"",22,[1349,1350],[{"e":1349}],[{"v":1351}],[{"c":1351}],[{"cc":1352}],{}],[1,"nhs.uk",2,"",22,[1353],[{"e":1353}],[{"e":1353}],[{"k":1354}],[],{}],[1,"nikkeibp",2,"",22,[1355],[{"e":1356}],[{"v":1356}],[{"c":1356}],[{"timeout":1000,"check":"none","wv":1355}],{}],[1,"nowaera",2,"",22,[1357,1358],[{"e":1359}],[{"v":1360}],[{"c":1361},{"wv":1362},{"all":true,"optional":true,"k":1363},{"k":1362}],[{"cc":1364},{"cc":1365}],{}],[1,"npo-ccm",2,"",22,[1366],[{"exists":["ccm-notification","#ccm_notification .ccm_btn--save"]}],[{"visible":["ccm-notification","#ccm_notification"]}],[{"if":{"exists":["ccm-notification","#ccm_notification .ccm_btn--deny-all"]},"then":[{"click":["ccm-notification","#ccm_notification .ccm_btn--deny-all"]}],"else":[{"click":["ccm-notification","#ccm_notification input[type='radio'][value='false']"],"all":true,"optional":true},{"waitForThenClick":["ccm-notification","#ccm_notification .ccm_btn--save:not(.ccm_btn_disabled)"]}]}],[],{}],[1,"nuxt-cookie-manager",2,"",22,[1367],[{"e":1368}],[{"v":1367}],[{"if":{"e":1369},"then":[{"c":1369}],"else":[{"all":true,"optional":true,"k":1370},{"c":1371}]}],[{"check":"none","timeout":2000,"wv":1367}],{}],[1,"nyu-langone",2,"",22,[1372],[{"e":1373}],[{"v":1374}],[{"c":1375}],[{"cc":1376}],{}],[1,"obi.de",2,"",22,[1377],[{"e":1378}],[{"v":1378}],[{"k":1379}],[],{}],[1,"occ-gdpr",2,"",22,[1380],[{"e":1381}],[{"v":1382}],[{"c":1383},{"wv":1384},{"if":{"e":1385},"then":[{"all":true,"k":1385}]},{"k":1384}],[{"cc":1386}],{}],[1,"om",2,"",22,[1387,1388],[{"e":1389}],[{"e":1389}],[{"if":{"e":1390},"then":[{"c":1390}],"else":[{"all":true,"optional":true,"k":1391},{"c":1392}]}],[],{}],[1,"onecom-cookie-banner",1,"",22,[1393],[{"e":1394}],[{"v":1393}],[{"h":1393}],[],{}],[1,"opencmp",2,"",22,[],[{"exists":[".cmp-root-container","#cmp_consentDialog .cmp_ui .cmp_mainButtons"]}],[{"visible":[".cmp-root-container","#cmp_consentDialog .cmp_ui"]}],[{"if":{"exists":[".cmp-root-container",".cmp_ui .cmp_mainButtons .cmp_button:not(.cmp-button-accept-all)"]},"then":[{"click":[".cmp-root-container",".cmp_ui .cmp_mainButtons .cmp_button:not(.cmp-button-accept-all)"]}],"else":[{"click":[".cmp-root-container",".cmp_ui .cmp_mainButtons .cmp_saveLink a"]},{"waitFor":[".cmp-root-container",".cmp_ui .cmp_level1Container"],"timeout":3000},{"click":[".cmp-root-container",".cmp_ui .cmp_activateAll button:nth-child(2)"],"all":true,"optional":true},{"click":[".cmp-root-container",".cmp_ui .cmp_level1Container .cmp_levelItem:nth-child(2) > div"],"optional":true},{"waitFor":[".cmp-root-container",".cmp_ui .cmp_level1Container .cmp_levelItem.cmp_active:nth-child(2)"],"timeout":2000,"optional":true},{"click":[".cmp-root-container",".cmp_ui .cmp_activateAll button:nth-child(2)"],"all":true,"optional":true},{"click":[".cmp-root-container",".cmp_ui .cmp_mainButtons .cmp_saveLink a"]}]}],[{"waitForVisible":[".cmp-root-container","#cmp_consentDialog .cmp_ui"],"timeout":2000,"check":"none"}],{}],[1,"openli",2,"",22,[1395],[{"e":1395}],[{"check":"any","v":1396}],[{"c":1397}],[],{}],[1,"optum-legal-banner",2,"",22,[1398],[{"e":1399}],[{"v":1398}],[{"c":1399}],[{"check":"none","timeout":2000,"wv":1398}],{}],[2,"orw-cookie-banner",1,"",22,[1400],[{"e":1400}],[{"v":1401}],[{"h":1400},{"removeClass":"cookie-not-accepted","selector":"body","optional":true},{"removeClass":"drawer-opt","selector":"body","optional":true},{"removeClass":"show-overlay","selector":"body","optional":true}],[],{}],[1,"osano",2,"",22,[1402],[{"e":1403}],[{"eval":"EVAL_OSANO_DETECT"},{"v":1404}],[{"if":{"e":1405},"then":[{"k":1405}],"else":[{"if":{"v":1406},"then":[{"k":1406}],"else":[{"h":1402}]}]}],[],{}],[1,"otto.de",2,"",22,[1407],[{"e":1407}],[{"v":1408}],[{"k":1409}],[],{}],[1,"overleaf",2,"",22,[1410],[{"e":1411}],[{"v":1411}],[{"c":1412}],[{"cc":1413}],{}],[1,"pabcogypsum",2,"",22,[1414],[{"e":1415}],[{"v":1415}],[{"c":1416}],[],{}],[1,"pandectes",2,"",22,[1417,1418],[{"any":[{"e":1417},{"exists":["pandectes-cmp","dialog.notice"]}]}],[{"any":[{"v":1417},{"visible":["pandectes-cmp","dialog.notice"]}]}],[{"if":{"e":1417},"then":[{"if":{"v":1419},"then":[{"c":1419}],"else":[{"c":1420},{"wv":1421},{"k":1422},{"k":1421}]},{"optional":true,"h":1417}],"else":[{"if":{"visible":["pandectes-cmp","dialog.notice button.deny"]},"then":[{"waitForThenClick":["pandectes-cmp","dialog.notice button.deny"]}],"else":[{"waitForThenClick":["pandectes-cmp","dialog.notice button.preferences"]},{"waitForVisible":["pandectes-cmp","dialog.preferences"]},{"if":{"exists":["pandectes-cmp","dialog.preferences button.deny"]},"then":[{"click":["pandectes-cmp","dialog.preferences button.deny"]}],"else":[{"click":["pandectes-cmp","dialog.preferences button[role=switch][aria-checked=true]:not([disabled])"],"all":true,"optional":true},{"click":["pandectes-cmp","dialog.preferences button.custom"]}]}]}]}],[{"wait":500},{"eval":"EVAL_PANDECTES_TEST"}],{}],[1,"passle",2,"",22,[1423],[{"e":1424}],[{"v":1425}],[{"c":1426}],[{"wait":1000},{"cc":1427}],{}],[1,"paypal-us",2,"",22,[1428],[{"e":1429}],[{"v":1429}],[{"if":{"e":1430},"then":[{"retry":10,"retryInterval":500,"c":1430}],"else":[{"h":1429}]}],[{"wait":1000},{"cc":1431}],{}],[1,"paypal.com",2,"",22,[1432],[{"e":1432}],[{"v":1433}],[{"retry":10,"retryInterval":500,"c":1430}],[{"wait":500},{"cc":1431}],{}],[1,"paytronix",2,"",22,[1434],[{"e":1435}],[{"v":1434}],[{"c":1436}],[{"cc":1437}],{}],[1,"pe-cookies",2,"",22,[1438],[{"exists":["pe-cookies","#pecookies-continue-btn"]}],[{"visible":["pe-cookies",".pecookies__modal"]}],[{"waitForThenClick":["pe-cookies","#pecookies-continue-btn"]}],[{"cc":1439}],{}],[1,"pigu",2,"",22,[],[{"e":1440}],[{"v":1441}],[{"retry":10,"retryInterval":500,"c":1441}],[{"check":"none","timeout":2000,"wv":1441}],{}],[1,"pikpak",2,"",22,[1442],[{"e":1443}],[{"v":1444}],[{"c":1445},{"wv":1446},{"all":true,"optional":true,"k":1447},{"c":1448}],[{"any":[{"cc":1449},{"cc":1450}]}],{}],[1,"piwik-pro",2,"",22,[1451,1452,1453],[{"e":1454}],[{"check":"any","v":1455}],[{"if":{"e":1456},"then":[{"c":1456},{"timeout":1000,"optional":true,"c":1457}],"else":[{"if":{"v":1458},"then":[{"k":1458}],"else":[{"c":1459},{"timeout":2000,"wv":1460},{"if":{"v":1458},"then":[{"k":1458}],"else":[{"all":true,"optional":true,"k":1461},{"if":{"v":1462},"then":[{"k":1462}],"else":[{"k":1459}]}]}]}]}],[{"cc":1364},{"cc":1463}],{}],[1,"planned-parenthood",2,"",22,[1464],[{"e":1465},{"e":1466}],[{"v":1464}],[{"c":1465},{"wv":1467},{"c":1466}],[{"cc":1468}],{}],[1,"plentyshop",2,"",22,[1469],[{"e":1470}],[{"check":"any","v":1471}],[{"if":{"e":1472},"then":[{"c":1472}],"else":[{"c":1473}]}],[{"check":"none","v":1471},{"cc":1474}],{}],[1,"plumrocket-cookie-consent",2,"",22,[],[{"e":1475}],[{"v":1475},{"negated":true,"e":1476}],[{"if":{"e":1477},"then":[{"c":1477}],"else":[{"c":1478},{"c":1479}]}],[{"cc":1480}],{}],[1,"pmc",1,"",22,[1481],[{"e":1481}],[{"v":1481}],[{"h":1481}],[],{}],[1,"pmc-privacy-banner",2,"",22,[1482],[{"e":1482}],[{"v":1482}],[{"c":1483}],[{"check":"none","v":1482}],{}],[1,"police-uk",2,"",22,[1484],[{"e":1485}],[{"v":1485}],[{"c":1485},{"timeout":5000,"optional":true,"wv":1486},{"optional":true,"k":1486}],[{"cc":1487}],{}],[1,"polisen-se",0,"",10,[1488],[{"e":1489}],[{"v":1488}],[{"c":1490}],[{"check":"none","timeout":3000,"optional":true,"wv":1488},{"cc":1491}],{}],[1,"popupsmart-cookie-notice",1,"",22,[1492],[{"e":1493}],[{"v":1494}],[{"h":1492}],[],{}],[1,"pornhat",1,"",22,[1495],[{"v":1496}],[{"v":1496}],[{"h":1495}],[],{}],[1,"pride.com",1,"",22,[1497],[{"e":1498}],[{"v":1498}],[{"h":1497}],[],{}],[1,"PrimeBox CookieBar",2,"",22,[473],[{"e":1499}],[{"check":"any","v":1499}],[{"optional":true,"k":1500},{"h":473}],[{"negated":true,"cc":1501}],{}],[1,"primeconsent",2,"",22,[1502],[{"exists":[".azpp-cookie-consent",".banner-main"]}],[{"visible":[".azpp-cookie-consent",".banner-main .button-group > button"]}],[{"waitForThenClick":[".azpp-cookie-consent",".banner-main .button-group > button:nth-of-type(2):nth-last-of-type(2)"]}],[{"any":[{"cc":1503},{"cc":1504}]}],{}],[1,"privacy-area",0,"",22,[1505],[{"e":1506},{"e":1507}],[{"v":1505}],[{"if":{"e":1508},"then":[{"k":1508}],"else":[{"all":true,"optional":true,"k":1509},{"k":1507}]},{"check":"none","timeout":3000,"wv":1505}],[{"cc":1510}],{}],[1,"privacylab-elmo",2,"",22,[1511],[{"e":1512}],[{"v":1513}],[{"c":1514}],[{"wait":500},{"cc":1515}],{}],[1,"privado",0,"",10,[233],[{"e":1516}],[{"v":1516}],[{"if":{"e":1517},"then":[{"c":1517}],"else":[{"c":1518},{"wv":1519},{"c":1519}]}],[],{}],[1,"pro-euclp-cookies-box",1,"",22,[1520],[{"e":1521}],[{"v":1520}],[{"h":1520}],[{"check":"none","v":1520}],{}],[1,"pubfactory",0,"",22,[1522],[{"e":1522}],[{"v":1522}],[{"timeout":20000,"optional":true,"w":1523},{"c":1524},{"check":"none","wv":1522}],[{"cc":1525}],{}],[1,"pubtech",2,"",22,[1526],[{"e":1526}],[{"v":1527}],[{"if":{"e":1528},"then":[{"k":1528}],"else":[{"k":1529}]}],[{"eval":"EVAL_PUBTECH_0"}],{}],[1,"qtip-jgrowl-cookies",2,"",22,[],[{"e":1530}],[{"v":1530}],[{"c":1531}],[{"check":"none","timeout":2000,"wv":1530}],{}],[1,"quantcast",2,"",22,[1532],[{"e":1533}],[{"v":1534}],[{"if":{"e":1535},"then":[{"timeout":2000,"optional":true,"w":1536},{"all":true,"optional":true,"k":1537},{"timeout":2000,"optional":true,"w":1538},{"all":true,"optional":true,"k":1539},{"timeout":2000,"c":1540},{"timeout":2000,"optional":true,"c":1541}],"else":[{"if":{"e":1542},"then":[{"timeout":5000,"c":1543}],"else":[{"timeout":2000,"w":1544},{"if":{"e":1545},"then":[{"k":1545}],"else":[{"k":1546},{"wv":1547},{"all":true,"optional":true,"k":1548},{"click":[".qc-cmp2-main","xpath///button[contains(., 'REJECT ALL') or contains(., 'ALLE VERWERPEN') or contains(., 'ΑΠΟΡΡΙΠΤΩ ΤΑ ΠΑΝΤΑ') or contains(., 'RESPINGERE TOTALĂ') or contains(., 'ALLE ABLEHNEN') or contains(., 'ODRZUCENIE') or contains(., 'BLOQUEAR TODO') or contains(., 'REJEITAR TODOS') or contains(., 'RIFIUTA TUTTO') or contains(., 'TOUT REFUSER') or contains(., 'ОТКЛОНИТЬ ВСЕХ')]"],"optional":true},{"check":"none","timeout":1000,"optional":true,"wv":1549},{"if":{"v":1549},"then":[{"if":{"e":1550},"then":[{"k":1550}],"else":[{"waitForThenClick":[".qc-cmp2-main","xpath///button[contains(.,'SAVE & EXIT') or contains(.,'SALVA ED ESCI') or contains(.,'GUARDAR Y SALIR') or contains(.,'SPEICHERN & VERLASSEN')"],"timeout":5000}]}]}]}]}]}],[],{}],[1,"quick-cookie-consent",2,"",22,[1551],[{"e":1552}],[{"v":1552}],[{"c":1552},{"wv":1553},{"if":{"e":1554},"then":[{"k":1555}]},{"if":{"e":1556},"then":[{"k":1556}],"else":[{"k":1557}]}],[{"cc":1558},{"negated":true,"cc":1559},{"negated":true,"cc":1560},{"negated":true,"cc":1561}],{}],[1,"r42-consent-iframe",0,"",10,[],[{"exists":["#consent_iframe",".stsp__cookie-container #declineButton"]}],[{"v":1562},{"visible":["#consent_iframe",".stsp__cookie-container #declineButton"]}],[{"waitForThenClick":["#consent_iframe",".stsp__cookie-container #declineButton"]}],[{"cc":1563}],{}],[1,"r42-cookiebar",0,"",10,[1564],[{"e":1565}],[{"v":1566}],[{"c":1565}],[{"timeout":1000,"check":"none","wv":1565}],{}],[1,"rabobank",2,"",22,[1567],[{"e":1567}],[{"v":1567}],[{"if":{"e":1568},"then":[{"retry":10,"retryInterval":500,"c":1568}],"else":[{"retry":10,"retryInterval":500,"c":1569}]}],[{"cc":1570}],{}],[1,"radboud-cookie-overlay",2,"",22,[],[{"e":1571}],[{"v":1572}],[{"c":1573}],[{"cc":1574}],{}],[1,"radio-canada",1,"",22,[1575],[{"e":1575}],[{"check":"any","v":1575}],[{"h":1575}],[],{}],[2,"rakshaos",0,"",22,[1576,1577],[{"e":1576}],[{"v":1576}],[{"if":{"e":1578},"then":[{"c":1578}],"else":[{"c":1579},{"c":1580},{"addStyle":"display: none !important","selector":"#raksha-consent-banner"}]}],[],{}],[1,"rambler",2,"",22,[1581],[{"e":1581}],[{"v":1581}],[{"c":1582}],[{"cc":1583}],{}],[1,"rcs-cpmt",2,"",22,[1584],[{"exists":["#_cpmt-iframe","#_cpmt"]}],[{"v":1584},{"visible":["#_cpmt-iframe","#_cpmt"]}],[{"waitForThenClick":["#_cpmt-iframe","#_cpmt-reject"]}],[],{}],[1,"rdc-concents",2,"",22,[1585,1586],[{"e":1587}],[{"v":1587}],[{"c":1587}],[{"negated":true,"e":1588}],{}],[1,"react-cookie-consent",2,"",22,[],[{"e":1589}],[{"v":1589}],[{"c":1589}],[{"timeout":1000,"check":"none","wv":1589}],{}],[1,"real-cookie-banner",0,"",10,[1590],[{"e":1591}],[{"v":1591}],[{"waitForThenClick":["div[consent-skip-blocker=\"1\"][id][data-bg] > dialog > div > div > div > div > div > a[role=button]:not([id])","xpath///span[contains(., ' ohne ') or contains(., 'without') or contains(., 'Ablehnen')]"]}],[{"timeout":1000,"check":"none","wv":1591}],{}],[1,"remove-cookie-notice",2,"",22,[1592],[{"e":1593}],[{"v":1594}],[{"c":1593},{"check":"none","timeout":2000,"wv":1595}],[{"check":"none","v":1595}],{}],[1,"rijksoverheid-notification-bar",0,"",10,[1596],[{"e":1597}],[{"v":1598}],[{"c":1599}],[{"cc":1600}],{}],[1,"ring",2,"",22,[],[{"e":1601}],[{"v":1602}],[{"c":1601},{"wv":1603},{"all":true,"optional":true,"k":1604},{"c":1605}],[],{}],[1,"sankei-digital",0,"",10,[1606],[{"e":1607}],[{"v":1607}],[{"c":1607}],[{"cc":1608}],{}],[1,"sas",2,"",22,[1609],[{"e":1610}],[{"v":1611}],[{"c":1610}],[{"cc":458}],{}],[1,"savills",2,"",22,[1612],[{"e":1612}],[{"v":1613}],[{"c":1614},{"wv":1615},{"if":{"e":1616},"then":[{"k":1617}]},{"if":{"e":1618},"then":[{"k":1619}]},{"k":1620}],[{"cc":1621}],{}],[1,"sc-cookie-banner",2,"",22,[1622],[{"e":1623}],[{"v":1624}],[{"c":1623}],[{"cc":1625}],{}],[1,"scottish-government-design-system",2,"",22,[1626],[{"e":1627}],[{"v":1627}],[{"c":1627}],[{"cc":1628}],{}],[1,"securiti-gpc-flyout",2,"",22,[1629],[{"e":1630}],[{"v":1629},{"negated":true,"e":1631}],[{"retry":2,"c":1632}],[{"check":"none","v":1633}],{}],[1,"sedlak-gdpr-cookie",2,"",22,[1634],[{"e":1635}],[{"v":1635}],[{"c":1635}],[{"cc":1636}],{}],[1,"setupad",2,"",22,[1637],[{"e":1638}],[{"v":1638}],[{"if":{"e":1639},"then":[{"c":1639}],"else":[{"c":1640},{"wv":1641},{"all":true,"optional":true,"k":1642},{"c":1639}]},{"check":"none","wv":1637}],[{"cc":1643}],{}],[1,"shopify",0,"",22,[1644],[{"e":1644}],[{"v":1644}],[{"c":1645}],[{"eval":"EVAL_SHOPIFY_TEST"}],{}],[1,"shopware",2,"",22,[1646],[{"e":1647}],[{"v":1646}],[{"if":{"e":1648},"then":[{"c":1649}],"else":[{"c":1650},{"c":1651}]}],[{"timeout":2000,"check":"none","wv":1646},{"wait":500},{"cc":1652}],{}],[1,"shouldianswer",1,"",10,[1653],[{"e":1653}],[{"v":1654}],[{"h":1653}],[],{}],[1,"shueisha-gigaviewer",2,"",22,[1655],[{"e":1656}],[{"v":1657}],[{"c":1658}],[{"timeout":1000,"check":"none","wv":1655}],{}],[1,"sibbo",2,"",22,[1659],[{"e":1659}],[{"v":1660}],[{"k":1660}],[],{}],[1,"silktide",2,"",22,[1661,1662],[{"e":1661}],[{"v":1661}],[{"if":{"e":1663},"then":[{"k":1663}],"else":[{"k":1664},{"c":1665}]}],[{"check":"none","timeout":2000,"wv":1661}],{}],[1,"simpleview-cookie-banner",1,"",22,[1666,1667],[{"e":1668}],[{"check":"any","v":1669}],[{"h":1670}],[],{}],[1,"Sirdata",0,"",22,[1671],[{"e":1671}],[{"check":"any","v":1672}],[{"if":{"exists":["#sd-cmp","xpath///button[contains(., 'Do not accept') or contains(., 'Acceptera inte') or contains(., 'No aceptar') or contains(., 'Ikke acceptere') or contains(., 'Nicht akzeptieren') or contains(., 'Не приемам') or contains(., 'Να μην γίνει αποδοχή') or contains(., 'Niet accepteren') or contains(., 'Nepřijímat') or contains(., 'Nie akceptuj') or contains(., 'Nu acceptați') or contains(., 'Não aceitar') or contains(., 'Continuer sans accepter') or contains(., 'Non accettare') or contains(., 'Nem fogad el')]"]},"then":[{"waitForThenClick":["#sd-cmp","xpath///button[contains(., 'Do not accept') or contains(., 'Acceptera inte') or contains(., 'No aceptar') or contains(., 'Ikke acceptere') or contains(., 'Nicht akzeptieren') or contains(., 'Не приемам') or contains(., 'Να μην γίνει αποδοχή') or contains(., 'Niet accepteren') or contains(., 'Nepřijímat') or contains(., 'Nie akceptuj') or contains(., 'Nu acceptați') or contains(., 'Não aceitar') or contains(., 'Continuer sans accepter') or contains(., 'Non accettare') or contains(., 'Nem fogad el')]"]}],"else":[{"if":{"exists":["#sd-cmp","xpath///span[contains(., 'Задайте вашите избори') or contains(., 'Nastavit vaše volby') or contains(., 'Angiv dine valg') or contains(., 'Ihre Auswahl treffen') or contains(., 'Ορίστε τις επιλογές σας') or contains(., 'Set your choices') or contains(., 'Establecer preferencias') or contains(., 'Paramétrer vos choix') or contains(., 'Válassza ki a beállításokat') or contains(., 'Imposta le tue scelte') or contains(., 'Stel uw keuzes in') or contains(., 'Ustaw swoje wybory') or contains(., 'Definir suas escolhas') or contains(., 'Setați-vă opțiunile') or contains(., 'Ställ in dina val')]"]},"then":[{"waitForThenClick":["#sd-cmp","xpath///span[contains(., 'Задайте вашите избори') or contains(., 'Nastavit vaše volby') or contains(., 'Angiv dine valg') or contains(., 'Ihre Auswahl treffen') or contains(., 'Ορίστε τις επιλογές σας') or contains(., 'Set your choices') or contains(., 'Establecer preferencias') or contains(., 'Paramétrer vos choix') or contains(., 'Válassza ki a beállításokat') or contains(., 'Imposta le tue scelte') or contains(., 'Stel uw keuzes in') or contains(., 'Ustaw swoje wybory') or contains(., 'Definir suas escolhas') or contains(., 'Setați-vă opțiunile') or contains(., 'Ställ in dina val')]"]},{"waitForThenClick":["#sd-cmp","xpath///span[contains(., 'Отхвърлям всичко') or contains(., 'Odmítnout vše') or contains(., 'Afvis alt') or contains(., 'Alle ablehnen') or contains(., 'Απόρριψη όλων') or contains(., 'Reject all') or contains(., 'Rechazar todo') or contains(., 'Tout refuser') or contains(., 'Mind elutasítása') or contains(., 'Rifiuta tutto') or contains(., 'Alles weigeren') or contains(., 'Odrzuć wszystkie') or contains(., 'Rejeitar todos') or contains(., 'Respingeți toate') or contains(., 'Avvisa allt')]"]}],"else":[{"check":"any","wv":1673},{"k":1673}]}]}],[],{}],[1,"site-notifications-cookie-usage",1,"",22,[1674],[{"e":1674}],[{"v":1674}],[{"h":1674}],[],{}],[1,"sitepark-sitekit",2,"",22,[1675],[{"e":1675}],[{"v":1675}],[{"if":{"e":1676},"then":[{"timeout":5000,"optional":true,"w":1677},{"retry":5,"retryInterval":500,"c":1678}],"else":[{"h":1675}]}],[],{}],[1,"sitevision",2,"",22,[1679],[{"e":1679}],[{"v":1679}],[{"if":{"e":1680},"then":[{"k":1680}],"else":[{"k":1681},{"wv":1682},{"all":true,"optional":true,"k":1683},{"k":1682}]}],[{"check":"none","timeout":2000,"wv":1679}],{}],[1,"sitevision-cookie-consent",2,"",22,[1684],[{"e":1684}],[{"v":1684}],[{"if":{"e":1685},"then":[{"k":1685}],"else":[{"k":1686},{"wv":1687},{"all":true,"optional":true,"k":1688},{"k":1687}]}],[],{}],[1,"sitevision-iw-cookie",2,"",22,[1689],[{"e":1689}],[{"v":1689}],[{"if":{"e":1690},"then":[{"k":1691}],"else":[{"k":1692},{"wv":1693},{"all":true,"optional":true,"k":1694},{"k":1695}]}],[],{}],[1,"smartweb",0,"",10,[1696],[{"e":1697}],[{"v":1698}],[{"all":true,"optional":true,"k":1699},{"c":1697}],[{"cc":1700}],{}],[1,"snigel",2,"",22,[],[{"e":1701}],[{"v":1701}],[{"k":1702},{"k":1703}],[{"cc":1704}],{}],[1,"socialfunders",2,"",22,[1705],[{"e":1706},{"e":1707}],[{"v":1705}],[{"c":1706}],[],{}],[1,"sogei-cookiebar",0,"",22,[1708],[{"e":1709}],[{"v":1709}],[{"c":1710}],[{"cc":1711}],{}],[1,"somerset-council",0,"",10,[],[{"e":1712}],[{"v":1713}],[{"c":1713}],[{"cc":1714}],{}],[1,"soteshop",2,"",22,[1715,1716],[{"e":1717}],[{"check":"any","v":1717}],[{"if":{"e":1718},"then":[{"c":1718}],"else":[{"k":1719}]},{"check":"none","wv":1717}],[{"if":{"e":1718},"then":[{"cc":1720},{"cc":1721}],"else":[{"cc":1722}]}],{}],[3,"sourcepoint-top",2,"",10,[1723],[{"e":1723}],[{"v":1723}],[{"stylesheet":"body > div[id^='sp_message_container_'] { visibility: hidden !important; z-index: -1 !important; pointer-events: none !important; }","stylesheetId":"sourcepoint-top-hide"},{"stylesheet":"html.sp-message-open { height: auto !important; width: auto !important; } html.sp-message-open body { position: relative !important; overflow: auto !important; margin-top: 0 !important; top: auto !important; left: auto !important; right: auto !important; }","stylesheetId":"sourcepoint-top-scroll-unlock"},{"removeClass":"sp-message-open","selector":"html","optional":true},{"eval":"EVAL_SOURCEPOINT_RESTORE_SCROLL","optional":true}],[],{}],[1,"spaggiari-pvw",0,"",10,[1724],[{"e":1725}],[{"v":1725}],[{"c":1725}],[],{}],[1,"sparebank1-optin",2,"",22,[1726],[{"e":1727}],[{"v":1726}],[{"c":1728}],[{"check":"none","timeout":2000,"wv":1726}],{}],[1,"squarespace-cookie-banner",2,"",22,[1729],[{"e":1730}],[{"v":1731}],[{"if":{"e":1732},"then":[{"c":1732}],"else":[{"c":1733},{"wv":1734},{"all":true,"optional":true,"k":1735},{"c":1736}]}],[{"timeout":1000,"check":"none","wv":1731}],{}],[1,"squarespace-cookie-notice",1,"",22,[1729],[{"e":1737},{"negated":true,"e":1730}],[{"v":1731}],[{"h":1729}],[],{}],[1,"squiz",0,"",10,[233],[{"e":1738}],[{"v":1738}],[{"c":1739}],[{"wait":500},{"cc":1740}],{}],[1,"steampowered.com",2,"",22,[],[{"e":1741},{"v":1741}],[{"v":1741}],[{"k":1742}],[{"wait":1000},{"eval":"EVAL_STEAMPOWERED_0"}],{}],[1,"stellantis-psa",2,"",22,[1743,1744],[{"e":1745}],[{"v":1745}],[{"if":{"e":1746},"then":[{"c":1746}],"else":[{"c":1747}]},{"check":"none","timeout":3000,"wv":1743}],[{"cc":1748},{"cc":1749}],{}],[1,"stepstone-ccm",2,"",22,[1750],[{"e":1751}],[{"v":1752}],[{"c":1753},{"timeout":2000,"optional":true,"c":1754}],[{"cc":1755}],{}],[1,"stockholm-stad",2,"",22,[1756],[{"e":1757}],[{"v":1756}],[{"c":1758},{"timeout":2000,"wv":1759},{"all":true,"optional":true,"k":1760},{"k":1761}],[{"cc":1762}],{}],[1,"stright",2,"",22,[1763,1764],[{"e":1763}],[{"v":1763}],[{"if":{"v":1765},"then":[{"c":1765}],"else":[{"c":1766},{"wv":1764},{"if":{"e":1767},"then":[{"c":1767}],"else":[{"all":true,"optional":true,"k":1768},{"c":1769}]}]},{"check":"none","wv":1763}],[{"check":"none","v":1763}],{}],[1,"stripchat.com",0,"",22,[1770],[{"v":1771}],[{"v":1770}],[{"timeout":5000,"optional":true,"w":1772},{"c":1771},{"timeout":1500,"optional":true,"wv":1773},{"if":{"check":"none","v":1773},"then":[{"k":1771}]},{"c":1774}],[{"wait":500},{"cc":1775}],{}],[1,"substack",0,"",12,[],[{"e":1776}],[{"v":1776}],[{"waitForThenClick":[".pencraft","xpath///button[contains(., 'Only Necessary') or contains(., 'Reject')]"]}],[{"cc":1777}],{}],[1,"summitracing",1,"",10,[1778],[{"e":1779}],[{"v":1779}],[{"h":1778}],[],{}],[1,"swisscom-ecare",2,"",22,[1780],[{"e":1781}],[{"v":1782}],[{"if":{"v":1783},"then":[{"retry":3,"retryInterval":500,"c":1783}],"else":[{"k":1784},{"wv":1785},{"all":true,"optional":true,"k":1786},{"retry":3,"retryInterval":500,"c":1787}]},{"check":"none","wv":1782}],[{"cc":1788}],{}],[1,"synology",0,"",22,[1789],[{"e":1789}],[{"v":1789}],[{"c":1790},{"wv":1791},{"all":true,"optional":true,"k":1792},{"c":1793}],[{"cc":1794},{"cc":1795}],{}],[1,"tagconcierge",2,"",22,[1796],[{"e":1796}],[{"v":1797}],[{"if":{"v":1798},"then":[{"k":1798}],"else":[{"c":1799},{"wv":1800},{"if":{"e":1801},"then":[{"k":1801}],"else":[{"all":true,"optional":true,"k":1802},{"c":1803}]}]}],[{"any":[{"check":"none","v":1796},{"check":"none","v":1804}]}],{}],[1,"takealot.com",1,"",22,[1805],[{"e":1806}],[{"e":1806}],[{"h":1805},{"if":{"e":1807},"then":[{"eval":"EVAL_TAKEALOT_0"}],"else":[]}],[],{}],[1,"tarteaucitron deny",2,"",22,[1808],[{"e":1808}],[{"v":1809}],[{"wait":500},{"k":1809}],[{"eval":"EVAL_TARTEAUCITRON_2"}],{}],[1,"tarteaucitron.js",2,"",22,[1808],[{"e":1808}],[{"v":1810},{"negated":true,"e":1809}],[{"if":{"e":1811},"then":[{"all":true,"optional":true,"k":1812},{"k":1810}],"else":[{"k":1813},{"c":1814},{"k":1815}]}],[{"eval":"EVAL_TARTEAUCITRON_2"}],{}],[1,"taunton",2,"",22,[1816],[{"e":1816}],[{"e":1817}],[{"optional":true,"all":true,"k":1818},{"k":1819}],[{"cc":1820}],{}],[1,"tccCmpAlert",2,"",22,[1821],[{"e":1821}],[{"v":1821}],[{"c":1822}],[],{}],[1,"Tealium",2,"",22,[1823],[{"e":1824},{"eval":"EVAL_TEALIUM_0"}],[{"check":"any","v":1824}],[{"eval":"EVAL_TEALIUM_1"},{"eval":"EVAL_TEALIUM_DONOTSELL"},{"if":{"e":1825},"then":[{"c":1825}],"else":[{"h":1826},{"timeout":1000,"optional":true,"c":1827}]}],[{"eval":"EVAL_TEALIUM_3"},{"eval":"EVAL_TEALIUM_DONOTSELL_CHECK"},{"check":"none","v":1828}],{}],[1,"tempest-cookie-notice",1,"",22,[1829],[{"e":1830}],[{"v":1829}],[{"h":1829}],[],{}],[1,"Termly",2,"",22,[1831],[{"e":1831}],[{"v":1832}],[{"if":{"e":1833},"then":[{"k":1833}],"else":[{"c":1834},{"timeout":700,"w":1835},{"if":{"e":1835},"then":[{"k":1835}],"else":[{"all":true,"c":1836},{"c":1837}]}]}],[],{}],[1,"termsfeed",2,"",22,[1838,1839],[{"e":1840}],[{"v":1840}],[{"if":{"e":1841},"then":[{"c":1841}],"else":[{"c":1842},{"w":1843},{"all":true,"optional":true,"k":1844},{"k":1845}]}],[],{}],[1,"termsfeed3",2,"",22,[1846],[{"e":1847}],[{"v":1847}],[{"if":{"e":1848},"then":[{"k":1848},{"wv":1849},{"c":1849}],"else":[{"h":1846}]}],[],{}],[1,"Test page CMP",2,"",22,[1850],[{"e":1851}],[{"v":1851}],[{"w":1850},{"eval":"EVAL_TESTCMP_STEP"},{"k":1850}],[{"eval":"EVAL_TESTCMP_0"}],{}],[1,"Test page cosmetic CMP",1,"",22,[1852],[{"e":1853}],[{"v":1853}],[{"h":1853}],[{"wait":500},{"eval":"EVAL_TESTCMP_COSMETIC_0"}],{}],[1,"texas-instruments",2,"",22,[1854],[{"e":1855}],[{"v":1856}],[{"k":1857},{"wv":1858},{"if":{"e":1859},"then":[{"all":true,"k":1859}]},{"c":1860}],[{"cc":1861}],{}],[1,"thalia.de",2,"",22,[1862],[{"e":1863}],[{"v":1862}],[{"k":1864}],[],{}],[1,"thefreedictionary.com",2,"",22,[1865],[{"e":1865}],[{"v":1865}],[{"eval":"EVAL_THEFREEDICTIONARY_0"}],[],{}],[1,"tna-cookie-banner",2,"",22,[1866],[{"e":1867}],[{"v":1868}],[{"c":1868},{"timeout":1000,"optional":true,"c":1869}],[{"cc":1870},{"cc":1871}],{}],[1,"toyota",0,"",10,[1872],[{"e":1873}],[{"v":1874}],[{"timeout":5000,"w":1875},{"c":1876},{"wv":1877},{"if":{"e":1878},"then":[{"timeout":2000,"optional":true,"w":1879}]},{"all":true,"optional":true,"k":1880},{"c":1877}],[{"cc":1881}],{}],[1,"tplink",0,"",22,[1882,1883],[{"e":1884}],[{"any":[{"v":1885},{"v":1886},{"v":1887}]}],[{"if":{"v":1886},"then":[{"k":1886}]},{"if":{"v":1888},"then":[{"k":1888}]},{"if":{"e":1889},"then":[{"wv":1890},{"c":1891}],"else":[{"wv":1892},{"if":{"e":1893},"then":[{"c":1893}],"else":[{"all":true,"optional":true,"k":1894},{"c":1895}]}]}],[{"cc":1896},{"negated":true,"cc":1897}],{}],[1,"tracsis-delay-repay",0,"",22,[1898],[{"e":1899}],[{"v":1899}],[{"retry":2,"c":1900}],[{"cc":1901}],{}],[1,"trader-joes-com",1,"",22,[1902],[{"e":1902}],[{"v":1902}],[{"h":1902}],[],{}],[2,"transcend",1,"",22,[1903],[{"e":1903}],[{"v":1903}],[{"setStyle":"display: none !important; z-index: -1 !important; pointer-events: none !important;","selector":"#transcend-consent-manager"}],[],{}],[1,"tri-table",2,"",22,[],[{"e":1904}],[{"v":1904}],[{"retry":2,"retryInterval":500,"c":1905},{"if":{"e":1906},"then":[{"k":1906}],"else":[{"optional":true,"k":1905}]},{"check":"none","wv":1904}],[{"any":[{"cc":1907},{"cc":1908}]}],{}],[1,"trillian",2,"",22,[1909],[{"e":1910}],[{"v":1909}],[{"c":1910}],[{"cc":1911}],{}],[1,"tropicfeel-com",2,"",22,[1912],[{"e":1912}],[{"check":"any","v":1913}],[{"k":1914},{"w":1915},{"all":true,"k":1916},{"k":1917}],[],{}],[1,"truendo",2,"",22,[1918],[{"e":1918}],[{"v":1918}],[{"if":{"e":1919},"then":[{"k":1920}],"else":[{"k":1921}]},{"timeout":2000,"optional":true,"wv":1922},{"if":{"v":1922},"then":[{"k":1922}]}],[{"cc":458}],{}],[1,"truevault-polaris",0,"",22,[],[{"exists":["#polaris-css-lockdown-container","#polaris-consent-widgets .polaris-consent-widget"]}],[{"visible":["#polaris-css-lockdown-container","#polaris-consent-widgets .polaris-consent-widget"]}],[{"if":{"exists":["#polaris-css-lockdown-container",".polaris-consent-widget__actions button:nth-child(2):not(:last-child)"]},"then":[{"click":["#polaris-css-lockdown-container",".polaris-consent-widget__actions button:nth-child(2):not(:last-child)"]}],"else":[{"click":["#polaris-css-lockdown-container",".polaris-consent-widget__actions button:first-child"]},{"waitFor":["#polaris-css-lockdown-container",".polaris-preferences-widget__save_button"],"timeout":2000},{"click":["#polaris-css-lockdown-container",".polaris-preferences-widget input[type=checkbox]:checked:not([disabled])"],"all":true,"optional":true},{"click":["#polaris-css-lockdown-container",".polaris-preferences-widget input[type=checkbox]:checked:not([disabled])"],"all":true,"optional":true},{"click":["#polaris-css-lockdown-container",".polaris-preferences-widget__save_button"]}]}],[{"waitForVisible":["#polaris-css-lockdown-container","#polaris-consent-widgets .polaris-consent-widget"],"check":"none","timeout":2000},{"cc":1923}],{}],[1,"trust360",2,"",22,[1924],[{"e":1924}],[{"v":1924}],[{"c":1925}],[{"cc":1926}],{}],[1,"TrustArc-newcm",2,"",22,[1927],[{"exists":[".truste_popframe.trustarc_newcm_container","a.required, a.call, button.required, button.call"]}],[{"visible":[".truste_popframe.trustarc_newcm_container","a.required, a.call, button.required, button.call"],"check":"any"}],[{"waitForThenClick":[".truste_popframe.trustarc_newcm_container","a.required, button.required"]}],[{"cc":1928},{"negated":true,"cc":1929}],{}],[1,"truyo",2,"",22,[1930],[{"e":1931}],[{"v":1930}],[{"k":1932}],[],{}],[1,"trybe",0,"",22,[1933],[{"e":1933}],[{"v":1934}],[{"c":1935},{"w":1936},{"optional":true,"k":1937},{"optional":true,"k":1938},{"c":1939}],[{"wait":500},{"cc":1940}],{}],[1,"tti-cookie-popup",2,"",22,[],[{"e":1941}],[{"v":1941}],[{"if":{"v":1942},"then":[{"k":1942}],"else":[{"k":1941},{"timeout":10000,"wv":1943},{"if":{"v":1944},"then":[{"k":1944}],"else":[{"all":true,"optional":true,"k":1945},{"c":1946}]}]},{"timeout":10000,"check":"none","wv":1941}],[{"cc":1947}],{}],[1,"tumblr-custom-domain-gdpr-banner",1,"",22,[1948],[{"e":1948}],[{"v":1948}],[{"h":1948}],[{"check":"none","v":1948}],{}],[1,"tv2reg-cookie-notice",2,"",22,[1949],[{"e":1950},{"e":1951}],[{"check":"any","v":1951}],[{"c":1951},{"check":"none","timeout":2000,"optional":true,"wv":1951}],[{"cc":1952}],{}],[1,"twcc",0,"",10,[1953],[{"e":1954}],[{"v":1954}],[{"c":1955}],[{"cc":1956}],{}],[1,"txxx-network",0,"",22,[],[{"e":1957}],[{"v":1957}],[{"c":1957}],[{"check":"none","v":1957}],{}],[1,"tyreseeker",0,"",22,[],[{"e":1958}],[{"v":1959}],[{"c":1960},{"wv":1961},{"wait":500},{"all":true,"optional":true,"k":1962},{"k":1961},{"check":"none","wv":1963}],[],{}],[1,"u-cookie-consent",2,"",22,[1964],[{"e":1965}],[{"v":1965}],[{"c":1965}],[{"check":"none","timeout":2000,"wv":1965}],{}],[1,"u12-data-protection-notice",2,"",22,[1966],[{"e":1966}],[{"v":1967}],[{"c":1968}],[],{}],[1,"ubuntu.com",2,"",22,[1969],[{"any":[{"e":1970},{"e":1971}]}],[{"any":[{"v":1972},{"v":1971}]}],[{"any":[{"c":1973},{"c":1974}]},{"optional":true,"all":true,"timeout":500,"c":1975},{"any":[{"c":1976},{"c":1977}]}],[{"cc":1978}],{}],[1,"uft-cookie-notice",2,"",22,[1979],[{"e":1980}],[{"v":1979}],[{"k":1980},{"c":1981},{"check":"none","wv":1979}],[{"wait":1000},{"cc":1982}],{"intermediate":false}],[1,"UK Cookie Consent",1,"",22,[1983],[{"e":1983}],[{"e":1984}],[{"h":1983}],[{"negated":true,"cc":1985}],{}],[1,"uk-parliament",2,"",22,[1986,1987],[{"e":1988}],[{"v":1989}],[{"c":1988},{"optional":true,"h":1987}],[{"cc":1990}],{}],[1,"umcg",2,"",22,[1991],[{"e":1992}],[{"v":1993}],[{"all":true,"optional":true,"k":1994},{"c":1995}],[],{}],[1,"unicity",2,"",22,[1996],[{"e":1997}],[{"v":1998}],[{"if":{"e":1999},"then":[{"k":1999}],"else":[{"k":2000},{"wv":2001},{"all":true,"optional":true,"k":2002},{"k":2003}]},{"check":"none","timeout":2000,"optional":true,"wv":1996}],[{"cc":2004}],{}],[1,"united-online",2,"",22,[2005,2006],[{"e":2007}],[{"any":[{"check":"any","v":2008},{"e":2009}]}],[{"if":{"check":"any","v":2010},"then":[{"c":2011}]},{"if":{"v":2012},"then":[{"h":2012}]},{"if":{"e":2009},"then":[{"k":2013}]}],[{"cc":2014}],{}],[1,"up-cookie-consent",2,"",22,[2015],[{"e":2015}],[{"v":2015}],[{"if":{"e":2016},"then":[{"c":2016}],"else":[{"c":2017},{"c":2018}]},{"check":"none","timeout":10000,"wv":2019}],[{"cc":2020},{"cc":2021}],{}],[1,"usercentrics-api",2,"",22,[],[{"e":2022}],[{"eval":"EVAL_USERCENTRICS_API_0"},{"if":{"e":2023},"then":[{"timeout":2000,"wv":2023}],"else":[{"exists":["#usercentrics-root","[data-testid=uc-container]"]},{"timeout":2000,"wv":2024}]}],[{"if":{"exists":["#usercentrics-root","[data-testid=uc-deny-all-button]"]},"then":[{"click":["#usercentrics-root","[data-testid=uc-deny-all-button]"]}],"else":[{"if":{"exists":["#usercentrics-cmp-ui","[data-action-type=deny]"]},"then":[{"click":["#usercentrics-cmp-ui","[data-action-type=deny]"]}],"else":[{"eval":"EVAL_USERCENTRICS_API_1"},{"eval":"EVAL_USERCENTRICS_API_2"}]}]},{"removeClass":"overflowHidden","selector":"body","optional":true}],[{"eval":"EVAL_USERCENTRICS_API_6"}],{}],[1,"usercentrics-button",2,"",22,[],[{"e":2025}],[{"v":2026}],[{"k":2027}],[{"eval":"EVAL_USERCENTRICS_BUTTON_0"}],{}],[1,"uw-madison-cookieconsent",1,"",22,[2028],[{"e":2029}],[{"v":2028}],[{"h":2030}],[],{}],[1,"vdg-cookies",2,"",22,[2031],[{"e":2031}],[{"v":2031}],[{"c":2032},{"c":2033},{"check":"none","wv":2031}],[{"cc":2034}],{}],[1,"vergelijkgroep",0,"",10,[2035],[{"e":2036}],[{"v":2037}],[{"c":2038}],[{"cc":2039}],{}],[1,"vivenu",2,"",22,[],[{"e":2040}],[{"v":2040}],[{"c":2041}],[{"check":"none","v":2040}],{}],[1,"vortex-consent",2,"",22,[2042,2043],[{"e":2044}],[{"v":2044}],[{"c":2044}],[{"cc":2045},{"negated":true,"cc":2046}],{}],[1,"vue-cookie-accept-decline",0,"",10,[2047,2048],[{"e":2049}],[{"v":2050}],[{"if":{"e":2051},"then":[{"c":2051}],"else":[{"h":2050}]}],[],{}],[1,"waitrose.com",2,"",22,[2052,2053,2054],[{"e":2053}],[{"v":2053}],[{"k":2055},{"wait":200},{"eval":"EVAL_WAITROSE_0"},{"k":2056}],[{"cc":2057},{"cc":2058}],{}],[1,"warning-cookie-notice",1,"",22,[2059],[{"e":2060}],[{"v":2059}],[{"h":2059}],[],{}],[1,"watchfinder",0,"",22,[2061],[{"e":2062},{"e":2063}],[{"v":2062}],[{"c":2062},{"wv":2063},{"all":true,"optional":true,"k":2064},{"c":2065}],[{"cc":2066},{"cc":2067}],{}],[2,"wbd-legal-terms",1,"",22,[],[{"e":2068}],[{"check":"any","v":2069}],[{"if":{"e":2070},"then":[{"eval":"EVAL_WBD_LTP_CLOSE"},{"removeClass":"is-NoScroll","selector":"body","optional":true}],"else":[{"h":2071},{"addStyle":"overflow: auto !important","selector":"body","optional":true}]}],[],{}],[1,"webflow",2,"",22,[2072],[{"any":[{"v":2072},{"e":2073}]}],[{"v":2072},{"v":2074}],[{"if":{"e":2075},"then":[{"wait":500},{"c":2075}],"else":[{"h":2076}]}],[{"cc":2077}],{}],[1,"webtoffee-cookie-consent",2,"",22,[2078],[{"e":2079}],[{"v":2079}],[{"if":{"e":2080},"then":[{"c":2080}],"else":[{"if":{"e":2081},"then":[{"c":2081},{"wv":2082},{"optional":true,"k":2083},{"c":2084}],"else":[{"c":2085},{"wv":2086},{"all":true,"optional":true,"k":2087},{"c":2086}]}]}],[{"cc":2088}],{}],[1,"whitepages-gpc-banner",2,"",22,[2089],[{"e":2090}],[{"v":2089}],[{"c":2090}],[{"check":"none","v":2089}],{}],[1,"wiki.gg",1,"",22,[2091],[{"e":2091}],[{"v":2091}],[{"h":2091}],[],{}],[1,"wimc-gtm-consent",2,"",22,[2092],[{"e":2092}],[{"v":2093}],[{"if":{"e":2094},"then":[{"c":2094}],"else":[{"c":2095},{"timeout":2000,"wv":2096},{"all":true,"optional":true,"k":2097},{"c":2098}]},{"check":"none","timeout":2000,"wv":2093}],[{"cc":2099},{"cc":2100}],{}],[1,"wirtualna-polska",2,"",22,[2101],[{"exists":["div[role=dialog][aria-modal=true][aria-label*='WP']","xpath/.//button[normalize-space(.)='Ustawienia zaawansowane' or normalize-space(.)='Advanced settings' or normalize-space(.)='Erweiterte einstellungen' or normalize-space(.)='Pokročilá nastavení' or normalize-space(.)='Rozšírené nastavenia' or normalize-space(.)='Išplėstiniai nustatymai']"]}],[{"v":2101}],[{"waitForThenClick":["div[role=dialog][aria-modal=true][aria-label*='WP']","xpath/.//button[normalize-space(.)='Ustawienia zaawansowane' or normalize-space(.)='Advanced settings' or normalize-space(.)='Erweiterte einstellungen' or normalize-space(.)='Pokročilá nastavení' or normalize-space(.)='Rozšírené nastavenia' or normalize-space(.)='Išplėstiniai nustatymai']"]},{"waitForThenClick":["div[role=dialog][aria-modal=true][aria-label*='WP']","xpath/.//button[normalize-space(.)='Zapisz' or normalize-space(.)='Save' or normalize-space(.)='Speichern' or normalize-space(.)='Uložit' or normalize-space(.)='Uložiť' or normalize-space(.)='Išsaugoti']"]},{"check":"none","timeout":5000,"optional":true,"wv":2101}],[],{}],[1,"wix",0,"",22,[],[{"e":2102}],[{"v":2102}],[{"if":{"e":2103},"then":[{"wait":1000},{"if":{"e":2104},"then":[{"k":2104}],"else":[{"k":2105},{"wv":2106},{"all":true,"optional":true,"k":2107},{"k":2106}]},{"any":[{"check":"none","timeout":2000,"wv":2103},{"h":2103}]}],"else":[{"if":{"e":2108},"then":[{"k":2108}],"else":[{"h":2109}]}]}],[],{}],[1,"woo-commerce-com",2,"",22,[2110],[{"e":2110}],[{"v":2110}],[{"if":{"e":2111},"then":[{"c":2112}],"else":[{"c":2113},{"wv":2114},{"all":true,"optional":true,"k":2115},{"c":2116}]}],[{"cc":2117}],{}],[1,"workday",2,"",22,[2118],[{"e":2119}],[{"v":2118}],[{"c":2119}],[{"cc":2120}],{}],[1,"worldbank",2,"",22,[2121],[{"e":2121}],[{"v":2121}],[{"c":2122}],[{"cc":2123}],{}],[1,"WP Cookie Notice for GDPR",2,"",22,[2124],[{"v":2124}],[{"v":2124}],[{"c":2125}],[{"cc":2126}],{}],[1,"WP DSGVO Tools",2,"",22,[2127],[{"e":2128}],[{"check":"any","v":2128}],[{"if":{"e":2129},"then":[{"c":2129}],"else":[{"c":2130}]}],[{"cc":2131}],{}],[1,"wpcc",1,"",22,[2132],[{"e":2132}],[{"e":2133}],[{"h":2132}],[],{}],[1,"WPConsent",2,"",22,[2134],[{"e":2135}],[{"visible":["#wpconsent-container","#wpconsent-banner-holder.wpconsent-banner-visible"]}],[{"waitForThenClick":["#wpconsent-container","#wpconsent-cancel-all"]}],[{"cc":2136}],{}],[1,"xenforo-cookie-consent",2,"",22,[2137],[{"e":2138}],[{"v":2139}],[{"if":{"e":2140},"then":[{"k":2140}],"else":[{"timeout":2000,"retry":10,"retryInterval":500,"c":2141},{"timeout":2000,"wv":2142},{"all":true,"optional":true,"k":2143},{"k":2142}]}],[{"timeout":2000,"check":"none","wv":2137},{"cc":2144}],{}],[1,"xgroovy",1,"",22,[2145],[{"e":2146}],[{"v":2146}],[{"h":2145}],[],{}],[1,"xing.com",2,"",22,[],[{"e":2147}],[{"e":2147}],[{"k":2148},{"k":2149}],[{"cc":2150}],{}],[1,"xnxx-com",1,"",22,[2151],[{"any":[{"e":2151},{"e":2152}]}],[{"any":[{"v":2151},{"v":2153}]}],[{"if":{"v":2153},"then":[{"c":2154}],"else":[{"h":2151}]}],[],{}],[1,"yle-consent-sdk",2,"",22,[2155],[{"e":2156}],[{"v":2155}],[{"c":2156},{"timeout":2000,"check":"none","wv":2155}],[],{}],[1,"youtube-desktop",2,"",22,[2157,2158],[{"e":2159},{"e":2160}],[{"v":2159}],[{"c":2161},{"wait":500}],[{"wait":500},{"cc":957}],{}],[1,"youtube-mobile",2,"",22,[2162],[{"e":2163}],[{"v":2163}],[{"wait":500},{"c":2164},{"wait":500}],[{"wait":500},{"cc":957}],{}],[1,"zdf",2,"",22,[2165],[{"e":2165}],[{"v":2166}],[{"c":2167}],[],{}],[1,"zorginstituut-cookiewarning",0,"",22,[2168],[{"e":2169}],[{"v":2169}],[{"c":2169}],[{"check":"none","timeout":2000,"wv":2170}],{}],[1,"zurich-cookies-notification-banner",0,"",10,[2171],[{"e":2172}],[{"v":2173}],[{"c":2172}],[{"cc":2174}],{}],[1,"cookiealert",2,"",11,[],[{"e":2175}],[{"v":2176}],[{"k":2177},{"all":true,"optional":true,"k":2178},{"k":2179},{"eval":"EVAL_COOKIEALERT_0"}],[{"eval":"EVAL_COOKIEALERT_2"}],{"intermediate":false}],[1,"piano.io",2,"",1,[],[{"e":2180}],[{"v":2180}],[{"c":2181}],[],{}],[1,"auto_AU_help.dropbox.com_4ad_+1",0,"^https?://(www\\.)?dropbox\\.com/|^https?://(www\\.)?dropbox\\.com/",1,[],[{"e":2182}],[{"v":2182}],[{"wait":500},{"c":2182}],[{"timeout":1000,"check":"none","wv":2182}],{}],[1,"auto_CA_coasthotels.com_f8m",0,"^https?://(www\\.)?coasthotels\\.com/",1,[],[{"e":2183}],[{"v":2183}],[{"c":2183}],[],{}],[1,"auto_CA_epihunter.eu_hd4",0,"^https?://(www\\.)?combell\\.com/",1,[],[{"e":2184}],[{"v":2184}],[{"wait":500},{"c":2184}],[{"timeout":1000,"check":"none","wv":2184}],{}],[1,"auto_CA_nationalarchives.gov.uk_rx0",0,"^https?://(www\\.)?webarchive\\.nationalarchives\\.gov\\.uk/",1,[],[{"e":2185}],[{"v":2185}],[{"wait":500},{"c":2185}],[{"timeout":1000,"check":"none","wv":2185}],{}],[1,"auto_CA_natureconservancy.ca_3pp",0,"^https?://(www\\.)?natureconservancy\\.ca/",1,[],[{"e":2186}],[{"v":2186}],[{"wait":500},{"c":2186}],[{"timeout":1000,"check":"none","wv":2186}],{}],[1,"auto_CA_ontariospca.ca_k32",0,"^https?://(www\\.)?widget-next\\.clym-sdk\\.net/",1,[],[{"e":2187}],[{"v":2187}],[{"wait":500},{"c":2187}],[{"timeout":1000,"check":"none","wv":2187}],{}],[1,"auto_CA_phoenixnap.com_hrb",0,"^https?://(www\\.)?widget-next\\.clym-sdk\\.net/",1,[],[{"e":2188}],[{"v":2188}],[{"wait":500},{"c":2188}],[{"timeout":1000,"check":"none","wv":2188}],{}],[1,"auto_CH_phoenixnap.com_lx5",0,"^https?://(www\\.)?widget-next\\.clym-sdk\\.net/",1,[],[{"e":2189}],[{"v":2189}],[{"wait":500},{"c":2189}],[{"timeout":1000,"check":"none","wv":2189}],{}],[1,"auto_CH_swisscare.com_arx",0,"^https?://(www\\.)?swisscare\\.com/",1,[],[{"e":2190}],[{"v":2190}],[{"wait":500},{"c":2190}],[{"timeout":1000,"check":"none","wv":2190}],{}],[1,"auto_DE_alfaromeo.de_gvg_+2",0,"^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/|^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/|^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/",1,[],[{"e":2191}],[{"v":2191}],[{"wait":500},{"c":2191}],[{"timeout":1000,"check":"none","wv":2191}],{}],[1,"auto_DE_huss-licht-ton.de_jj0",0,"^https?://(www\\.)?huss-licht-ton\\.de/",1,[],[{"e":2192}],[{"v":2192}],[{"wait":500},{"c":2192}],[{"timeout":1000,"check":"none","wv":2192}],{}],[1,"auto_DE_modellbau-berlinski.de_8vm",0,"^https?://(www\\.)?modellbau-berlinski\\.de/",1,[],[{"e":2193}],[{"v":2193}],[{"wait":500},{"c":2193}],[{"timeout":1000,"check":"none","wv":2193}],{}],[1,"auto_DE_phoenixnap.com_xq7",0,"^https?://(www\\.)?widget-next\\.clym-sdk\\.net/",1,[],[{"e":2194}],[{"v":2194}],[{"wait":500},{"c":2194}],[{"timeout":1000,"check":"none","wv":2194}],{}],[1,"auto_FR_fiat.fr_3fh",0,"^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/",1,[],[{"e":2195}],[{"v":2195}],[{"wait":500},{"c":2195}],[{"timeout":1000,"check":"none","wv":2195}],{}],[1,"auto_FR_stellantis.com_67q",0,"^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/",1,[],[{"e":2195}],[{"v":2195}],[{"wait":500},{"c":2195}],[{"timeout":1000,"check":"none","wv":2195}],{}],[1,"auto_GB_dropbox.com_0_+1",0,"^https?://(www\\.)?dropbox\\.com/|^https?://(www\\.)?dropbox\\.com/",1,[],[{"e":2196}],[{"v":2196}],[{"c":2196}],[],{}],[1,"auto_GB_investing.thisismoney.co.uk_0",0,"^https?://(www\\.)?thisismoney\\.co\\.uk/",1,[],[{"e":2197}],[{"v":2197}],[{"c":2197}],[],{}],[1,"auto_GB_village-hotels.co.uk_hsa",0,"^https?://(www\\.)?village-hotels\\.co\\.uk/",1,[],[{"e":2198}],[{"v":2198}],[{"wait":500},{"c":2198}],[{"timeout":1000,"check":"none","wv":2198}],{}],[1,"auto_NL_fiat.nl_trv_+1",0,"^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/|^https?://(www\\.)?cookielaw\\.emea\\.fcagroup\\.com/",1,[],[{"e":2195}],[{"v":2195}],[{"wait":500},{"c":2195}],[{"timeout":1000,"check":"none","wv":2195}],{}],[1,"auto_NL_flitsmeister.nl_ws8",0,"^https?://(www\\.)?cookies\\.flitsmeister\\.com/",1,[],[{"e":2199}],[{"v":2199}],[{"wait":500},{"c":2199}],[{"timeout":1000,"check":"none","wv":2199}],{}],[1,"auto_NL_interpolis.nl_jk9",0,"^https?://(www\\.)?interpolis\\.nl/",1,[],[{"e":2200}],[{"v":2200}],[{"wait":500},{"c":2200}],[{"timeout":1000,"check":"none","wv":2200}],{}],[1,"auto_US_dropbox.com_0_+1",0,"^https?://(www\\.)?dropbox\\.com/|^https?://(www\\.)?dropbox\\.com/",1,[],[{"e":2201}],[{"v":2201}],[{"text":"Decline","c":2201}],[],{}],[1,"coinbase",2,"^https://(www|help)\\.coinbase\\.com",11,[],[{"e":2202}],[{"v":2202}],[{"k":2203},{"all":true,"optional":true,"k":2204},{"k":2205}],[{"eval":"EVAL_COINBASE_0"}],{"intermediate":false}],[1,"ecoprivacy",2,"^https://ecoprivacy\\.ecocerved\\.it/",1,[],[{"e":2206}],[{"v":2206}],[{"wv":2207},{"wait":500},{"k":2206}],[],{}],[1,"figma",2,"^https://([a-z0-9-]+\\.)*figma\\.com/",11,[2208,2209],[{"e":2210}],[{"v":2211}],[{"c":2212}],[{"cc":2213},{"cc":2214}],{}],[1,"gmx-permission",2,"^https://plus\\.gmx\\.com/lt(?:[?#]|$)",1,[2215],[{"e":2215}],[{"v":2216}],[{"if":{"e":2217},"then":[{"c":2217}],"else":[{"if":{"e":2218},"then":[{"c":2218},{"wv":2219},{"c":2219}],"else":[{"c":2219}]}]}],[{"cc":2220}],{}],[1,"nojazz",2,"^https://nojazz\\.eu/",1,[],[{"e":2221}],[{"v":2221}],[{"if":{"v":2222},"then":[{"k":2222}],"else":[{"k":2221},{"w":2223},{"all":true,"optional":true,"k":2224},{"c":2225}]}],[],{}],[1,"pdf24",2,"^https://consent\\.pdf24\\.org/",1,[],[{"e":2226}],[{"v":2227}],[{"if":{"v":2228},"then":[{"k":2228}],"else":[{"k":2226},{"wv":2229},{"c":2230}]}],[],{}],[1,"privacymanager.io",2,"^https://cmp-consent-tool\\.privacymanager\\.io/",1,[2231,2232],[{"e":2233}],[{"v":2233}],[{"if":{"e":2234},"then":[{"k":2234},{"c":2235}],"else":[{"c":2236},{"w":2237},{"w":2238},{"all":true,"optional":true,"k":2239},{"k":2238}]}],[],{}],[1,"tumblr-com",2,"^https://(www\\.)?tumblr\\.com/",21,[2240],[{"e":2240}],[{"check":"any","v":2240}],[{"waitForThenClick":["#cmp-app-container iframe",".cmp-components-button.is-secondary"],"timeout":5000}],[],{}],[1,"web.de",2,"^https://([a-z]*\\.)?web\\.de/|^https://([a-z]*\\.)?gmx\\.net/",1,[],[{"e":2241},{"e":2242}],[{"v":2242}],[{"c":2242}],[],{}],[1,"widiba",0,"^https?://(www\\.)?widiba\\.it/",11,[2243],[{"e":2244}],[{"v":2243}],[{"c":2245}],[{"check":"none","timeout":2000,"wv":2243}],{}],[1,"1pmobile.com",2,"^https?://(\\w+\\.)?1pmobile\\.com/",22,[2246],[{"e":2247}],[{"v":2248}],[{"if":{"e":2249},"then":[{"all":true,"optional":true,"k":2250},{"c":2251}],"else":[{"c":2252}]}],[],{}],[1,"aa-cookie-banner",2,"^https://(www\\.)?(aa|envoyair|psaairlines)\\.com/",22,[2253],[{"exists":["adc-cookie-banner","#cookie-banner"]}],[{"visible":["adc-cookie-banner","#cookie-banner"]}],[{"waitForThenClick":["adc-cookie-banner","#toast-dismiss-button"]}],[{"cc":2254}],{}],[1,"abc",2,"^https://([a-z0-9-]+\\.)?abc\\.net\\.au/",22,[],[{"e":2255}],[{"v":2256}],[{"c":2257}],[{"cc":2258}],{}],[1,"abcacupuncture1",2,"^https?://(www\\.)?abcacupuncture1\\.com/",22,[623],[{"any":[{"e":624},{"e":912}]}],[{"any":[{"v":624},{"v":2259}]}],[{"if":{"v":625},"then":[{"k":625}]},{"timeout":4000,"optional":true,"wv":2259},{"if":{"v":2259},"then":[{"k":914},{"all":true,"optional":true,"k":916},{"optional":true,"k":917}]},{"if":{"v":625},"then":[{"c":625}]}],[{"cc":637}],{}],[1,"abetterrouteplanner",2,"^https?://(www\\.)?abetterrouteplanner\\.com/",22,[],[{"e":2260}],[{"v":2260}],[{"c":2260}],[{"negated":true,"e":2260}],{}],[1,"accurx",2,"^https://(accurx\\.nhs\\.uk|patient\\.accurx\\.com)/",22,[2261],[{"e":2262}],[{"v":2262}],[{"c":2263}],[{"check":"none","timeout":2000,"wv":2262}],{}],[1,"aceodds.com",2,"^https?://(www\\.)?aceodds\\.com/",22,[233],[{"e":2264}],[{"v":233}],[{"retry":10,"retryInterval":500,"c":2265},{"check":"none","wv":233}],[{"cc":2266}],{}],[1,"activobank.pt",2,"^https://(www\\.)?activobank\\.pt",22,[2267],[{"e":2268}],[{"v":2269}],[{"c":2270}],[],{}],[1,"adultfriendfinder",2,"^https://(www\\.)?adultfriendfinder\\.com/",22,[2271],[{"e":2272}],[{"v":2272}],[{"c":2273}],[{"eval":"EVAL_ADULTFRIENDFINDER_TEST"}],{}],[1,"aemet",1,"^https?://(www\\.)?aemet\\.es/",22,[2274],[{"e":2275}],[{"v":2274}],[{"h":2274}],[{"check":"none","v":2274}],{}],[1,"aeolservice",2,"^https?://cloud\\.aeolservice\\.es/",22,[],[{"e":2276}],[{"v":2277}],[{"c":2277},{"wv":2278},{"all":true,"optional":true,"k":2279},{"c":2280}],[],{}],[1,"ah.nl",0,"^https?://(www\\.)?ah\\.nl/",10,[],[{"e":2281}],[{"v":2281}],[{"c":2282}],[],{}],[1,"airbnb",2,"^https?://(www\\.)?airbnb\\.[a-z.]+/",22,[2283],[{"e":2284}],[{"v":2284}],[{"retry":5,"retryInterval":500,"c":2284}],[{"timeout":1000,"check":"none","wv":2284}],{}],[1,"alaskaair",1,"^https://(www\\.)?alaskaair\\.com/",22,[2285],[{"e":2285}],[{"v":2285}],[{"h":2285}],[],{}],[1,"aliexpress",2,"^https://([a-z]*\\.)?aliexpress\\.com/",22,[2286],[{"e":2287}],[{"check":"any","v":2287}],[{"if":{"e":2288},"then":[{"c":2289}],"else":[{"if":{"e":2290},"then":[{"if":{"e":2291},"then":[{"c":2292}],"else":[{"c":2293},{"timeout":5000,"c":2294}]}],"else":[{"if":{"e":2295},"then":[{"c":2296}],"else":[{"c":2297},{"timeout":5000,"wv":2298},{"c":2299}]}]}]}],[],{}],[1,"allabout-japan",2,"^https?://(\\w+\\.)?allabout-japan\\.com/",22,[2300],[{"e":2301}],[{"v":2301}],[{"h":2300},{"timeout":8000,"optional":true,"wv":2259},{"if":{"v":2259},"then":[{"k":914},{"all":true,"optional":true,"k":916},{"optional":true,"k":917}]}],[],{}],[1,"ally",1,"^https://(www\\.)?ally\\.com/",22,[2302],[{"e":2303}],[{"v":2303}],[{"h":2302}],[],{}],[1,"amazon-music",2,"^https?://music\\.amazon\\.[a-z.]+/",22,[2304],[{"e":2305}],[{"v":2306}],[{"waitForThenClick":["#bannerFooter music-button[variant=outline]","button"]}],[{"check":"none","timeout":2000,"wv":2306}],{}],[1,"amazon-pay",2,"^https?://pay\\.amazon\\.",22,[2307],[{"e":2308}],[{"v":2307}],[{"k":2308}],[{"cc":2309}],{}],[1,"amazonforum",2,"^https?://(\\w+\\.)?amazonforum\\.com/",10,[],[{"exists":["c-cookie-consent",".cookiecon-footer-container-fixed button.cookie_reject_btn"]}],[{"visible":["c-cookie-consent",".cookiecon-footer-container-fixed"]}],[{"waitForThenClick":["c-cookie-consent",".cookiecon-footer-container-fixed button.cookie_reject_btn"]},{"waitFor":["c-cookie-consent","section.azCookieCustomise li lightning-input","lightning-primitive-input-toggle","input"]},{"if":{"exists":["c-cookie-consent","section.azCookieCustomise li:nth-child(1) lightning-input","lightning-primitive-input-toggle","input:checked"]},"then":[{"click":["c-cookie-consent","section.azCookieCustomise li:nth-child(1) lightning-input","lightning-primitive-input-toggle","input:checked"]}]},{"if":{"exists":["c-cookie-consent","section.azCookieCustomise li:nth-child(2) lightning-input","lightning-primitive-input-toggle","input:checked"]},"then":[{"click":["c-cookie-consent","section.azCookieCustomise li:nth-child(2) lightning-input","lightning-primitive-input-toggle","input:checked"]}]},{"if":{"exists":["c-cookie-consent","section.azCookieCustomise li:nth-child(3) lightning-input","lightning-primitive-input-toggle","input:checked"]},"then":[{"click":["c-cookie-consent","section.azCookieCustomise li:nth-child(3) lightning-input","lightning-primitive-input-toggle","input:checked"]}]},{"click":["c-cookie-consent","section.azCookieCustomise footer .cookiecon-desktop-section lightning-button.focusStyleButton","button"]}],[{"waitForVisible":["c-cookie-consent",".cookiecon-footer-container-fixed"],"timeout":2000,"check":"none"}],{}],[1,"animatetimes",2,"^https?://(www\\.)?animatetimes\\.com/",22,[2310],[{"e":2310}],[{"v":2310}],[{"c":2311}],[{"check":"none","v":2310}],{}],[1,"annunci69.it",2,"^https?://(www\\.)?annunci69\\.it/",22,[2312],[{"e":2313}],[{"v":2312}],[{"c":2314},{"wv":2315},{"optional":true,"k":2316},{"k":2317},{"check":"none","wv":2312}],[{"cc":2318}],{}],[1,"app.discuss.io",2,"^https?://app\\.discuss\\.io/",10,[],[{"e":1517}],[{"v":1517}],[{"c":1517}],[{"cc":199}],{}],[1,"arbeidsplassen-nav-no",2,"^https?://arbeidsplassen\\.nav\\.no/",22,[2319],[{"e":2320}],[{"v":2319}],[{"c":2321}],[{"cc":649}],{}],[1,"arena.ai",2,"^https?://(\\w+\\.)?arena\\.ai/",22,[],[{"e":2322}],[{"v":2322}],[{"c":2323},{"wv":2324},{"all":true,"optional":true,"k":2325},{"c":2326}],[{"cc":2327}],{}],[1,"aslroma1-it",2,"^https?://(\\w+\\.)?aslroma1\\.it/",22,[2328],[{"e":2329}],[{"v":2328}],[{"c":2329},{"check":"none","wv":2328}],[{"cc":2330}],{}],[1,"asrock",2,"^https?://(\\w+\\.)?asrock\\.com/",22,[],[{"e":2331}],[{"v":2332}],[{"c":2333},{"wv":2334},{"all":true,"optional":true,"k":2335},{"k":2336}],[{"cc":2337}],{}],[1,"athlinks-com",1,"^https://(www\\.)?athlinks\\.com/",22,[2338],[{"e":2338}],[{"v":2339}],[{"h":2338}],[],{}],[1,"att",2,"^https://([a-z0-9-]+\\.)*att\\.com/",22,[2340],[{"exists":["#gpc-banner-container","#declineSave"]}],[{"visible":["#gpc-banner-container","#declineSave"]}],[{"waitForThenClick":["#gpc-banner-container","#declineSave"]}],[{"wait":1000},{"cc":2341}],{}],[1,"auctionet",2,"^https?://(www\\.)?auctionet\\.(com|se)/",22,[2342],[{"e":2343}],[{"v":2343}],[{"c":2344},{"c":2345}],[{"wait":500},{"cc":2346}],{}],[1,"auto_AU_acetool.com_n0w_+1",0,"^https?://(www\\.)?acetool\\.com/|^https?://(www\\.)?unclewiener\\.com/",10,[],[{"e":2347}],[{"v":2347}],[{"wait":500},{"c":2347}],[{"timeout":1000,"check":"none","wv":2347}],{}],[1,"auto_AU_aelfie.com_chb",0,"^https?://(www\\.)?aelfie\\.com/",10,[],[{"e":2348}],[{"v":2348}],[{"wait":500},{"c":2348}],[{"timeout":1000,"check":"none","wv":2348}],{}],[1,"auto_AU_cam.start.canon_3x5",0,"^https?://(www\\.)?cam\\.start\\.canon/",10,[],[{"e":2349}],[{"v":2349}],[{"wait":500},{"c":2349}],[{"timeout":1000,"check":"none","wv":2349}],{}],[1,"auto_AU_cam.start.canon_z06",0,"^https?://(www\\.)?cam\\.start\\.canon/",10,[],[{"e":2350}],[{"v":2350}],[{"wait":500},{"c":2350}],[{"timeout":1000,"check":"none","wv":2350}],{}],[1,"auto_AU_capitoltrades.com_ak9",0,"^https?://(www\\.)?capitoltrades\\.com/",10,[],[{"e":2351}],[{"v":2351}],[{"wait":500},{"c":2351}],[{"timeout":1000,"check":"none","wv":2351}],{}],[1,"auto_AU_community.dyson.com_lek",0,"^https?://(www\\.)?community\\.dyson\\.com/",10,[],[{"e":2352}],[{"v":2352}],[{"wait":500},{"c":2352}],[{"timeout":1000,"check":"none","wv":2352}],{}],[1,"auto_AU_conference-board.org_dce",0,"^https?://(www\\.)?conference-board\\.org/",10,[],[{"e":2353}],[{"v":2353}],[{"wait":500},{"c":2353}],[{"timeout":1000,"check":"none","wv":2353}],{}],[1,"auto_AU_cutterbuck.com_ko7",0,"^https?://(www\\.)?cutterbuck\\.com/",10,[],[{"e":2354}],[{"v":2354}],[{"wait":500},{"c":2354}],[{"timeout":1000,"check":"none","wv":2354}],{}],[1,"auto_AU_deezer.com_tmf",0,"^https?://(www\\.)?deezer\\.com/",10,[],[{"e":2355}],[{"v":2355}],[{"wait":500},{"c":2355}],[{"timeout":1000,"check":"none","wv":2355}],{}],[1,"auto_AU_docs.portainer.io_hn5",0,"^https?://(www\\.)?docs\\.portainer\\.io/",10,[],[{"e":2356}],[{"v":2356}],[{"wait":500},{"c":2356}],[{"timeout":1000,"check":"none","wv":2356}],{}],[1,"auto_AU_flinders.edu.au_7en_+1",0,"^https?://(www\\.)?flinders\\.edu\\.au/|^https?://(www\\.)?students\\.flinders\\.edu\\.au/",10,[],[{"e":2357}],[{"v":2357}],[{"c":2357}],[],{}],[1,"auto_AU_flysaa.com_qsm",0,"^https?://(www\\.)?flysaa\\.com/",10,[2358],[{"e":2358}],[{"v":2359}],[{"c":2360}],[{"timeout":1000,"check":"none","wv":2359}],{}],[1,"auto_AU_gayseniordating.com_bdr",0,"^https?://(www\\.)?gayseniordating\\.com/",10,[],[{"e":2361}],[{"v":2361}],[{"wait":500},{"c":2361}],[{"timeout":1000,"check":"none","wv":2361}],{}],[1,"auto_AU_goodmoodprints.com_9fy",1,"^https?://(www\\.)?goodmoodprints\\.com/",10,[2362],[{"e":2362}],[{"v":2362}],[{"h":2362}],[{"timeout":1000,"check":"none","wv":2362}],{}],[1,"auto_AU_lush.com_bdf",0,"^https?://(www\\.)?lush\\.com/",10,[],[{"e":2363}],[{"v":2363}],[{"wait":500},{"c":2363}],[{"timeout":1000,"check":"none","wv":2363}],{}],[1,"auto_AU_newyork.doverstreetmarket.com_j5q",0,"^https?://(www\\.)?newyork\\.doverstreetmarket\\.com/",10,[],[{"e":2364}],[{"v":2364}],[{"wait":500},{"c":2364}],[{"timeout":1000,"check":"none","wv":2364}],{}],[1,"auto_AU_newyork.doverstreetmarket.com_k2q",0,"^https?://(www\\.)?newyork\\.doverstreetmarket\\.com/",10,[],[{"e":2365}],[{"v":2365}],[{"wait":500},{"c":2365}],[{"timeout":1000,"check":"none","wv":2365}],{}],[1,"auto_AU_niwaki.com_w41",0,"^https?://(www\\.)?niwaki\\.com/",10,[],[{"e":2366}],[{"v":2366}],[{"wait":500},{"c":2366}],[{"timeout":1000,"check":"none","wv":2366}],{}],[1,"auto_AU_pichunter.com_zhf",0,"^https?://(www\\.)?pichunter\\.com/",10,[],[{"e":2367}],[{"v":2367}],[{"wait":500},{"c":2367}],[{"timeout":1000,"check":"none","wv":2367}],{}],[1,"auto_AU_pnp.co.za_9lg",0,"^https?://(www\\.)?pnp\\.co\\.za/",10,[],[{"e":2368}],[{"v":2368}],[{"wait":500},{"c":2368}],[{"timeout":1000,"check":"none","wv":2368}],{}],[1,"auto_AU_publicdomainreview.org_7fg",0,"^https?://(www\\.)?publicdomainreview\\.org/",10,[],[{"e":2369}],[{"v":2369}],[{"wait":500},{"c":2369}],[{"timeout":1000,"check":"none","wv":2369}],{}],[1,"auto_AU_qldnaturistassoc.org_k53",0,"^https?://(www\\.)?qldnaturistassoc\\.org/",10,[],[{"e":2370}],[{"v":2370}],[{"wait":500},{"c":2370}],[{"timeout":1000,"check":"none","wv":2370}],{}],[1,"auto_AU_rki.de_tp5",0,"^https?://(www\\.)?rki\\.de/",10,[],[{"e":2371}],[{"v":2371}],[{"wait":500},{"c":2371}],[{"timeout":1000,"check":"none","wv":2371}],{}],[1,"auto_AU_solesavy.com_8q6",0,"^https?://(www\\.)?solesavy\\.com/",10,[],[{"e":2372}],[{"v":2372}],[{"wait":500},{"c":2372}],[{"timeout":1000,"check":"none","wv":2372}],{}],[1,"auto_AU_staff.flinders.edu.au_cpu",0,"^https?://(www\\.)?staff\\.flinders\\.edu\\.au/",10,[],[{"e":2357}],[{"v":2357}],[{"wait":500},{"c":2357}],[{"timeout":1000,"check":"none","wv":2357}],{}],[1,"auto_AU_telekom.hu_4lu",0,"^https?://(www\\.)?telekom\\.hu/",10,[],[{"e":2373}],[{"v":2373}],[{"wait":500},{"c":2373}],[{"timeout":1000,"check":"none","wv":2373}],{}],[1,"auto_AU_tourismnewbrunswick.ca_bjd",0,"^https?://(www\\.)?tourismnewbrunswick\\.ca/",10,[],[{"e":2374}],[{"v":2374}],[{"wait":500},{"c":2374}],[{"timeout":1000,"check":"none","wv":2374}],{}],[1,"auto_AU_tripcentral.ca_v7v",0,"^https?://(www\\.)?tripcentral\\.ca/",10,[],[{"e":2375}],[{"v":2375}],[{"wait":500},{"c":2375}],[{"timeout":1000,"check":"none","wv":2375}],{}],[1,"auto_AU_u-buy.com.au_rg0",0,"^https?://(www\\.)?u-buy\\.com\\.au/",10,[],[{"e":2376}],[{"v":2376}],[{"wait":500},{"c":2376}],[{"timeout":1000,"check":"none","wv":2376}],{}],[1,"auto_AU_whitepages.co.com_4cs",0,"^https?://(www\\.)?whitepages\\.co\\.com/",10,[],[{"e":2377}],[{"v":2377}],[{"wait":500},{"c":2377}],[{"timeout":1000,"check":"none","wv":2377}],{}],[1,"auto_CA_407etr.com_wrd",0,"^https?://(www\\.)?407etr\\.com/",10,[],[{"e":2378}],[{"v":2378}],[{"wait":500},{"c":2378}],[{"timeout":1000,"check":"none","wv":2378}],{}],[1,"auto_CA_arte.tv_7nv",0,"^https?://(www\\.)?arte\\.tv/",10,[],[{"e":2379}],[{"v":2379}],[{"c":2379}],[],{}],[1,"auto_CA_babel.hathitrust.org_i6g",0,"^https?://(www\\.)?babel\\.hathitrust\\.org/",10,[],[{"e":2380}],[{"v":2380}],[{"wait":500},{"c":2380}],[{"timeout":1000,"check":"none","wv":2380}],{}],[1,"auto_CA_belairdirect.com_wic",0,"^https?://(www\\.)?belairdirect\\.com/",10,[],[{"e":2381}],[{"v":2381}],[{"wait":500},{"c":2381}],[{"timeout":1000,"check":"none","wv":2381}],{}],[1,"auto_CA_bet365.bet.br_kkx",0,"^https?://(www\\.)?bet365\\.bet\\.br/",10,[],[{"e":2382}],[{"v":2382}],[{"wait":500},{"c":2382}],[{"timeout":1000,"check":"none","wv":2382}],{}],[1,"auto_CA_blackdiamondequipment.com_dwp_+8",0,"^https?://(www\\.)?blackdiamondequipment\\.com/|^https?://(www\\.)?facetofacegames\\.com/|^https?://(www\\.)?suzyshier\\.com/|^https?://(www\\.)?urban-planet\\.com/|^https?://(www\\.)?eu\\.blackdiamondequipment\\.com/|^https?://(www\\.)?bushwear\\.co\\.uk/|^https?://(www\\.)?directdoors\\.com/|^https?://(www\\.)?keenfootwear\\.com/|^https?://(www\\.)?shop\\.panasonic\\.com/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_CA_brazzers.com_kik",0,"^https?://(www\\.)?brazzers\\.com/",10,[],[{"e":2384}],[{"v":2384}],[{"wait":500},{"c":2384}],[{"timeout":1000,"check":"none","wv":2384}],{}],[1,"auto_CA_busbud.com_0sh",0,"^https?://(www\\.)?busbud\\.com/",10,[],[{"e":2385}],[{"v":2385}],[{"wait":500},{"c":2385}],[{"timeout":1000,"check":"none","wv":2385}],{}],[1,"auto_CA_cegeplimoilou.ca_9tg",0,"^https?://(www\\.)?cegeplimoilou\\.ca/",10,[],[{"e":2386}],[{"v":2386}],[{"wait":500},{"c":2386}],[{"timeout":1000,"check":"none","wv":2386}],{}],[1,"auto_CA_cfo.coop_edx",0,"^https?://(www\\.)?cfo\\.coop/",10,[],[{"e":2387}],[{"v":2387}],[{"wait":500},{"c":2387}],[{"timeout":1000,"check":"none","wv":2387}],{}],[1,"auto_CA_chipolo.net_zo9",0,"^https?://(www\\.)?chipolo\\.net/",10,[],[{"e":2388}],[{"v":2388}],[{"wait":500},{"c":2388}],[{"timeout":1000,"check":"none","wv":2388}],{}],[1,"auto_CA_cmpa-acpm.ca_nja",0,"^https?://(www\\.)?cmpa-acpm\\.ca/",10,[],[{"e":2389}],[{"v":2389}],[{"c":2389}],[],{}],[1,"auto_CA_denniskirk.com_ezr",0,"^https?://(www\\.)?denniskirk\\.com/",10,[],[{"e":2390}],[{"v":2390}],[{"wait":500},{"c":2390}],[{"timeout":1000,"check":"none","wv":2390}],{}],[1,"auto_CA_doyondespres.com_4jr",0,"^https?://(www\\.)?doyondespres\\.com/",10,[],[{"e":2391}],[{"v":2391}],[{"wait":500},{"c":2391}],[{"timeout":1000,"check":"none","wv":2391}],{}],[1,"auto_CA_f6s.com_yjw",0,"^https?://(www\\.)?f6s\\.com/",10,[],[{"e":2392}],[{"v":2392}],[{"wait":500},{"c":2392}],[{"timeout":1000,"check":"none","wv":2392}],{}],[1,"auto_CA_fischersports.com_1yr",0,"^https?://(www\\.)?fischersports\\.com/",10,[],[{"e":2393}],[{"v":2393}],[{"wait":500},{"c":2393}],[{"timeout":1000,"check":"none","wv":2393}],{}],[1,"auto_CA_golfavenue.ca_ero_+1",0,"^https?://(www\\.)?golfavenue\\.ca/|^https?://(www\\.)?golfbidder\\.co\\.uk/",10,[],[{"e":2394}],[{"v":2394}],[{"wait":500},{"c":2394}],[{"timeout":1000,"check":"none","wv":2394}],{}],[1,"auto_CA_golftown.com_zcn",0,"^https?://(www\\.)?golftown\\.com/",10,[],[{"e":2395}],[{"v":2395}],[{"wait":500},{"c":2395}],[{"timeout":1000,"check":"none","wv":2395}],{}],[1,"auto_CA_intact.ca_gax",0,"^https?://(www\\.)?intact\\.ca/",10,[],[{"e":2396}],[{"v":2396}],[{"wait":500},{"c":2396}],[{"timeout":1000,"check":"none","wv":2396}],{}],[1,"auto_CA_lethpolytech.ca_1r1",0,"^https?://(www\\.)?lethpolytech\\.ca/",10,[],[{"e":2397}],[{"v":2397}],[{"wait":500},{"c":2397}],[{"timeout":1000,"check":"none","wv":2397}],{}],[1,"auto_CA_libgen.help_7s8",0,"^https?://(www\\.)?libgen\\.help/",10,[],[{"e":2398}],[{"v":2398}],[{"wait":500},{"c":2398}],[{"timeout":1000,"check":"none","wv":2398}],{}],[1,"auto_CA_nationalarchives.gov.uk_vgx",0,"^https?://(www\\.)?webarchive\\.nationalarchives\\.gov\\.uk/",10,[],[{"e":2399}],[{"v":2399}],[{"wait":500},{"c":2399}],[{"timeout":1000,"check":"none","wv":2399}],{}],[1,"auto_CA_papajohns.ca_n5j",0,"^https?://(www\\.)?papajohns\\.ca/",10,[],[{"e":2400}],[{"v":2400}],[{"wait":500},{"c":2400}],[{"timeout":1000,"check":"none","wv":2400}],{}],[1,"auto_CA_pcsupport.lenovo.com_dxi",0,"^https?://(www\\.)?pcsupport\\.lenovo\\.com/",10,[],[{"e":2401}],[{"v":2401}],[{"wait":500},{"c":2401}],[{"timeout":1000,"check":"none","wv":2401}],{}],[1,"auto_CA_promessedefleurs.com_noy_+1",0,"^https?://(www\\.)?promessedefleurs\\.com/|^https?://(www\\.)?meillandrichardier\\.com/",10,[],[{"e":2402}],[{"v":2402}],[{"wait":500},{"c":2402}],[{"timeout":1000,"check":"none","wv":2402}],{}],[1,"auto_CA_queerty.com_fb8_+1",0,"^https?://(www\\.)?queerty\\.com/|^https?://(www\\.)?pestor\\.nl/",10,[],[{"e":2403}],[{"v":2403}],[{"wait":500},{"c":2403}],[{"timeout":1000,"check":"none","wv":2403}],{}],[1,"auto_CA_remitly.com_mm4",0,"^https?://(www\\.)?remitly\\.com/",10,[],[{"e":2404}],[{"v":2404}],[{"wait":500},{"c":2404}],[{"timeout":1000,"check":"none","wv":2404}],{}],[1,"auto_CA_reviewed.com_w2k",0,"^https?://(www\\.)?reviewed\\.com/",10,[],[{"e":2405}],[{"v":2405}],[{"wait":500},{"c":2405}],[{"timeout":1000,"check":"none","wv":2405}],{}],[1,"auto_CA_sheetmusicplus.com_b7d",0,"^https?://(www\\.)?sheetmusicplus\\.com/",10,[],[{"e":2406}],[{"v":2406}],[{"wait":500},{"c":2406}],[{"timeout":1000,"check":"none","wv":2406}],{}],[1,"auto_CA_skipthedishes.com_1sg",0,"^https?://(www\\.)?skipthedishes\\.com/",10,[],[{"e":2407}],[{"v":2407}],[{"c":2407}],[],{}],[1,"auto_CA_streamingthe.net_v8e",0,"^https?://(www\\.)?streamingthe\\.net/",10,[],[{"e":2408}],[{"v":2408}],[{"wait":500},{"c":2408}],[{"timeout":1000,"check":"none","wv":2408}],{}],[1,"auto_CA_ticketsource.com_kiv",0,"^https?://(www\\.)?ticketsource\\.com/",10,[],[{"e":2409}],[{"v":2409}],[{"wait":500},{"c":2409}],[{"timeout":1000,"check":"none","wv":2409}],{}],[1,"auto_CA_ubereats.com_4nx",0,"^https?://(www\\.)?ubereats\\.com/",10,[],[{"e":2410}],[{"v":2410}],[{"wait":500},{"c":2410}],[{"timeout":1000,"check":"none","wv":2410}],{}],[1,"auto_CA_wealthsimple.com_kgz",0,"^https?://(www\\.)?wealthsimple\\.com/",10,[],[{"e":2411}],[{"v":2411}],[{"wait":500},{"c":2411}],[{"timeout":1000,"check":"none","wv":2411}],{}],[1,"auto_CA_xplore.ca_wwx",0,"^https?://(www\\.)?xplore\\.ca/",10,[],[{"e":2412}],[{"v":2412}],[{"wait":500},{"c":2412}],[{"timeout":1000,"check":"none","wv":2412}],{}],[1,"auto_CH_3djake.ch_6k2_+3",0,"^https?://(www\\.)?3djake\\.ch/|^https?://(www\\.)?ecco-verde\\.ch/|^https?://(www\\.)?vitalabo\\.ch/|^https?://(www\\.)?3djake\\.de/",10,[],[{"e":2413}],[{"v":2413}],[{"wait":500},{"c":2413}],[{"timeout":1000,"check":"none","wv":2413}],{}],[1,"auto_CH_alpenvereinaktiv.com_ms8_+1",0,"^https?://(www\\.)?alpenvereinaktiv\\.com/|^https?://(www\\.)?maps\\.viamala\\.ch/",10,[],[{"e":2414}],[{"v":2414}],[{"wait":500},{"c":2414}],[{"timeout":1000,"check":"none","wv":2414}],{}],[1,"auto_CH_android.bestsecret.com_m12_+2",0,"^https?://(www\\.)?android\\.bestsecret\\.com/|^https?://(www\\.)?bestsecret\\.com/|^https?://(www\\.)?orders\\.bestsecret\\.com/",10,[],[{"e":2415}],[{"v":2415}],[{"wait":500},{"c":2415}],[{"timeout":1000,"check":"none","wv":2415}],{}],[1,"auto_CH_aoc.com_dib",0,"^https?://(www\\.)?aoc\\.com/",10,[],[{"e":2416}],[{"v":2416}],[{"wait":500},{"c":2416}],[{"timeout":1000,"check":"none","wv":2416}],{}],[1,"auto_CH_arte.tv_ln7",0,"^https?://(www\\.)?arte\\.tv/",10,[],[{"e":2417}],[{"v":2417}],[{"wait":500},{"c":2417}],[{"timeout":1000,"check":"none","wv":2417}],{}],[1,"auto_CH_arttv.ch_2lm",0,"^https?://(www\\.)?arttv\\.ch/",10,[],[{"e":2418}],[{"v":2418}],[{"wait":500},{"c":2418}],[{"timeout":1000,"check":"none","wv":2418}],{}],[1,"auto_CH_ascona.il-centro.ch_59k",0,"^https?://(www\\.)?ascona\\.il-centro\\.ch/",10,[],[{"e":2419}],[{"v":2419}],[{"wait":500},{"c":2419}],[{"timeout":1000,"check":"none","wv":2419}],{}],[1,"auto_CH_astag.ch_1if",0,"^https?://(www\\.)?astag\\.ch/",10,[],[{"e":2420}],[{"v":2420}],[{"wait":500},{"c":2420}],[{"timeout":1000,"check":"none","wv":2420}],{}],[1,"auto_CH_auto.swiss_z35",0,"^https?://(www\\.)?auto\\.swiss/",10,[],[{"e":2421}],[{"v":2421}],[{"wait":500},{"c":2421}],[{"timeout":1000,"check":"none","wv":2421}],{}],[1,"auto_CH_bandlab.com_jul",0,"^https?://(www\\.)?bandlab\\.com/",10,[],[{"e":2422}],[{"v":2422}],[{"wait":500},{"c":2422}],[{"timeout":1000,"check":"none","wv":2422}],{}],[1,"auto_CH_bitbox.swiss_w0n",0,"^https?://(www\\.)?bitbox\\.swiss/",10,[],[{"e":2423}],[{"v":2423}],[{"wait":500},{"c":2423}],[{"timeout":1000,"check":"none","wv":2423}],{}],[1,"auto_CH_blogdumoderateur.com_8p6",0,"^https?://(www\\.)?blogdumoderateur\\.com/",10,[],[{"e":2424}],[{"v":2424}],[{"wait":500},{"c":2424}],[{"timeout":1000,"check":"none","wv":2424}],{}],[1,"auto_CH_blutspendezurich.ch_s0f",0,"^https?://(www\\.)?blutspendezurich\\.ch/",10,[],[{"e":2425}],[{"v":2425}],[{"wait":500},{"c":2425}],[{"timeout":1000,"check":"none","wv":2425}],{}],[1,"auto_CH_cardmarket.com_15t",0,"^https?://(www\\.)?cardmarket\\.com/",10,[],[{"e":2426}],[{"v":2426}],[{"wait":500},{"c":2426}],[{"timeout":1000,"check":"none","wv":2426}],{}],[1,"auto_CH_ch.rotho.com_h99_+2",0,"^https?://(www\\.)?ch\\.rotho\\.com/|^https?://(www\\.)?reclam\\.de/|^https?://(www\\.)?dacianer\\.de/",10,[],[{"e":2427}],[{"v":2427}],[{"wait":500},{"c":2427}],[{"timeout":1000,"check":"none","wv":2427}],{}],[1,"auto_CH_chambres-hotes.fr_hay",0,"^https?://(www\\.)?chambres-hotes\\.fr/",10,[],[{"e":2428}],[{"v":2428}],[{"wait":500},{"c":2428}],[{"timeout":1000,"check":"none","wv":2428}],{}],[1,"auto_CH_chrono24.ch_dve_+1",0,"^https?://(www\\.)?chrono24\\.ch/|^https?://(www\\.)?chrono24\\.de/",10,[],[{"e":2429}],[{"v":2429}],[{"wait":500},{"c":2429}],[{"timeout":1000,"check":"none","wv":2429}],{}],[1,"auto_CH_chrono24.com_lj5_+1",0,"^https?://(www\\.)?chrono24\\.com/|^https?://(www\\.)?chrono24\\.co\\.uk/",10,[],[{"e":2429}],[{"v":2429}],[{"wait":500},{"c":2429}],[{"timeout":1000,"check":"none","wv":2429}],{}],[1,"auto_CH_ersatzteil-shop24.de_mh5_+1",0,"^https?://(www\\.)?ersatzteil-shop24\\.de/|^https?://(www\\.)?der-rasenmaeher\\.de/",10,[],[{"e":2430}],[{"v":2430}],[{"wait":500},{"c":2430}],[{"timeout":1000,"check":"none","wv":2430}],{}],[1,"auto_CH_euroairport.com_3yl_+4",0,"^https?://(www\\.)?euroairport\\.com/|^https?://(www\\.)?carnavalet\\.paris\\.fr/|^https?://(www\\.)?ifrap\\.org/|^https?://(www\\.)?mam\\.paris\\.fr/|^https?://(www\\.)?petitpalais\\.paris\\.fr/",10,[],[{"e":2431}],[{"v":2431}],[{"wait":500},{"c":2431}],[{"timeout":1000,"check":"none","wv":2431}],{}],[1,"auto_CH_europarl.europa.eu_y2d",0,"^https?://(www\\.)?europarl\\.europa\\.eu/",10,[],[{"e":2432}],[{"v":2432}],[{"wait":500},{"c":2432}],[{"timeout":1000,"check":"none","wv":2432}],{}],[1,"auto_CH_feldschloesschen.ch_4mc",0,"^https?://(www\\.)?feldschloesschen\\.ch/",10,[],[{"e":2433}],[{"v":2433}],[{"wait":500},{"c":2433}],[{"timeout":1000,"check":"none","wv":2433}],{}],[1,"auto_CH_fhgr.ch_9nr",0,"^https?://(www\\.)?fhgr\\.ch/",10,[],[{"e":2434}],[{"v":2434}],[{"wait":500},{"c":2434}],[{"timeout":1000,"check":"none","wv":2434}],{}],[1,"auto_CH_fondationbeyeler.ch_o13",0,"^https?://(www\\.)?fondationbeyeler\\.ch/",10,[],[{"e":2427}],[{"v":2427}],[{"wait":500},{"c":2427}],[{"timeout":1000,"check":"none","wv":2427}],{}],[1,"auto_CH_fontis-shop.ch_ksd",0,"^https?://(www\\.)?fontis-shop\\.ch/",10,[],[{"e":2435}],[{"v":2435}],[{"wait":500},{"c":2435}],[{"timeout":1000,"check":"none","wv":2435}],{}],[1,"auto_CH_frankenspalter.ch_jo0",0,"^https?://(www\\.)?frankenspalter\\.ch/",10,[],[{"e":2436}],[{"v":2436}],[{"wait":500},{"c":2436}],[{"timeout":1000,"check":"none","wv":2436}],{}],[1,"auto_CH_frankenspalter.ch_l2w",0,"^https?://(www\\.)?frankenspalter\\.ch/",10,[],[{"e":2437}],[{"v":2437}],[{"wait":500},{"c":2437}],[{"timeout":1000,"check":"none","wv":2437}],{}],[1,"auto_CH_fruugoschweiz.com_6k8",0,"^https?://(www\\.)?fruugoschweiz\\.com/",10,[],[{"e":2438}],[{"v":2438}],[{"wait":500},{"c":2438}],[{"timeout":1000,"check":"none","wv":2438}],{}],[1,"auto_CH_gabrielweinberg.com_56i",0,"^https?://(www\\.)?gabrielweinberg\\.com/",10,[],[{"e":2439}],[{"v":2439}],[{"wait":500},{"c":2439}],[{"timeout":1000,"check":"none","wv":2439}],{}],[1,"auto_CH_galaxus.de_sqv_+1",0,"^https?://(www\\.)?galaxus\\.de/|^https?://(www\\.)?galaxus\\.fr/",10,[],[{"e":2440}],[{"v":2440}],[{"wait":500},{"c":2440}],[{"timeout":1000,"check":"none","wv":2440}],{}],[1,"auto_CH_gstaadmenuhinfestival.ch_vp3",0,"^https?://(www\\.)?gstaadmenuhinfestival\\.ch/",10,[],[{"e":2441}],[{"v":2441}],[{"wait":500},{"c":2441}],[{"timeout":1000,"check":"none","wv":2441}],{}],[1,"auto_CH_haushaltstipps.com_9kx_+1",0,"^https?://(www\\.)?haushaltstipps\\.com/|^https?://(www\\.)?alltours\\.de/",10,[],[{"e":2427}],[{"v":2427}],[{"wait":500},{"c":2427}],[{"timeout":1000,"check":"none","wv":2427}],{}],[1,"auto_CH_independentxpress.de_0qj",0,"^https?://(www\\.)?independentxpress\\.de/",10,[],[{"e":2442}],[{"v":2442}],[{"wait":500},{"c":2442}],[{"timeout":1000,"check":"none","wv":2442}],{}],[1,"auto_CH_instant-gaming.com_8j3",0,"^https?://(www\\.)?instant-gaming\\.com/",10,[],[{"e":2443}],[{"v":2443}],[{"wait":500},{"c":2443}],[{"timeout":1000,"check":"none","wv":2443}],{}],[1,"auto_CH_kinopoisk.ru_w3g_+14",0,"^https?://(www\\.)?kinopoisk\\.ru/|^https?://(www\\.)?market\\.yandex\\.ru/|^https?://(www\\.)?translate\\.yandex\\.com/|^https?://(www\\.)?yandex\\.com\\.tr/|^https?://(www\\.)?ya\\.ru/|^https?://(www\\.)?yandex\\.com/|^https?://(www\\.)?translate\\.yandex\\.ru/|^https?://(www\\.)?yandex\\.by/|^https?://(www\\.)?local\\.yandex\\.com/|^https?://(www\\.)?sso\\.passport\\.yandex\\.ru/|^https?://(www\\.)?360\\.yandex\\.ru/|^https?://(www\\.)?360\\.yandex\\.com/|^https?://(www\\.)?music\\.yandex\\.ru/|^https?://(www\\.)?hd\\.kinopoisk\\.ru/|^https?://(www\\.)?wap\\.yandex\\.com/",10,[],[{"e":2444}],[{"v":2444}],[{"wait":500},{"c":2444}],[{"timeout":1000,"check":"none","wv":2444}],{}],[1,"auto_CH_kobo.com_p4l",0,"^https?://(www\\.)?kobo\\.com/",10,[],[{"e":2445}],[{"v":2445}],[{"wait":500},{"c":2445}],[{"timeout":1000,"check":"none","wv":2445}],{}],[1,"auto_CH_labanquepostale.fr_o6f_+1",0,"^https?://(www\\.)?labanquepostale\\.fr/|^https?://(www\\.)?labanquepostale\\.com/",10,[],[{"e":2446}],[{"v":2446}],[{"wait":500},{"c":2446}],[{"timeout":1000,"check":"none","wv":2446}],{}],[1,"auto_CH_laposte.fr_ctu_+2",0,"^https?://(www\\.)?laposte\\.fr/|^https?://(www\\.)?localiser\\.laposte\\.fr/|^https?://(www\\.)?aide\\.laposte\\.fr/",10,[],[{"e":2447}],[{"v":2447}],[{"wait":500},{"c":2447}],[{"timeout":1000,"check":"none","wv":2447}],{}],[1,"auto_CH_larian.com_kp5",0,"^https?://(www\\.)?larian\\.com/",10,[],[{"e":2448}],[{"v":2448}],[{"wait":500},{"c":2448}],[{"timeout":1000,"check":"none","wv":2448}],{}],[1,"auto_CH_louis-moto.ch_5yk",0,"^https?://(www\\.)?louis-moto\\.ch/",10,[],[{"e":2449}],[{"v":2449}],[{"wait":500},{"c":2449}],[{"timeout":1000,"check":"none","wv":2449}],{}],[1,"auto_CH_manufactum.ch_ag0_+1",0,"^https?://(www\\.)?manufactum\\.ch/|^https?://(www\\.)?manufactum\\.de/",10,[],[{"e":2450}],[{"v":2450}],[{"wait":500},{"c":2450}],[{"timeout":1000,"check":"none","wv":2450}],{}],[1,"auto_CH_maps.engadin.ch_m40_+3",0,"^https?://(www\\.)?maps\\.engadin\\.ch/|^https?://(www\\.)?outdoor\\.glarnerland\\.ch/|^https?://(www\\.)?altenberg\\.de/|^https?://(www\\.)?tourenplaner-rheinland-pfalz\\.de/",10,[],[{"e":2414}],[{"v":2414}],[{"wait":500},{"c":2414}],[{"timeout":1000,"check":"none","wv":2414}],{}],[1,"auto_CH_mein-kraeuterkeller.de_zjh",0,"^https?://(www\\.)?mein-kraeuterkeller\\.de/",10,[],[{"e":2451}],[{"v":2451}],[{"wait":500},{"c":2451}],[{"timeout":1000,"check":"none","wv":2451}],{}],[1,"auto_CH_meintiptopf.ch_84l",0,"^https?://(www\\.)?meintiptopf\\.ch/",10,[],[{"e":2452}],[{"v":2452}],[{"wait":500},{"c":2452}],[{"timeout":1000,"check":"none","wv":2452}],{}],[1,"auto_CH_mio.se_hd0",0,"^https?://(www\\.)?mio\\.se/",10,[],[{"e":2453}],[{"v":2453}],[{"wait":500},{"c":2453}],[{"timeout":1000,"check":"none","wv":2453}],{}],[1,"auto_CH_mrporter.com_0nl_+1",0,"^https?://(www\\.)?mrporter\\.com/|^https?://(www\\.)?net-a-porter\\.com/",10,[],[{"e":2454}],[{"v":2454}],[{"wait":500},{"c":2454}],[{"timeout":1000,"check":"none","wv":2454}],{}],[1,"auto_CH_platform.openai.com_g5y",0,"^https?://(www\\.)?platform\\.openai\\.com/",10,[],[{"e":2455}],[{"v":2455}],[{"wait":500},{"c":2455}],[{"timeout":1000,"check":"none","wv":2455}],{}],[1,"auto_CH_pmphotomedia.ch_ume",0,"^https?://(www\\.)?pmphotomedia\\.ch/",10,[],[{"e":2456}],[{"v":2456}],[{"wait":500},{"c":2456}],[{"timeout":1000,"check":"none","wv":2456}],{}],[1,"auto_CH_radio1.ch_1v2",0,"^https?://(www\\.)?radio1\\.ch/",10,[],[{"e":2457}],[{"v":2457}],[{"wait":500},{"c":2457}],[{"timeout":1000,"check":"none","wv":2457}],{}],[1,"auto_CH_renens.ch_2uc",0,"^https?://(www\\.)?renens\\.ch/",10,[],[{"e":2458}],[{"v":2458}],[{"wait":500},{"c":2458}],[{"timeout":1000,"check":"none","wv":2458}],{}],[1,"auto_CH_sac-uto.ch_3gu",0,"^https?://(www\\.)?sac-uto\\.ch/",10,[],[{"e":2459}],[{"v":2459}],[{"wait":500},{"c":2459}],[{"timeout":1000,"check":"none","wv":2459}],{}],[1,"auto_CH_seetickets.com_4b2",0,"^https?://(www\\.)?seetickets\\.com/",10,[],[{"e":2460}],[{"v":2460}],[{"wait":500},{"c":2460}],[{"timeout":1000,"check":"none","wv":2460}],{}],[1,"auto_CH_sparkasse.de_lwr",0,"^https?://(www\\.)?sparkasse\\.de/",10,[],[{"e":2461}],[{"v":2461}],[{"wait":500},{"c":2461}],[{"timeout":1000,"check":"none","wv":2461}],{}],[1,"auto_CH_sva-bl.ch_h2k_+1",0,"^https?://(www\\.)?sva-bl\\.ch/|^https?://(www\\.)?uni-bremen\\.de/",10,[],[{"e":2462}],[{"v":2462}],[{"wait":500},{"c":2462}],[{"timeout":1000,"check":"none","wv":2462}],{}],[1,"auto_CH_transn.ch_ygb",0,"^https?://(www\\.)?transn\\.ch/",10,[],[{"e":2463}],[{"v":2463}],[{"wait":500},{"c":2463}],[{"timeout":1000,"check":"none","wv":2463}],{}],[1,"auto_CH_ubs-kidscup.ch_5oc",0,"^https?://(www\\.)?ubs-kidscup\\.ch/",10,[],[{"e":2464}],[{"v":2464}],[{"wait":500},{"c":2464}],[{"timeout":1000,"check":"none","wv":2464}],{}],[1,"auto_CH_velofactory.ch_tpq",0,"^https?://(www\\.)?velofactory\\.ch/",10,[],[{"e":2465}],[{"v":2465}],[{"wait":500},{"c":2465}],[{"timeout":1000,"check":"none","wv":2465}],{}],[1,"auto_DE_116117-termine.de_nwg",0,"^https?://(www\\.)?116117-termine\\.de/",10,[],[{"e":2466}],[{"v":2466}],[{"wait":500},{"c":2466}],[{"timeout":1000,"check":"none","wv":2466}],{}],[1,"auto_DE_6relax.de_na9",0,"^https?://(www\\.)?6relax\\.de/",10,[],[{"e":2467}],[{"v":2467}],[{"wait":500},{"c":2467}],[{"timeout":1000,"check":"none","wv":2467}],{}],[1,"auto_DE_accio.com_kdu",0,"^https?://(www\\.)?accio\\.com/",10,[],[{"e":2468}],[{"v":2468}],[{"wait":500},{"c":2468}],[{"timeout":1000,"check":"none","wv":2468}],{}],[1,"auto_DE_aerztekammer-bw.de_rse",0,"^https?://(www\\.)?aerztekammer-bw\\.de/",10,[],[{"e":2469}],[{"v":2469}],[{"wait":500},{"c":2469}],[{"timeout":1000,"check":"none","wv":2469}],{}],[1,"auto_DE_afd.de_tad",0,"^https?://(www\\.)?afd\\.de/",10,[],[{"e":2470}],[{"v":2470}],[{"wait":500},{"c":2470}],[{"timeout":1000,"check":"none","wv":2470}],{}],[1,"auto_DE_aknw.de_wcz_+1",0,"^https?://(www\\.)?aknw\\.de/|^https?://(www\\.)?regioentsorgung\\.de/",10,[],[{"e":2471}],[{"v":2471}],[{"wait":500},{"c":2471}],[{"timeout":1000,"check":"none","wv":2471}],{}],[1,"auto_DE_all-inkl.com_toh",0,"^https?://(www\\.)?all-inkl\\.com/",10,[],[{"e":2472}],[{"v":2472}],[{"wait":500},{"c":2472}],[{"timeout":1000,"check":"none","wv":2472}],{}],[1,"auto_DE_almenrausch.at_c6z",0,"^https?://(www\\.)?almenrausch\\.at/",10,[],[{"e":2473}],[{"v":2473}],[{"wait":500},{"c":2473}],[{"timeout":1000,"check":"none","wv":2473}],{}],[1,"auto_DE_alza.de_iq3",0,"^https?://(www\\.)?alza\\.de/",10,[],[{"e":2474}],[{"v":2474}],[{"wait":500},{"c":2474}],[{"timeout":1000,"check":"none","wv":2474}],{}],[1,"auto_DE_ancestry.com_k1k",0,"^https?://(www\\.)?ancestry\\.com/",10,[],[{"e":2475}],[{"v":2475}],[{"wait":500},{"c":2475}],[{"timeout":1000,"check":"none","wv":2475}],{}],[1,"auto_DE_apozilla.de_d1h",0,"^https?://(www\\.)?apozilla\\.de/",10,[],[{"e":2476}],[{"v":2476}],[{"wait":500},{"c":2476}],[{"timeout":1000,"check":"none","wv":2476}],{}],[1,"auto_DE_ardplus.de_ue3",0,"^https?://(www\\.)?ardplus\\.de/",10,[],[{"e":2477}],[{"v":2477}],[{"wait":500},{"c":2477}],[{"timeout":1000,"check":"none","wv":2477}],{}],[1,"auto_DE_axa.de_vyk",0,"^https?://(www\\.)?axa\\.de/",10,[],[{"e":2478}],[{"v":2478}],[{"wait":500},{"c":2478}],[{"timeout":1000,"check":"none","wv":2478}],{}],[1,"auto_DE_backmarket.de_dzf",0,"^https?://(www\\.)?backmarket\\.de/",10,[],[{"e":2479}],[{"v":2479}],[{"wait":500},{"c":2479}],[{"timeout":1000,"check":"none","wv":2479}],{}],[1,"auto_DE_bbbank.de_dcf_+15",0,"^https?://(www\\.)?bbbank\\.de/|^https?://(www\\.)?diebank\\.de/|^https?://(www\\.)?genobroker\\.de/|^https?://(www\\.)?ligabank\\.de/|^https?://(www\\.)?pax-bkc\\.de/|^https?://(www\\.)?psd-berlin-brandenburg\\.de/|^https?://(www\\.)?psd-nuernberg\\.de/|^https?://(www\\.)?sparda-bank-hamburg\\.de/|^https?://(www\\.)?sparda-h\\.de/|^https?://(www\\.)?sparda-n\\.de/|^https?://(www\\.)?v-mn\\.de/|^https?://(www\\.)?vr-bayernmitte\\.de/|^https?://(www\\.)?vrbank-brs\\.de/|^https?://(www\\.)?vrbank-eg\\.de/|^https?://(www\\.)?vrbank-lb\\.de/|^https?://(www\\.)?wvb\\.de/",10,[],[{"e":2480}],[{"v":2480}],[{"wait":500},{"c":2480}],[{"timeout":1000,"check":"none","wv":2480}],{}],[1,"auto_DE_biunsinnorden.de_kwa_+1",0,"^https?://(www\\.)?biunsinnorden\\.de/|^https?://(www\\.)?livegigs\\.de/",10,[],[{"e":2481}],[{"v":2481}],[{"wait":500},{"c":2481}],[{"timeout":1000,"check":"none","wv":2481}],{}],[1,"auto_DE_bmz.de_nss",0,"^https?://(www\\.)?bmz\\.de/",10,[],[{"e":2482}],[{"v":2482}],[{"wait":500},{"c":2482}],[{"timeout":1000,"check":"none","wv":2482}],{}],[1,"auto_DE_buerklin.com_bya",0,"^https?://(www\\.)?buerklin\\.com/",10,[],[{"e":2427}],[{"v":2427}],[{"wait":500},{"c":2427}],[{"timeout":1000,"check":"none","wv":2427}],{}],[1,"auto_DE_bundeswehrkarriere.de_g9g",0,"^https?://(www\\.)?bundeswehrkarriere\\.de/",10,[],[{"e":2483}],[{"v":2483}],[{"wait":500},{"c":2483}],[{"timeout":1000,"check":"none","wv":2483}],{}],[1,"auto_DE_byak.de_dcj",0,"^https?://(www\\.)?byak\\.de/",10,[],[{"e":2484}],[{"v":2484}],[{"wait":500},{"c":2484}],[{"timeout":1000,"check":"none","wv":2484}],{}],[1,"auto_DE_byte.fm_83l",0,"^https?://(www\\.)?byte\\.fm/",10,[],[{"e":2485}],[{"v":2485}],[{"wait":500},{"c":2485}],[{"timeout":1000,"check":"none","wv":2485}],{}],[1,"auto_DE_camping-outdoorshop.de_oo4_+1",0,"^https?://(www\\.)?camping-outdoorshop\\.de/|^https?://(www\\.)?elektro-wandelt\\.de/",10,[],[{"e":2473}],[{"v":2473}],[{"wait":500},{"c":2473}],[{"timeout":1000,"check":"none","wv":2473}],{}],[1,"auto_DE_club.auto-doc.at_6xj",0,"^https?://(www\\.)?club\\.auto-doc\\.at/",10,[],[{"e":2486}],[{"v":2486}],[{"wait":500},{"c":2486}],[{"timeout":1000,"check":"none","wv":2486}],{}],[1,"auto_DE_daad.de_w45",0,"^https?://(www\\.)?daad\\.de/",10,[],[{"e":2487}],[{"v":2487}],[{"wait":500},{"c":2487}],[{"timeout":1000,"check":"none","wv":2487}],{}],[1,"auto_DE_das-ist-drin.de_e12",0,"^https?://(www\\.)?das-ist-drin\\.de/",10,[],[{"e":2488}],[{"v":2488}],[{"wait":500},{"c":2488}],[{"timeout":1000,"check":"none","wv":2488}],{}],[1,"auto_DE_de.accio.com_97o",0,"^https?://(www\\.)?de\\.accio\\.com/",10,[],[{"e":2468}],[{"v":2468}],[{"wait":500},{"c":2468}],[{"timeout":1000,"check":"none","wv":2468}],{}],[1,"auto_DE_de.artprice.com_kfk",0,"^https?://(www\\.)?de\\.artprice\\.com/",10,[],[{"e":2489}],[{"v":2489}],[{"wait":500},{"c":2489}],[{"timeout":1000,"check":"none","wv":2489}],{}],[1,"auto_DE_de.nothing.tech_0fr_+1",0,"^https?://(www\\.)?de\\.nothing\\.tech/|^https?://(www\\.)?nothing\\.tech/",10,[],[{"e":2490}],[{"v":2490}],[{"wait":500},{"c":2490}],[{"timeout":1000,"check":"none","wv":2490}],{}],[1,"auto_DE_dekra.de_qrb",0,"^https?://(www\\.)?dekra\\.de/",10,[],[{"e":2491}],[{"v":2491}],[{"wait":500},{"c":2491}],[{"timeout":1000,"check":"none","wv":2491}],{}],[1,"auto_DE_edelstahl-tuerklingel.de_375",0,"^https?://(www\\.)?edelstahl-tuerklingel\\.de/",10,[],[{"e":2492}],[{"v":2492}],[{"wait":500},{"c":2492}],[{"timeout":1000,"check":"none","wv":2492}],{}],[1,"auto_DE_eezy.nrw_9aj",0,"^https?://(www\\.)?eezy\\.nrw/",10,[],[{"e":2493}],[{"v":2493}],[{"wait":500},{"c":2493}],[{"timeout":1000,"check":"none","wv":2493}],{}],[1,"auto_DE_ernstings-family.de_xqf",0,"^https?://(www\\.)?ernstings-family\\.de/",10,[],[{"e":2494}],[{"v":2494}],[{"wait":500},{"c":2494}],[{"timeout":1000,"check":"none","wv":2494}],{}],[1,"auto_DE_fcbinside.de_0d6",0,"^https?://(www\\.)?fcbinside\\.de/",10,[],[{"e":2495}],[{"v":2495}],[{"wait":500},{"c":2495}],[{"timeout":1000,"check":"none","wv":2495}],{}],[1,"auto_DE_feierabend.de_kr4",0,"^https?://(www\\.)?feierabend\\.de/",10,[],[{"e":2496}],[{"v":2496}],[{"wait":500},{"c":2496}],[{"timeout":1000,"check":"none","wv":2496}],{}],[1,"auto_DE_feser-graf.de_qz8",0,"^https?://(www\\.)?feser-graf\\.de/",10,[],[{"e":2497}],[{"v":2497}],[{"wait":500},{"c":2497}],[{"timeout":1000,"check":"none","wv":2497}],{}],[1,"auto_DE_finanzpartner.de_13s",0,"^https?://(www\\.)?finanzpartner\\.de/",10,[],[{"e":2498}],[{"v":2498}],[{"wait":500},{"c":2498}],[{"timeout":1000,"check":"none","wv":2498}],{}],[1,"auto_DE_gasometer.de_0xw",0,"^https?://(www\\.)?gasometer\\.de/",10,[],[{"e":2499}],[{"v":2499}],[{"wait":500},{"c":2499}],[{"timeout":1000,"check":"none","wv":2499}],{}],[1,"auto_DE_hermoney.de_jsi",0,"^https?://(www\\.)?hermoney\\.de/",10,[],[{"e":2500}],[{"v":2500}],[{"wait":500},{"c":2500}],[{"timeout":1000,"check":"none","wv":2500}],{}],[1,"auto_DE_hilfe.kleinanzeigen.de_44a_+1",0,"^https?://(www\\.)?hilfe\\.kleinanzeigen\\.de/|^https?://(www\\.)?themen\\.kleinanzeigen\\.de/",10,[],[{"e":2501}],[{"v":2501}],[{"wait":500},{"c":2501}],[{"timeout":1000,"check":"none","wv":2501}],{}],[1,"auto_DE_howik.com_99g",0,"^https?://(www\\.)?howik\\.com/",10,[],[{"e":2502}],[{"v":2502}],[{"wait":500},{"c":2502}],[{"timeout":1000,"check":"none","wv":2502}],{}],[1,"auto_DE_hu-berlin.de_sk6",0,"^https?://(www\\.)?hu-berlin\\.de/",10,[],[{"e":2503}],[{"v":2503}],[{"wait":500},{"c":2503}],[{"timeout":1000,"check":"none","wv":2503}],{}],[1,"auto_DE_imd-berlin.de_6m1",0,"^https?://(www\\.)?imd-berlin\\.de/",10,[],[{"e":2504}],[{"v":2504}],[{"wait":500},{"c":2504}],[{"timeout":1000,"check":"none","wv":2504}],{}],[1,"auto_DE_immobilien.sparkasse.de_zj7",0,"^https?://(www\\.)?immobilien\\.sparkasse\\.de/",10,[2505],[{"e":2506}],[{"v":2506}],[{"c":2507}],[{"timeout":1000,"check":"none","wv":2506}],{}],[1,"auto_DE_impfen-info.de_am5_+1",0,"^https?://(www\\.)?impfen-info\\.de/|^https?://(www\\.)?infektionsschutz\\.de/",10,[],[{"e":2508}],[{"v":2508}],[{"wait":500},{"c":2508}],[{"timeout":1000,"check":"none","wv":2508}],{}],[1,"auto_DE_jobvector.de_641",0,"^https?://(www\\.)?jobvector\\.de/",10,[],[{"e":2509}],[{"v":2509}],[{"wait":500},{"c":2509}],[{"timeout":1000,"check":"none","wv":2509}],{}],[1,"auto_DE_kinsta.com_hc5",0,"^https?://(www\\.)?kinsta\\.com/",10,[],[{"e":2510}],[{"v":2510}],[{"wait":500},{"c":2510}],[{"timeout":1000,"check":"none","wv":2510}],{}],[1,"auto_DE_kleineskraftwerk.de_fx7",0,"^https?://(www\\.)?kleineskraftwerk\\.de/",10,[],[{"e":2511}],[{"v":2511}],[{"wait":500},{"c":2511}],[{"timeout":1000,"check":"none","wv":2511}],{}],[1,"auto_DE_kundenportal.m-net.de_y8l",0,"^https?://(www\\.)?kundenportal\\.m-net\\.de/",10,[],[{"e":2461}],[{"v":2461}],[{"wait":500},{"c":2461}],[{"timeout":1000,"check":"none","wv":2461}],{}],[1,"auto_DE_kvhb.de_hhf",0,"^https?://(www\\.)?kvhb\\.de/",10,[],[{"e":2512}],[{"v":2512}],[{"wait":500},{"c":2512}],[{"timeout":1000,"check":"none","wv":2512}],{}],[1,"auto_DE_la.spankbang.com_sva",0,"^https?://(www\\.)?la\\.spankbang\\.com/",10,[],[{"e":2513}],[{"v":2513}],[{"wait":500},{"c":2513}],[{"timeout":1000,"check":"none","wv":2513}],{}],[1,"auto_DE_lbs.de_6zt",0,"^https?://(www\\.)?lbs\\.de/",10,[],[{"e":2514}],[{"v":2514}],[{"wait":500},{"c":2514}],[{"timeout":1000,"check":"none","wv":2514}],{}],[1,"auto_DE_lenovo.com_xcv",0,"^https?://(www\\.)?lenovo\\.com/",10,[],[{"e":2515}],[{"v":2515}],[{"wait":500},{"c":2515}],[{"timeout":1000,"check":"none","wv":2515}],{}],[1,"auto_DE_listando.de_c5i",0,"^https?://(www\\.)?listando\\.de/",10,[],[{"e":2516}],[{"v":2516}],[{"wait":500},{"c":2516}],[{"timeout":1000,"check":"none","wv":2516}],{}],[1,"auto_DE_lite-magazin.de_e1s",0,"^https?://(www\\.)?lite-magazin\\.de/",10,[],[{"e":2517}],[{"v":2517}],[{"wait":500},{"c":2517}],[{"timeout":1000,"check":"none","wv":2517}],{}],[1,"auto_DE_m.livejasmin.com_cvg",0,"^https?://(www\\.)?livejasmin\\.com/",10,[],[{"e":2518}],[{"v":2518}],[{"wait":500},{"c":2518}],[{"timeout":1000,"check":"none","wv":2518}],{}],[1,"auto_DE_mhplus-krankenkasse.de_4xb",0,"^https?://(www\\.)?mhplus-krankenkasse\\.de/",10,[],[{"e":2473}],[{"v":2473}],[{"wait":500},{"c":2473}],[{"timeout":1000,"check":"none","wv":2473}],{}],[1,"auto_DE_mitarbeiterservice.bayern.de_quh",0,"^https?://(www\\.)?mitarbeiterservice\\.bayern\\.de/",10,[],[{"e":2519}],[{"v":2519}],[{"wait":500},{"c":2519}],[{"timeout":1000,"check":"none","wv":2519}],{}],[1,"auto_DE_mrmarvis.com_bo5",0,"^https?://(www\\.)?mrmarvis\\.com/",10,[],[{"e":2520}],[{"v":2520}],[{"wait":500},{"c":2520}],[{"timeout":1000,"check":"none","wv":2520}],{}],[1,"auto_DE_originalteile.mercedes-benz.de_tce",0,"^https?://(www\\.)?originalteile\\.mercedes-benz\\.de/",10,[],[{"e":2521}],[{"v":2521}],[{"wait":500},{"c":2521}],[{"timeout":1000,"check":"none","wv":2521}],{}],[1,"auto_DE_parqet.com_6wm",0,"^https?://(www\\.)?parqet\\.com/",10,[],[{"e":2522}],[{"v":2522}],[{"wait":500},{"c":2522}],[{"timeout":1000,"check":"none","wv":2522}],{}],[1,"auto_DE_pflanzenhof-online.de_au2",0,"^https?://(www\\.)?pflanzenhof-online\\.de/",10,[],[{"e":2523}],[{"v":2523}],[{"wait":500},{"c":2523}],[{"timeout":1000,"check":"none","wv":2523}],{}],[1,"auto_DE_polizei.hessen.de_rsx",0,"^https?://(www\\.)?polizei\\.hessen\\.de/",10,[],[{"e":2524}],[{"v":2524}],[{"wait":500},{"c":2524}],[{"timeout":1000,"check":"none","wv":2524}],{}],[1,"auto_DE_regierung.oberbayern.bayern.de_zx2_+2",0,"^https?://(www\\.)?regierung\\.oberbayern\\.bayern\\.de/|^https?://(www\\.)?statistik\\.bayern\\.de/|^https?://(www\\.)?stmb\\.bayern\\.de/",10,[],[{"e":2525}],[{"v":2525}],[{"wait":500},{"c":2525}],[{"timeout":1000,"check":"none","wv":2525}],{}],[1,"auto_DE_roller.de_pjo",0,"^https?://(www\\.)?roller\\.de/",10,[],[{"e":2526}],[{"v":2526}],[{"wait":500},{"c":2526}],[{"timeout":1000,"check":"none","wv":2526}],{}],[1,"auto_DE_rundfunkbeitrag.de_g4y",0,"^https?://(www\\.)?rundfunkbeitrag\\.de/",10,[],[{"e":2527}],[{"v":2527}],[{"wait":500},{"c":2527}],[{"timeout":1000,"check":"none","wv":2527}],{}],[1,"auto_DE_schwabach.de_fjr",0,"^https?://(www\\.)?schwabach\\.de/",10,[],[{"e":2528}],[{"v":2528}],[{"wait":500},{"c":2528}],[{"timeout":1000,"check":"none","wv":2528}],{}],[1,"auto_DE_schwaebisch-hall.de_0g1",0,"^https?://(www\\.)?schwaebisch-hall\\.de/",10,[],[{"e":2529}],[{"v":2529}],[{"wait":500},{"c":2529}],[{"timeout":1000,"check":"none","wv":2529}],{}],[1,"auto_DE_sellercentral.amazon.de_xi0",0,"^https?://(www\\.)?sellercentral\\.amazon\\.de/",10,[],[{"e":2530}],[{"v":2530}],[{"wait":500},{"c":2530}],[{"timeout":1000,"check":"none","wv":2530}],{}],[1,"auto_DE_sephora.de_exg",0,"^https?://(www\\.)?sephora\\.de/",10,[],[{"e":2454}],[{"v":2454}],[{"wait":500},{"c":2454}],[{"timeout":1000,"check":"none","wv":2454}],{}],[1,"auto_DE_solarspeicher24.de_w5k",0,"^https?://(www\\.)?solarspeicher24\\.de/",10,[],[{"e":2531}],[{"v":2531}],[{"wait":500},{"c":2531}],[{"timeout":1000,"check":"none","wv":2531}],{}],[1,"auto_DE_speedtest.vodafone.de_dha",0,"^https?://(www\\.)?speedtest\\.vodafone\\.de/",10,[],[{"e":2532}],[{"v":2532}],[{"wait":500},{"c":2532}],[{"timeout":1000,"check":"none","wv":2532}],{}],[1,"auto_DE_steeltoyz.de_i51",0,"^https?://(www\\.)?steeltoyz\\.de/",10,[],[{"e":2533}],[{"v":2533}],[{"wait":500},{"c":2533}],[{"timeout":1000,"check":"none","wv":2533}],{}],[1,"auto_DE_survival-kompass.de_kv6",0,"^https?://(www\\.)?survival-kompass\\.de/",10,[],[{"e":2534}],[{"v":2534}],[{"wait":500},{"c":2534}],[{"timeout":1000,"check":"none","wv":2534}],{}],[1,"auto_DE_typografie.info_mnj",0,"^https?://(www\\.)?typografie\\.info/",10,[],[{"e":2535}],[{"v":2535}],[{"wait":500},{"c":2535}],[{"timeout":1000,"check":"none","wv":2535}],{}],[1,"auto_DE_uni-hildesheim.de_7kj",0,"^https?://(www\\.)?uni-hildesheim\\.de/",10,[],[{"e":2536}],[{"v":2536}],[{"wait":500},{"c":2536}],[{"timeout":1000,"check":"none","wv":2536}],{}],[1,"auto_DE_uni-mannheim.de_omi",0,"^https?://(www\\.)?uni-mannheim\\.de/",10,[],[{"e":2537}],[{"v":2537}],[{"wait":500},{"c":2537}],[{"timeout":1000,"check":"none","wv":2537}],{}],[1,"auto_DE_variete.de_6cc",0,"^https?://(www\\.)?variete\\.de/",10,[],[{"e":2538}],[{"v":2538}],[{"wait":500},{"c":2538}],[{"timeout":1000,"check":"none","wv":2538}],{}],[1,"auto_DE_wien.gv.at_mm2",0,"^https?://(www\\.)?wien\\.gv\\.at/",10,[],[{"e":2539}],[{"v":2539}],[{"wait":500},{"c":2539}],[{"timeout":1000,"check":"none","wv":2539}],{}],[1,"auto_DE_wolt.com_jyq",0,"^https?://(www\\.)?wolt\\.com/",10,[],[{"e":2540}],[{"v":2540}],[{"wait":500},{"c":2540}],[{"timeout":1000,"check":"none","wv":2540}],{}],[1,"auto_FR_3ds.com_pa7",0,"^https?://(www\\.)?3ds\\.com/",10,[],[{"e":2541}],[{"v":2541}],[{"wait":500},{"c":2541}],[{"timeout":1000,"check":"none","wv":2541}],{}],[1,"auto_FR_aefinfo.fr_6r7",0,"^https?://(www\\.)?aefinfo\\.fr/",10,[],[{"e":2542}],[{"v":2542}],[{"wait":500},{"c":2542}],[{"timeout":1000,"check":"none","wv":2542}],{}],[1,"auto_FR_alinea.com_d9k",0,"^https?://(www\\.)?alinea\\.com/",10,[],[{"e":2543}],[{"v":2543}],[{"wait":500},{"c":2543}],[{"timeout":1000,"check":"none","wv":2543}],{}],[1,"auto_FR_alinea.com_gst",0,"^https?://(www\\.)?alinea\\.com/",10,[],[{"e":2544}],[{"v":2544}],[{"wait":500},{"c":2544}],[{"timeout":1000,"check":"none","wv":2544}],{}],[1,"auto_FR_annuaire-inverse-france.com_4oi",0,"^https?://(www\\.)?annuaire-inverse-france\\.com/",10,[],[{"e":2545}],[{"v":2545}],[{"wait":500},{"c":2545}],[{"timeout":1000,"check":"none","wv":2545}],{}],[1,"auto_FR_asp.gouv.fr_ytt",0,"^https?://(www\\.)?asp\\.gouv\\.fr/",10,[],[{"e":2546}],[{"v":2546}],[{"wait":500},{"c":2546}],[{"timeout":1000,"check":"none","wv":2546}],{}],[1,"auto_FR_bd-adultes.com_nn2",0,"^https?://(www\\.)?bd-adultes\\.com/",10,[],[{"e":2547}],[{"v":2547}],[{"wait":500},{"c":2547}],[{"timeout":1000,"check":"none","wv":2547}],{}],[1,"auto_FR_bobvoyeur.com_qm5",0,"^https?://(www\\.)?bobvoyeur\\.com/",10,[],[{"e":2548}],[{"v":2548}],[{"wait":500},{"c":2548}],[{"timeout":1000,"check":"none","wv":2548}],{}],[1,"auto_FR_bpi.fr_l52",0,"^https?://(www\\.)?bpi\\.fr/",10,[],[{"e":2403}],[{"v":2403}],[{"wait":500},{"c":2403}],[{"timeout":1000,"check":"none","wv":2403}],{}],[1,"auto_FR_chamrousse.com_i7u",0,"^https?://(www\\.)?chamrousse\\.com/",10,[],[{"e":2549}],[{"v":2549}],[{"wait":500},{"c":2549}],[{"timeout":1000,"check":"none","wv":2549}],{}],[1,"auto_FR_charliehebdo.fr_smr",0,"^https?://(www\\.)?charliehebdo\\.fr/",10,[],[{"e":2550}],[{"v":2550}],[{"wait":500},{"c":2550}],[{"timeout":1000,"check":"none","wv":2550}],{}],[1,"auto_FR_cite-sciences.fr_kcx",0,"^https?://(www\\.)?cite-sciences\\.fr/",10,[],[{"e":2551}],[{"v":2551}],[{"wait":500},{"c":2551}],[{"timeout":1000,"check":"none","wv":2551}],{}],[1,"auto_FR_coe.int_cfo",0,"^https?://(www\\.)?coe\\.int/",10,[],[{"e":2552}],[{"v":2552}],[{"wait":500},{"c":2552}],[{"timeout":1000,"check":"none","wv":2552}],{}],[1,"auto_FR_coutellerie-tourangelle.com_rcf",0,"^https?://(www\\.)?coutellerie-tourangelle\\.com/",10,[],[{"e":2553}],[{"v":2553}],[{"wait":500},{"c":2553}],[{"timeout":1000,"check":"none","wv":2553}],{}],[1,"auto_FR_cre.fr_sd4",0,"^https?://(www\\.)?cre\\.fr/",10,[],[{"e":2554}],[{"v":2554}],[{"wait":500},{"c":2554}],[{"timeout":1000,"check":"none","wv":2554}],{}],[1,"auto_FR_cybevasion.fr_jjp",0,"^https?://(www\\.)?cybevasion\\.fr/",10,[],[{"e":2428}],[{"v":2428}],[{"wait":500},{"c":2428}],[{"timeout":1000,"check":"none","wv":2428}],{}],[1,"auto_FR_edumoov.com_sij",0,"^https?://(www\\.)?edumoov\\.com/",10,[],[{"e":2555}],[{"v":2555}],[{"wait":500},{"c":2555}],[{"timeout":1000,"check":"none","wv":2555}],{}],[1,"auto_FR_engie-homeservices.fr_lyo",0,"^https?://(www\\.)?engie-homeservices\\.fr/",10,[],[{"e":2556}],[{"v":2556}],[{"wait":500},{"c":2556}],[{"timeout":1000,"check":"none","wv":2556}],{}],[1,"auto_FR_es.xhamster.com_f69",0,"^https?://(www\\.)?es\\.xhamster\\.com/",10,[],[{"e":2557}],[{"v":2557}],[{"wait":500},{"c":2557}],[{"timeout":1000,"check":"none","wv":2557}],{}],[1,"auto_FR_euro-expos.com_tok",0,"^https?://(www\\.)?euro-expos\\.com/",10,[],[{"e":2558}],[{"v":2558}],[{"wait":500},{"c":2558}],[{"timeout":1000,"check":"none","wv":2558}],{}],[1,"auto_FR_fr.accio.com_zdn",0,"^https?://(www\\.)?fr\\.accio\\.com/",10,[],[{"e":2468}],[{"v":2468}],[{"wait":500},{"c":2468}],[{"timeout":1000,"check":"none","wv":2468}],{}],[1,"auto_FR_fr.xgimi.com_fzb_+1",0,"^https?://(www\\.)?fr\\.xgimi\\.com/|^https?://(www\\.)?leminor\\.fr/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_FR_glamuse.com_n32",0,"^https?://(www\\.)?glamuse\\.com/",10,[],[{"e":2559}],[{"v":2559}],[{"wait":500},{"c":2559}],[{"timeout":1000,"check":"none","wv":2559}],{}],[1,"auto_FR_gmf.fr_pxt",0,"^https?://(www\\.)?gmf\\.fr/",10,[],[{"e":2560}],[{"v":2560}],[{"wait":500},{"c":2560}],[{"timeout":1000,"check":"none","wv":2560}],{}],[1,"auto_FR_gov.br_n2f",0,"^https?://(www\\.)?gov\\.br/",10,[],[{"e":2561}],[{"v":2561}],[{"wait":500},{"c":2561}],[{"timeout":1000,"check":"none","wv":2561}],{}],[1,"auto_FR_greengo.voyage_fg3",0,"^https?://(www\\.)?greengo\\.voyage/",10,[],[{"e":2562}],[{"v":2562}],[{"wait":500},{"c":2562}],[{"timeout":1000,"check":"none","wv":2562}],{}],[1,"auto_FR_haproxy.com_arh",0,"^https?://(www\\.)?haproxy\\.com/",10,[],[{"e":2563}],[{"v":2563}],[{"wait":500},{"c":2563}],[{"timeout":1000,"check":"none","wv":2563}],{}],[1,"auto_FR_interencheres.com_c67",0,"^https?://(www\\.)?interencheres\\.com/",10,[],[{"e":2558}],[{"v":2558}],[{"wait":500},{"c":2558}],[{"timeout":1000,"check":"none","wv":2558}],{}],[1,"auto_FR_ita.xhamster.com_jhk",0,"^https?://(www\\.)?ita\\.xhamster\\.com/",10,[],[{"e":2557}],[{"v":2557}],[{"wait":500},{"c":2557}],[{"timeout":1000,"check":"none","wv":2557}],{}],[1,"auto_FR_kobo.com_ajz",0,"^https?://(www\\.)?kobo\\.com/",10,[],[{"e":2564}],[{"v":2564}],[{"wait":500},{"c":2564}],[{"timeout":1000,"check":"none","wv":2564}],{}],[1,"auto_FR_lalibrairie.com_0lt",0,"^https?://(www\\.)?lalibrairie\\.com/",10,[],[{"e":2565}],[{"v":2565}],[{"wait":500},{"c":2565}],[{"timeout":1000,"check":"none","wv":2565}],{}],[1,"auto_FR_leclercvoyages.com_2o4",0,"^https?://(www\\.)?leclercvoyages\\.com/",10,[],[{"e":2560}],[{"v":2560}],[{"wait":500},{"c":2560}],[{"timeout":1000,"check":"none","wv":2560}],{}],[1,"auto_FR_lesprosdelapetiteenfance.fr_bng",0,"^https?://(www\\.)?lesprosdelapetiteenfance\\.fr/",10,[],[{"e":2431}],[{"v":2431}],[{"wait":500},{"c":2431}],[{"timeout":1000,"check":"none","wv":2431}],{}],[1,"auto_FR_ludum.fr_gl5",0,"^https?://(www\\.)?ludum\\.fr/",10,[],[{"e":2566}],[{"v":2566}],[{"wait":500},{"c":2566}],[{"timeout":1000,"check":"none","wv":2566}],{}],[1,"auto_FR_maboussoleaidants.fr_f8f",0,"^https?://(www\\.)?maboussoleaidants\\.fr/",10,[],[{"e":2567}],[{"v":2567}],[{"wait":500},{"c":2567}],[{"timeout":1000,"check":"none","wv":2567}],{}],[1,"auto_FR_magellan-bio.fr_5xr",0,"^https?://(www\\.)?magellan-bio\\.fr/",10,[],[{"e":2568}],[{"v":2568}],[{"wait":500},{"c":2568}],[{"timeout":1000,"check":"none","wv":2568}],{}],[1,"auto_FR_manuels.solutions_3gb",0,"^https?://(www\\.)?manuels\\.solutions/",10,[],[{"e":2569}],[{"v":2569}],[{"wait":500},{"c":2569}],[{"timeout":1000,"check":"none","wv":2569}],{}],[1,"auto_FR_maty.com_2v7",0,"^https?://(www\\.)?maty\\.com/",10,[],[{"e":2461}],[{"v":2461}],[{"wait":500},{"c":2461}],[{"timeout":1000,"check":"none","wv":2461}],{}],[1,"auto_FR_mawaqit.net_0cw",0,"^https?://(www\\.)?mawaqit\\.net/",10,[],[{"e":2570}],[{"v":2570}],[{"wait":500},{"c":2570}],[{"timeout":1000,"check":"none","wv":2570}],{}],[1,"auto_FR_meformerenregion.fr_64b",0,"^https?://(www\\.)?meformerenregion\\.fr/",10,[],[{"e":2571}],[{"v":2571}],[{"wait":500},{"c":2571}],[{"timeout":1000,"check":"none","wv":2571}],{}],[1,"auto_FR_mesinfos.fr_gt2",0,"^https?://(www\\.)?mesinfos\\.fr/",10,[],[{"e":2572}],[{"v":2572}],[{"wait":500},{"c":2572}],[{"timeout":1000,"check":"none","wv":2572}],{}],[1,"auto_FR_naval-group.com_yzx",0,"^https?://(www\\.)?naval-group\\.com/",10,[],[{"e":2431}],[{"v":2431}],[{"wait":500},{"c":2431}],[{"timeout":1000,"check":"none","wv":2431}],{}],[1,"auto_FR_norauto.fr_mbi",0,"^https?://(www\\.)?norauto\\.fr/",10,[],[{"e":2461}],[{"v":2461}],[{"wait":500},{"c":2461}],[{"timeout":1000,"check":"none","wv":2461}],{}],[1,"auto_FR_nouslib.com_1tl",0,"^https?://(www\\.)?nouslib\\.com/",10,[],[{"e":2573}],[{"v":2573}],[{"wait":500},{"c":2573}],[{"timeout":1000,"check":"none","wv":2573}],{}],[1,"auto_FR_oceane.breizhgo.bzh_g7u",0,"^https?://(www\\.)?oceane\\.breizhgo\\.bzh/",10,[],[{"e":2574}],[{"v":2574}],[{"wait":500},{"c":2574}],[{"timeout":1000,"check":"none","wv":2574}],{}],[1,"auto_FR_pfg.fr_j2d_+1",0,"^https?://(www\\.)?pfg\\.fr/|^https?://(www\\.)?pointp\\.fr/",10,[],[{"e":2560}],[{"v":2560}],[{"wait":500},{"c":2560}],[{"timeout":1000,"check":"none","wv":2560}],{}],[1,"auto_FR_picwish.com_l0k",0,"^https?://(www\\.)?picwish\\.com/",10,[],[{"e":2575}],[{"v":2575}],[{"wait":500},{"c":2575}],[{"timeout":1000,"check":"none","wv":2575}],{}],[1,"auto_FR_platform.openai.com_nyz",0,"^https?://(www\\.)?platform\\.openai\\.com/",10,[],[{"e":2576}],[{"v":2576}],[{"wait":500},{"c":2576}],[{"timeout":1000,"check":"none","wv":2576}],{}],[1,"auto_FR_pointdevente.parionssport.fdj.fr_9uh",0,"^https?://(www\\.)?pointdevente\\.parionssport\\.fdj\\.fr/",10,[],[{"e":2514}],[{"v":2514}],[{"wait":500},{"c":2514}],[{"timeout":1000,"check":"none","wv":2514}],{}],[1,"auto_FR_politis.fr_g33",0,"^https?://(www\\.)?politis\\.fr/",10,[],[{"e":2577}],[{"v":2577}],[{"wait":500},{"c":2577}],[{"timeout":1000,"check":"none","wv":2577}],{}],[1,"auto_FR_pretto.fr_kb5",0,"^https?://(www\\.)?pretto\\.fr/",10,[],[{"e":2578}],[{"v":2578}],[{"wait":500},{"c":2578}],[{"timeout":1000,"check":"none","wv":2578}],{}],[1,"auto_FR_privateaser.com_uco",0,"^https?://(www\\.)?privateaser\\.com/",10,[],[{"e":2579}],[{"v":2579}],[{"wait":500},{"c":2579}],[{"timeout":1000,"check":"none","wv":2579}],{}],[1,"auto_FR_pro.inserm.fr_omt",0,"^https?://(www\\.)?pro\\.inserm\\.fr/",10,[],[{"e":2403}],[{"v":2403}],[{"wait":500},{"c":2403}],[{"timeout":1000,"check":"none","wv":2403}],{}],[1,"auto_FR_proantic.com_oyg",0,"^https?://(www\\.)?proantic\\.com/",10,[],[{"e":2580}],[{"v":2580}],[{"wait":500},{"c":2580}],[{"timeout":1000,"check":"none","wv":2580}],{}],[1,"auto_FR_revue-histoire.fr_jex",0,"^https?://(www\\.)?revue-histoire\\.fr/",10,[],[{"e":2581}],[{"v":2581}],[{"wait":500},{"c":2581}],[{"timeout":1000,"check":"none","wv":2581}],{}],[1,"auto_FR_rhinoshield.fr_k5l",0,"^https?://(www\\.)?rhinoshield\\.fr/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_FR_sephora.fr_k3l",0,"^https?://(www\\.)?sephora\\.fr/",10,[],[{"e":2454}],[{"v":2454}],[{"wait":500},{"c":2454}],[{"timeout":1000,"check":"none","wv":2454}],{}],[1,"auto_FR_xhamster.desi_pv1_+1",0,"^https?://(www\\.)?xhamster\\.desi/|^https?://(www\\.)?xhamster3\\.com/",10,[],[{"e":2557}],[{"v":2557}],[{"wait":500},{"c":2557}],[{"timeout":1000,"check":"none","wv":2557}],{}],[1,"auto_GB_3djake.uk_0",0,"^https?://(www\\.)?3djake\\.uk/",10,[],[{"e":2582}],[{"v":2582}],[{"c":2582}],[],{}],[1,"auto_GB_actionfraud.org.uk_92k",0,"^https?://(www\\.)?actionfraud\\.org\\.uk/",10,[],[{"e":2583}],[{"v":2583}],[{"wait":500},{"c":2583}],[{"timeout":1000,"check":"none","wv":2583}],{}],[1,"auto_GB_ancestry.com_0",0,"^https?://(www\\.)?ancestry\\.com/",10,[],[{"e":2584}],[{"v":2584}],[{"wait":500},{"c":2584}],[{"timeout":1000,"check":"none","wv":2584}],{}],[1,"auto_GB_arte.tv_0",0,"^https?://(www\\.)?arte\\.tv/",10,[],[{"e":2585}],[{"v":2585}],[{"c":2585}],[],{}],[1,"auto_GB_bensnaturalhealth.co.uk_0",0,"^https?://(www\\.)?bensnaturalhealth\\.co\\.uk/",10,[],[{"e":2586}],[{"v":2586}],[{"c":2586}],[],{}],[1,"auto_GB_bike24.com_0",0,"^https?://(www\\.)?bike24\\.com/",10,[],[{"e":2587}],[{"v":2587}],[{"c":2587}],[],{}],[1,"auto_GB_brazzers.com_0",0,"^https?://(www\\.)?brazzers\\.com/",10,[],[{"e":2588}],[{"v":2588}],[{"c":2588}],[],{}],[1,"auto_GB_bricksandlogic.co.uk_o5o",0,"^https?://(www\\.)?bricksandlogic\\.co\\.uk/",10,[],[{"e":2589}],[{"v":2589}],[{"wait":500},{"c":2589}],[{"timeout":1000,"check":"none","wv":2589}],{}],[1,"auto_GB_brightondome.org_iz9",0,"^https?://(www\\.)?brightondome\\.org/",10,[],[{"e":2590}],[{"v":2590}],[{"wait":500},{"c":2590}],[{"timeout":1000,"check":"none","wv":2590}],{}],[1,"auto_GB_businessclass.com_0",0,"^https?://(www\\.)?businessclass\\.com/",10,[],[{"e":2591}],[{"v":2591}],[{"c":2591}],[],{}],[1,"auto_GB_capcut.com_0",0,"^https?://(www\\.)?capcut\\.com/",10,[],[{"e":2592}],[{"v":2592}],[{"c":2592}],[],{}],[1,"auto_GB_cardmarket.com_oxh",0,"^https?://(www\\.)?cardmarket\\.com/",10,[],[{"e":2593}],[{"v":2593}],[{"wait":500},{"c":2593}],[{"timeout":1000,"check":"none","wv":2593}],{}],[1,"auto_GB_catawiki.com_0",0,"^https?://(www\\.)?catawiki\\.com/",10,[],[{"e":2594}],[{"v":2594}],[{"c":2594}],[],{}],[1,"auto_GB_charlesclinkard.co.uk_0",0,"^https?://(www\\.)?charlesclinkard\\.co\\.uk/",10,[],[{"e":2595}],[{"v":2595}],[{"wait":500},{"c":2595}],[{"timeout":1000,"check":"none","wv":2595}],{}],[1,"auto_GB_chilternseeds.co.uk_0",0,"^https?://(www\\.)?chilternseeds\\.co\\.uk/",10,[],[{"e":2596}],[{"v":2596}],[{"wait":500},{"c":2596}],[{"timeout":1000,"check":"none","wv":2596}],{}],[1,"auto_GB_chrono24.com_0",0,"^https?://(www\\.)?chrono24\\.com/",10,[],[{"e":2597}],[{"v":2597}],[{"c":2597}],[],{}],[1,"auto_GB_cpfc.co.uk_0",0,"^https?://(www\\.)?cpfc\\.co\\.uk/",10,[],[{"e":2598}],[{"v":2598}],[{"c":2598}],[],{}],[1,"auto_GB_deezer.com_0",0,"^https?://(www\\.)?deezer\\.com/",10,[],[{"e":2599}],[{"v":2599}],[{"c":2599}],[],{}],[1,"auto_GB_edinburghcastle.scot_h2e",0,"^https?://(www\\.)?edinburghcastle\\.scot/",10,[],[{"e":2600}],[{"v":2600}],[{"wait":500},{"c":2600}],[{"timeout":1000,"check":"none","wv":2600}],{}],[1,"auto_GB_europarl.europa.eu_0",0,"^https?://(www\\.)?europarl\\.europa\\.eu/",10,[],[{"e":2601}],[{"v":2601}],[{"c":2601}],[],{}],[1,"auto_GB_everysaving.co.uk_38t",0,"^https?://(www\\.)?everysaving\\.co\\.uk/",10,[],[{"e":2602}],[{"v":2602}],[{"c":2602}],[],{}],[1,"auto_GB_ewrc-results.com_y5f",0,"^https?://(www\\.)?ewrc-results\\.com/",10,[],[{"e":2603}],[{"v":2603}],[{"wait":500},{"c":2603}],[{"timeout":1000,"check":"none","wv":2603}],{}],[1,"auto_GB_f6s.com_221",0,"^https?://(www\\.)?f6s\\.com/",10,[],[{"e":2604}],[{"v":2604}],[{"wait":500},{"c":2604}],[{"timeout":1000,"check":"none","wv":2604}],{}],[1,"auto_GB_faphouse.com_0",0,"^https?://(www\\.)?faphouse\\.com/",10,[],[{"e":2605}],[{"v":2605}],[{"c":2605}],[],{}],[1,"auto_GB_farmergracy.co.uk_dl3",0,"^https?://(www\\.)?farmergracy\\.co\\.uk/",10,[],[{"e":2606}],[{"v":2606}],[{"wait":500},{"c":2606}],[{"timeout":1000,"check":"none","wv":2606}],{}],[1,"auto_GB_fca.org.uk_9p9",0,"^https?://(www\\.)?fca\\.org\\.uk/",10,[],[{"e":2607}],[{"v":2607}],[{"wait":500},{"c":2607}],[{"timeout":1000,"check":"none","wv":2607}],{}],[1,"auto_GB_forum.affinity.serif.com_0",0,"^https?://(www\\.)?forum\\.affinity\\.serif\\.com/",10,[],[{"e":2608}],[{"v":2608}],[{"c":2608}],[],{}],[1,"auto_GB_garden4less.co.uk_0",0,"^https?://(www\\.)?garden4less\\.co\\.uk/",10,[],[{"e":2609}],[{"v":2609}],[{"c":2609}],[],{}],[1,"auto_GB_glassesdirect.co.uk_bt9",0,"^https?://(www\\.)?glassesdirect\\.co\\.uk/",10,[],[{"e":2610}],[{"v":2610}],[{"wait":500},{"c":2610}],[{"timeout":1000,"check":"none","wv":2610}],{}],[1,"auto_GB_handbook.fca.org.uk_0",0,"^https?://(www\\.)?handbook\\.fca\\.org\\.uk/",10,[],[{"e":2611}],[{"v":2611}],[{"wait":500},{"c":2611}],[{"timeout":1000,"check":"none","wv":2611}],{}],[1,"auto_GB_historicenvironment.scot_0",0,"^https?://(www\\.)?historicenvironment\\.scot/",10,[],[{"e":2612}],[{"v":2612}],[{"c":2612}],[],{}],[1,"auto_GB_ionos.co.uk_c0a",0,"^https?://(www\\.)?ionos\\.co\\.uk/",10,[],[{"e":2613}],[{"v":2613}],[{"wait":500},{"c":2613}],[{"timeout":1000,"check":"none","wv":2613}],{}],[1,"auto_GB_kick.com_0",0,"^https?://(www\\.)?kick\\.com/",10,[],[{"e":2614}],[{"v":2614}],[{"c":2614}],[],{}],[1,"auto_GB_kinopoisk.ru_0",0,"^https?://(www\\.)?kinopoisk\\.ru/",10,[],[{"e":2615}],[{"v":2615}],[{"wait":500},{"c":2615}],[{"timeout":1000,"check":"none","wv":2615}],{}],[1,"auto_GB_kirklees.gov.uk_0",0,"^https?://(www\\.)?kirklees\\.gov\\.uk/",10,[],[{"e":2616}],[{"v":2616}],[{"c":2616}],[],{}],[1,"auto_GB_lancaster.ac.uk_0",0,"^https?://(www\\.)?lancaster\\.ac\\.uk/",10,[],[{"e":2617}],[{"v":2617}],[{"c":2617}],[],{}],[1,"auto_GB_lustery.com_0",0,"^https?://(www\\.)?lustery\\.com/",10,[],[{"e":2618}],[{"v":2618}],[{"c":2618}],[],{}],[1,"auto_GB_m.yandex.com_0_+2",0,"^https?://(www\\.)?m\\.yandex\\.com/|^https?://(www\\.)?online\\.yandex\\.com/|^https?://(www\\.)?xmlsearch\\.yandex\\.ru/",10,[],[{"e":2619}],[{"v":2619}],[{"text":"Allow essential cookies","c":2619}],[],{}],[1,"auto_GB_mypharmacy.co.uk_0",0,"^https?://(www\\.)?mypharmacy\\.co\\.uk/",10,[],[{"e":2620}],[{"v":2620}],[{"text":"DENY ALL","c":2620}],[],{}],[1,"auto_GB_onestream.co.uk_dpx",0,"^https?://(www\\.)?onestream\\.co\\.uk/",10,[],[{"e":2621}],[{"v":2621}],[{"wait":500},{"c":2621}],[{"timeout":1000,"check":"none","wv":2621}],{}],[1,"auto_GB_outfox.energy_6ux",0,"^https?://(www\\.)?outfox\\.energy/",10,[],[{"e":2622}],[{"v":2622}],[{"wait":500},{"c":2622}],[{"timeout":1000,"check":"none","wv":2622}],{}],[1,"auto_GB_plumbingworld.co.uk_vmi",0,"^https?://(www\\.)?plumbingworld\\.co\\.uk/",10,[],[{"e":2623}],[{"v":2623}],[{"wait":500},{"c":2623}],[{"timeout":1000,"check":"none","wv":2623}],{}],[1,"auto_GB_reading.gov.uk_0",0,"^https?://(www\\.)?reading\\.gov\\.uk/",10,[],[{"e":2624}],[{"v":2624}],[{"wait":500},{"c":2624}],[{"timeout":1000,"check":"none","wv":2624}],{}],[1,"auto_GB_shopify.com_0",0,"^https?://(www\\.)?shopify\\.com/",10,[],[{"e":2625}],[{"v":2625}],[{"c":2625}],[],{}],[1,"auto_GB_sso.passport.yandex.ru_0_+4",0,"^https?://(www\\.)?sso\\.passport\\.yandex\\.ru/|^https?://(www\\.)?translate\\.yandex\\.com/|^https?://(www\\.)?ya\\.ru/|^https?://(www\\.)?yandex\\.com\\.tr/|^https?://(www\\.)?yandex\\.com/",10,[],[{"e":2615}],[{"v":2615}],[{"c":2615}],[],{}],[1,"auto_GB_stoneacre.co.uk_73c",0,"^https?://(www\\.)?stoneacre\\.co\\.uk/",10,[],[{"e":2626}],[{"v":2626}],[{"wait":500},{"c":2626}],[{"timeout":1000,"check":"none","wv":2626}],{}],[1,"auto_GB_supremecourt.uk_0",0,"^https?://(www\\.)?supremecourt\\.uk/",10,[],[{"e":2627}],[{"v":2627}],[{"c":2627}],[{"timeout":1000,"check":"none","wv":2627}],{}],[1,"auto_GB_thebatteryshop.co.uk_0",0,"^https?://(www\\.)?thebatteryshop\\.co\\.uk/",10,[],[{"e":2628}],[{"v":2628}],[{"text":"Reject All","c":2628}],[],{}],[1,"auto_GB_thebushcraftstore.co.uk_0_+1",0,"^https?://(www\\.)?thebushcraftstore\\.co\\.uk/|^https?://(www\\.)?thewoolfactory\\.co\\.uk/",10,[],[{"e":2629}],[{"v":2629}],[{"wait":500},{"c":2629}],[{"timeout":1000,"check":"none","wv":2629}],{}],[1,"auto_GB_trove.scot_xtg",0,"^https?://(www\\.)?trove\\.scot/",10,[],[{"e":2630}],[{"v":2630}],[{"wait":500},{"c":2630}],[{"timeout":1000,"check":"none","wv":2630}],{}],[1,"auto_GB_truecaller.com_0",0,"^https?://(www\\.)?truecaller\\.com/",10,[],[{"e":2631}],[{"v":2631}],[{"c":2631}],[],{}],[1,"auto_GB_vetuk.co.uk_0",0,"^https?://(www\\.)?vetuk\\.co\\.uk/",10,[],[{"e":2632}],[{"v":2632}],[{"wait":500},{"c":2632}],[{"timeout":1000,"check":"none","wv":2632}],{}],[1,"auto_GB_virgin.com_0",0,"^https?://(www\\.)?virgin\\.com/",10,[],[{"e":2633}],[{"v":2633}],[{"wait":500},{"c":2633}],[{"timeout":1000,"check":"none","wv":2633}],{}],[1,"auto_GB_vrhump.com_pb5",0,"^https?://(www\\.)?vrhump\\.com/",10,[],[{"e":2634}],[{"v":2634}],[{"wait":500},{"c":2634}],[{"timeout":1000,"check":"none","wv":2634}],{}],[1,"auto_GB_weldricks.co.uk_0",0,"^https?://(www\\.)?weldricks\\.co\\.uk/",10,[],[{"e":2635}],[{"v":2635}],[{"wait":500},{"c":2635}],[{"timeout":1000,"check":"none","wv":2635}],{}],[1,"auto_NL_3cx.com_0mf",0,"^https?://(www\\.)?3cx\\.com/",10,[],[{"e":2636}],[{"v":2636}],[{"wait":500},{"c":2636}],[{"timeout":1000,"check":"none","wv":2636}],{}],[1,"auto_NL_aegon.nl_y2y",0,"^https?://(www\\.)?aegon\\.nl/",10,[],[{"e":2637}],[{"v":2637}],[{"wait":500},{"c":2637}],[{"timeout":1000,"check":"none","wv":2637}],{}],[1,"auto_NL_app.chatgirl.nl_uqi",0,"^https?://(www\\.)?app\\.chatgirl\\.nl/",10,[],[{"e":2638}],[{"v":2638}],[{"wait":500},{"c":2638}],[{"timeout":1000,"check":"none","wv":2638}],{}],[1,"auto_NL_beekman.nl_f9e",0,"^https?://(www\\.)?beekman\\.nl/",10,[],[{"e":2639}],[{"v":2639}],[{"wait":500},{"c":2639}],[{"timeout":1000,"check":"none","wv":2639}],{}],[1,"auto_NL_berivita.com_q3z",0,"^https?://(www\\.)?berivita\\.com/",10,[],[{"e":2640}],[{"v":2640}],[{"wait":500},{"c":2640}],[{"timeout":1000,"check":"none","wv":2640}],{}],[1,"auto_NL_bibliotheekaanzet.nl_mh6",0,"^https?://(www\\.)?bibliotheekaanzet\\.nl/",10,[],[{"e":2641}],[{"v":2641}],[{"wait":500},{"c":2641}],[{"timeout":1000,"check":"none","wv":2641}],{}],[1,"auto_NL_bk.nl_tx4",0,"^https?://(www\\.)?bk\\.nl/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_NL_blgwonen.nl_g5c",0,"^https?://(www\\.)?blgwonen\\.nl/",10,[],[{"e":2642}],[{"v":2642}],[{"wait":500},{"c":2642}],[{"timeout":1000,"check":"none","wv":2642}],{}],[1,"auto_NL_bonprix.nl_ovi",0,"^https?://(www\\.)?bonprix\\.nl/",10,[],[{"e":2643}],[{"v":2643}],[{"wait":500},{"c":2643}],[{"timeout":1000,"check":"none","wv":2643}],{}],[1,"auto_NL_braumarkt.com_wfi",0,"^https?://(www\\.)?braumarkt\\.com/",10,[],[{"e":2521}],[{"v":2521}],[{"wait":500},{"c":2521}],[{"timeout":1000,"check":"none","wv":2521}],{}],[1,"auto_NL_brillen24.nl_08c",0,"^https?://(www\\.)?brillen24\\.nl/",10,[],[{"e":2644}],[{"v":2644}],[{"wait":500},{"c":2644}],[{"timeout":1000,"check":"none","wv":2644}],{}],[1,"auto_NL_chasse.nl_gs1",0,"^https?://(www\\.)?chasse\\.nl/",10,[],[{"e":2645}],[{"v":2645}],[{"wait":500},{"c":2645}],[{"timeout":1000,"check":"none","wv":2645}],{}],[1,"auto_NL_cheaptickets.nl_cwt",0,"^https?://(www\\.)?cheaptickets\\.nl/",10,[],[{"e":2646}],[{"v":2646}],[{"wait":500},{"c":2646}],[{"timeout":1000,"check":"none","wv":2646}],{}],[1,"auto_NL_chillplanet.nl_xcp",0,"^https?://(www\\.)?chillplanet\\.nl/",10,[],[{"e":2647}],[{"v":2647}],[{"wait":500},{"c":2647}],[{"timeout":1000,"check":"none","wv":2647}],{}],[1,"auto_NL_chrono24.nl_dco",0,"^https?://(www\\.)?chrono24\\.nl/",10,[],[{"e":2429}],[{"v":2429}],[{"wait":500},{"c":2429}],[{"timeout":1000,"check":"none","wv":2429}],{}],[1,"auto_NL_clinicaldiagnostics.nl_pmu",0,"^https?://(www\\.)?clinicaldiagnostics\\.nl/",10,[],[{"e":2648}],[{"v":2648}],[{"wait":500},{"c":2648}],[{"timeout":1000,"check":"none","wv":2648}],{}],[1,"auto_NL_consumentenbond.nl_53g",0,"^https?://(www\\.)?consumentenbond\\.nl/",10,[],[{"e":2649}],[{"v":2649}],[{"wait":500},{"c":2649}],[{"timeout":1000,"check":"none","wv":2649}],{}],[1,"auto_NL_denboschregion.nl_4x6",0,"^https?://(www\\.)?denboschregion\\.nl/",10,[],[{"e":2650}],[{"v":2650}],[{"wait":500},{"c":2650}],[{"timeout":1000,"check":"none","wv":2650}],{}],[1,"auto_NL_denieuwebibliotheek.nl_c1z",0,"^https?://(www\\.)?denieuwebibliotheek\\.nl/",10,[],[{"e":2651}],[{"v":2651}],[{"wait":500},{"c":2651}],[{"timeout":1000,"check":"none","wv":2651}],{}],[1,"auto_NL_discountoffice.nl_2fb",0,"^https?://(www\\.)?discountoffice\\.nl/",10,[],[{"e":2652}],[{"v":2652}],[{"wait":500},{"c":2652}],[{"timeout":1000,"check":"none","wv":2652}],{}],[1,"auto_NL_ditjesendatjes.nl_0sa",0,"^https?://(www\\.)?ditjesendatjes\\.nl/",10,[],[{"e":2653}],[{"v":2653}],[{"wait":500},{"c":2653}],[{"timeout":1000,"check":"none","wv":2653}],{}],[1,"auto_NL_duitslandinstituut.nl_d4q",0,"^https?://(www\\.)?duitslandinstituut\\.nl/",10,[],[{"e":2654}],[{"v":2654}],[{"wait":500},{"c":2654}],[{"timeout":1000,"check":"none","wv":2654}],{}],[1,"auto_NL_effenaar.nl_nia",0,"^https?://(www\\.)?effenaar\\.nl/",10,[],[{"e":2655}],[{"v":2655}],[{"wait":500},{"c":2655}],[{"timeout":1000,"check":"none","wv":2655}],{}],[1,"auto_NL_fietsonderdelenoutlet.nl_x8u",0,"^https?://(www\\.)?fietsonderdelenoutlet\\.nl/",10,[],[{"e":2656}],[{"v":2656}],[{"wait":500},{"c":2656}],[{"timeout":1000,"check":"none","wv":2656}],{}],[1,"auto_NL_followthebeat.nl_mx5",0,"^https?://(www\\.)?followthebeat\\.nl/",10,[],[{"e":2657}],[{"v":2657}],[{"wait":500},{"c":2657}],[{"timeout":1000,"check":"none","wv":2657}],{}],[1,"auto_NL_frankenergie.nl_9xh",0,"^https?://(www\\.)?frankenergie\\.nl/",10,[],[{"e":2658}],[{"v":2658}],[{"wait":500},{"c":2658}],[{"timeout":1000,"check":"none","wv":2658}],{}],[1,"auto_NL_gezondheidenwetenschap.be_zgi",0,"^https?://(www\\.)?gezondheidenwetenschap\\.be/",10,[],[{"e":2659}],[{"v":2659}],[{"wait":500},{"c":2659}],[{"timeout":1000,"check":"none","wv":2659}],{}],[1,"auto_NL_independer.nl_ind",0,"^https?://(www\\.)?independer\\.nl/",10,[2660],[{"e":2661}],[{"v":2661}],[{"c":2661}],[{"check":"none","timeout":2000,"wv":2660}],{}],[1,"auto_NL_info.mumc.nl_8s5",0,"^https?://(www\\.)?info\\.mumc\\.nl/",10,[],[{"e":2662}],[{"v":2662}],[{"wait":500},{"c":2662}],[{"timeout":1000,"check":"none","wv":2662}],{}],[1,"auto_NL_inshared.nl_p70",0,"^https?://(www\\.)?inshared\\.nl/",10,[],[{"e":2663}],[{"v":2663}],[{"wait":500},{"c":2663}],[{"timeout":1000,"check":"none","wv":2663}],{}],[1,"auto_NL_isvw.nl_7x0",0,"^https?://(www\\.)?isvw\\.nl/",10,[],[{"e":2664}],[{"v":2664}],[{"wait":500},{"c":2664}],[{"timeout":1000,"check":"none","wv":2664}],{}],[1,"auto_NL_kaartje2go.nl_ecw",0,"^https?://(www\\.)?kaartje2go\\.nl/",10,[],[{"e":2665}],[{"v":2665}],[{"wait":500},{"c":2665}],[{"timeout":1000,"check":"none","wv":2665}],{}],[1,"auto_NL_kathmandu.nl_7j4",0,"^https?://(www\\.)?kathmandu\\.nl/",10,[],[{"e":2666}],[{"v":2666}],[{"wait":500},{"c":2666}],[{"timeout":1000,"check":"none","wv":2666}],{}],[1,"auto_NL_kvk.nl_0wn",0,"^https?://(www\\.)?kvk\\.nl/",10,[],[{"e":2667}],[{"v":2667}],[{"wait":500},{"c":2667}],[{"timeout":1000,"check":"none","wv":2667}],{}],[1,"auto_NL_labplusarts.nl_feg",0,"^https?://(www\\.)?labplusarts\\.nl/",10,[],[{"e":2668}],[{"v":2668}],[{"wait":500},{"c":2668}],[{"timeout":1000,"check":"none","wv":2668}],{}],[1,"auto_NL_lakenhal.nl_3go",0,"^https?://(www\\.)?lakenhal\\.nl/",10,[],[{"e":2669}],[{"v":2669}],[{"wait":500},{"c":2669}],[{"timeout":1000,"check":"none","wv":2669}],{}],[1,"auto_NL_magazines-motivatie.nl_6o1",0,"^https?://(www\\.)?magazines-motivatie\\.nl/",10,[],[{"e":2670}],[{"v":2670}],[{"wait":500},{"c":2670}],[{"timeout":1000,"check":"none","wv":2670}],{}],[1,"auto_NL_makro.nl_ror",0,"^https?://(www\\.)?makro\\.nl/",10,[],[{"e":2671}],[{"v":2671}],[{"wait":500},{"c":2671}],[{"timeout":1000,"check":"none","wv":2671}],{}],[1,"auto_NL_manufactum.nl_w9l",0,"^https?://(www\\.)?manufactum\\.nl/",10,[],[{"e":2450}],[{"v":2450}],[{"wait":500},{"c":2450}],[{"timeout":1000,"check":"none","wv":2450}],{}],[1,"auto_NL_matrassencheck.nl_cap",0,"^https?://(www\\.)?matrassencheck\\.nl/",10,[],[{"e":2672}],[{"v":2672}],[{"wait":500},{"c":2672}],[{"timeout":1000,"check":"none","wv":2672}],{}],[1,"auto_NL_mijn.simyo.nl_xm9",0,"^https?://(www\\.)?mijn\\.simyo\\.nl/",10,[],[{"e":2673}],[{"v":2673}],[{"wait":500},{"c":2673}],[{"timeout":1000,"check":"none","wv":2673}],{}],[1,"auto_NL_mijngelderland.nl_rkj",0,"^https?://(www\\.)?mijngelderland\\.nl/",10,[],[{"e":2674}],[{"v":2674}],[{"wait":500},{"c":2674}],[{"timeout":1000,"check":"none","wv":2674}],{}],[1,"auto_NL_milieucentraal.nl_p66",0,"^https?://(www\\.)?milieucentraal\\.nl/",10,[],[{"e":2675}],[{"v":2675}],[{"wait":500},{"c":2675}],[{"timeout":1000,"check":"none","wv":2675}],{}],[1,"auto_NL_muziekgebouw.nl_cob",0,"^https?://(www\\.)?muziekgebouw\\.nl/",10,[],[{"e":2645}],[{"v":2645}],[{"wait":500},{"c":2645}],[{"timeout":1000,"check":"none","wv":2645}],{}],[1,"auto_NL_nec-nijmegen.nl_04y",0,"^https?://(www\\.)?nec-nijmegen\\.nl/",10,[],[{"e":2676}],[{"v":2676}],[{"wait":500},{"c":2676}],[{"timeout":1000,"check":"none","wv":2676}],{}],[1,"auto_NL_nl.spankbang.com_bnh_+1",0,"^https?://(www\\.)?nl\\.spankbang\\.com/|^https?://(www\\.)?spankbang\\.com/",10,[],[{"e":2677}],[{"v":2677}],[{"wait":500},{"c":2677}],[{"timeout":1000,"check":"none","wv":2677}],{}],[1,"auto_NL_orpheus.nl_cxu",0,"^https?://(www\\.)?orpheus\\.nl/",10,[],[{"e":2645}],[{"v":2645}],[{"wait":500},{"c":2645}],[{"timeout":1000,"check":"none","wv":2645}],{}],[1,"auto_NL_partnerplatform.bol.com_k9h",0,"^https?://(www\\.)?partnerplatform\\.bol\\.com/",10,[],[{"e":2678}],[{"v":2678}],[{"wait":500},{"c":2678}],[{"timeout":1000,"check":"none","wv":2678}],{}],[1,"auto_NL_persportaal.anp.nl_o32",0,"^https?://(www\\.)?persportaal\\.anp\\.nl/",10,[],[{"e":2679}],[{"v":2679}],[{"wait":500},{"c":2679}],[{"timeout":1000,"check":"none","wv":2679}],{}],[1,"auto_NL_planteenolijfboom.nl_pdo",0,"^https?://(www\\.)?planteenolijfboom\\.nl/",10,[],[{"e":2680}],[{"v":2680}],[{"wait":500},{"c":2680}],[{"timeout":1000,"check":"none","wv":2680}],{}],[1,"auto_NL_psv.nl_2pt",0,"^https?://(www\\.)?psv\\.nl/",10,[],[{"e":2681}],[{"v":2681}],[{"wait":500},{"c":2681}],[{"timeout":1000,"check":"none","wv":2681}],{}],[1,"auto_NL_sanitairkamer.nl_vig",0,"^https?://(www\\.)?sanitairkamer\\.nl/",10,[],[{"e":2682}],[{"v":2682}],[{"wait":500},{"c":2682}],[{"timeout":1000,"check":"none","wv":2682}],{}],[1,"auto_NL_schaapcitroen.nl_6v0",0,"^https?://(www\\.)?schaapcitroen\\.nl/",10,[],[{"e":2683}],[{"v":2683}],[{"wait":500},{"c":2683}],[{"timeout":1000,"check":"none","wv":2683}],{}],[1,"auto_NL_scouting.nl_ue4",0,"^https?://(www\\.)?scouting\\.nl/",10,[],[{"e":2684}],[{"v":2684}],[{"wait":500},{"c":2684}],[{"timeout":1000,"check":"none","wv":2684}],{}],[1,"auto_NL_slachtofferhulp.nl_4m4",0,"^https?://(www\\.)?slachtofferhulp\\.nl/",10,[],[{"e":2685}],[{"v":2685}],[{"wait":500},{"c":2685}],[{"timeout":1000,"check":"none","wv":2685}],{}],[1,"auto_NL_sprinklr.co_3ww",0,"^https?://(www\\.)?sprinklr\\.co/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_NL_stadsschouwburg-utrecht.nl_tcz",0,"^https?://(www\\.)?stadsschouwburg-utrecht\\.nl/",10,[],[{"e":2686}],[{"v":2686}],[{"wait":500},{"c":2686}],[{"timeout":1000,"check":"none","wv":2686}],{}],[1,"auto_NL_stedelijkmuseumschiedam.nl_y6j",0,"^https?://(www\\.)?stedelijkmuseumschiedam\\.nl/",10,[],[{"e":2583}],[{"v":2583}],[{"wait":500},{"c":2583}],[{"timeout":1000,"check":"none","wv":2583}],{}],[1,"auto_NL_texelsecourant.nl_v4b",0,"^https?://(www\\.)?texelsecourant\\.nl/",10,[],[{"e":2687}],[{"v":2687}],[{"wait":500},{"c":2687}],[{"timeout":1000,"check":"none","wv":2687}],{}],[1,"auto_NL_ticketswap.com_d3j",0,"^https?://(www\\.)?ticketswap\\.com/",10,[],[{"e":2688}],[{"v":2688}],[{"wait":500},{"c":2688}],[{"timeout":1000,"check":"none","wv":2688}],{}],[1,"auto_NL_uit.inapeldoorn.nl_gt5",0,"^https?://(www\\.)?uit\\.inapeldoorn\\.nl/",10,[],[{"e":2689}],[{"v":2689}],[{"wait":500},{"c":2689}],[{"timeout":1000,"check":"none","wv":2689}],{}],[1,"auto_NL_vlaanderen.be_c8w",0,"^https?://(www\\.)?vlaanderen\\.be/",10,[],[{"e":2690}],[{"v":2690}],[{"wait":500},{"c":2690}],[{"timeout":1000,"check":"none","wv":2690}],{}],[1,"auto_NL_vvaa.nl_avs",0,"^https?://(www\\.)?vvaa\\.nl/",10,[],[{"e":2691}],[{"v":2691}],[{"wait":500},{"c":2691}],[{"timeout":1000,"check":"none","wv":2691}],{}],[1,"auto_NL_werkenbijdefensie.nl_0cv",0,"^https?://(www\\.)?werkenbijdefensie\\.nl/",10,[],[{"e":2692}],[{"v":2692}],[{"wait":500},{"c":2692}],[{"timeout":1000,"check":"none","wv":2692}],{}],[1,"auto_NL_winkelstraat.nl_hxj",0,"^https?://(www\\.)?winkelstraat\\.nl/",10,[],[{"e":2693}],[{"v":2693}],[{"wait":500},{"c":2693}],[{"timeout":1000,"check":"none","wv":2693}],{}],[1,"auto_NL_woonnetrijnmond.nl_itj",0,"^https?://(www\\.)?woonnetrijnmond\\.nl/",10,[],[{"e":2694}],[{"v":2694}],[{"wait":500},{"c":2694}],[{"timeout":1000,"check":"none","wv":2694}],{}],[1,"auto_NL_zuidas.nl_abm",0,"^https?://(www\\.)?zuidas\\.nl/",10,[],[{"e":2695}],[{"v":2695}],[{"wait":500},{"c":2695}],[{"timeout":1000,"check":"none","wv":2695}],{}],[1,"auto_NO_apxml.com_l6n",0,"^https?://(www\\.)?apxml\\.com/",10,[],[{"e":2696}],[{"v":2696}],[{"wait":500},{"c":2696}],[{"timeout":1000,"check":"none","wv":2696}],{}],[1,"auto_NO_arbetsformedlingen.se_wxz",0,"^https?://(www\\.)?arbetsformedlingen\\.se/",10,[],[{"e":2697}],[{"v":2697}],[{"wait":500},{"c":2697}],[{"timeout":1000,"check":"none","wv":2697}],{}],[1,"auto_NO_avanza.se_b5b",0,"^https?://(www\\.)?avanza\\.se/",10,[],[{"e":2698}],[{"v":2698}],[{"wait":500},{"c":2698}],[{"timeout":1000,"check":"none","wv":2698}],{}],[1,"auto_NO_avidafinance.com_jwc",0,"^https?://(www\\.)?avidafinance\\.com/",10,[],[{"e":2699}],[{"v":2699}],[{"wait":500},{"c":2699}],[{"timeout":1000,"check":"none","wv":2699}],{}],[1,"auto_NO_beducated.com_jjt",0,"^https?://(www\\.)?beducated\\.com/",10,[],[{"e":2700}],[{"v":2700}],[{"wait":500},{"c":2700}],[{"timeout":1000,"check":"none","wv":2700}],{}],[1,"auto_NO_dsa.no_w2b",0,"^https?://(www\\.)?dsa\\.no/",10,[],[{"e":2701}],[{"v":2701}],[{"wait":500},{"c":2701}],[{"timeout":1000,"check":"none","wv":2701}],{}],[1,"auto_NO_goteborg.com_q7v",0,"^https?://(www\\.)?goteborg\\.com/",10,[],[{"e":2702}],[{"v":2702}],[{"wait":500},{"c":2702}],[{"timeout":1000,"check":"none","wv":2702}],{}],[1,"auto_NO_hacksmith.store_49t",0,"^https?://(www\\.)?hacksmith\\.store/",10,[],[{"e":2703}],[{"v":2703}],[{"wait":500},{"c":2703}],[{"timeout":1000,"check":"none","wv":2703}],{}],[1,"auto_NO_hotelfinse1222.no_zpm",0,"^https?://(www\\.)?hotelfinse1222\\.no/",10,[],[{"e":2680}],[{"v":2680}],[{"wait":500},{"c":2680}],[{"timeout":1000,"check":"none","wv":2680}],{}],[1,"auto_NO_jaksta.com_own",0,"^https?://(www\\.)?jaksta\\.com/",10,[],[{"e":2704}],[{"v":2704}],[{"wait":500},{"c":2704}],[{"timeout":1000,"check":"none","wv":2704}],{}],[1,"auto_NO_ledigajobb.se_tx3",0,"^https?://(www\\.)?ledigajobb\\.se/",10,[],[{"e":2705}],[{"v":2705}],[{"wait":500},{"c":2705}],[{"timeout":1000,"check":"none","wv":2705}],{}],[1,"auto_NO_saseurobonusmastercard.se_oqd",0,"^https?://(www\\.)?saseurobonusmastercard\\.se/",10,[],[{"e":2706}],[{"v":2706}],[{"wait":500},{"c":2706}],[{"timeout":1000,"check":"none","wv":2706}],{}],[1,"auto_NO_sverigesradio.se_a00",0,"^https?://(www\\.)?sverigesradio\\.se/",10,[],[{"e":2707}],[{"v":2707}],[{"wait":500},{"c":2707}],[{"timeout":1000,"check":"none","wv":2707}],{}],[1,"auto_NO_swedbank.se_63w",0,"^https?://(www\\.)?swedbank\\.se/",10,[],[{"e":2708}],[{"v":2708}],[{"wait":500},{"c":2708}],[{"timeout":1000,"check":"none","wv":2708}],{}],[1,"auto_NO_tingstad.com_z23",0,"^https?://(www\\.)?tingstad\\.com/",10,[],[{"e":2709}],[{"v":2709}],[{"wait":500},{"c":2709}],[{"timeout":1000,"check":"none","wv":2709}],{}],[1,"auto_NO_truecaller.com_sdg",0,"^https?://(www\\.)?truecaller\\.com/",10,[],[{"e":2710}],[{"v":2710}],[{"wait":500},{"c":2710}],[{"timeout":1000,"check":"none","wv":2710}],{}],[1,"auto_NO_webank.it_6rx",0,"^https?://(www\\.)?webank\\.it/",10,[],[{"e":2711}],[{"v":2711}],[{"wait":500},{"c":2711}],[{"timeout":1000,"check":"none","wv":2711}],{}],[1,"auto_NO_xrealgirl.com_r42",0,"^https?://(www\\.)?xrealgirl\\.com/",10,[],[{"e":2712}],[{"v":2712}],[{"wait":500},{"c":2712}],[{"timeout":1000,"check":"none","wv":2712}],{}],[1,"auto_US_amazon.jobs_0",0,"^https?://(www\\.)?amazon\\.jobs/",10,[],[{"e":2713}],[{"v":2713}],[{"wait":500},{"c":2713}],[{"timeout":1000,"check":"none","wv":2713}],{}],[1,"auto_US_amsoil.com_fgr",0,"^https?://(www\\.)?amsoil\\.com/",10,[],[{"e":2714}],[{"v":2714}],[{"c":2714}],[],{}],[1,"auto_US_balsamhill.com_oxq",0,"^https?://(www\\.)?balsamhill\\.com/",10,[],[{"e":2715}],[{"v":2715}],[{"wait":500},{"c":2715}],[{"timeout":1000,"check":"none","wv":2715}],{}],[1,"auto_US_computerworld.com_0_+1",0,"^https?://(www\\.)?computerworld\\.com/|^https?://(www\\.)?csoonline\\.com/",10,[],[{"e":2716}],[{"v":2716}],[{"text":"Do not accept","c":2716}],[],{}],[1,"auto_US_coupons.slickdeals.net_wya",0,"^https?://(www\\.)?coupons\\.slickdeals\\.net/",10,[],[{"e":2717}],[{"v":2717}],[{"wait":500},{"c":2717}],[{"timeout":1000,"check":"none","wv":2717}],{}],[1,"auto_US_deezer.com_0",0,"^https?://(www\\.)?deezer\\.com/",10,[],[{"e":2718}],[{"v":2718}],[{"text":"Refuse","c":2718}],[],{}],[1,"auto_US_emagine-entertainment.com_0",0,"^https?://(www\\.)?emagine-entertainment\\.com/",10,[],[{"e":2719}],[{"v":2719}],[{"wait":500},{"c":2719}],[{"timeout":1000,"check":"none","wv":2719}],{}],[1,"auto_US_fawesome.tv_gjx",0,"^https?://(www\\.)?fawesome\\.tv/",10,[],[{"e":2720}],[{"v":2720}],[{"wait":500},{"c":2720}],[{"timeout":1000,"check":"none","wv":2720}],{}],[1,"auto_US_forum.affinity.serif.com_0",0,"^https?://(www\\.)?forum\\.affinity\\.serif\\.com/",10,[],[{"e":2721}],[{"v":2721}],[{"text":" Reject Cookies","c":2721}],[],{}],[1,"auto_US_forum.prusa3d.com_0",0,"^https?://(www\\.)?forum\\.prusa3d\\.com/",10,[],[{"e":2722}],[{"v":2722}],[{"text":"Reject All","c":2722}],[],{}],[1,"auto_US_greenpan.us_cko",0,"^https?://(www\\.)?greenpan\\.us/",10,[],[{"e":2383}],[{"v":2383}],[{"wait":500},{"c":2383}],[{"timeout":1000,"check":"none","wv":2383}],{}],[1,"auto_US_ligonier.org_0",0,"^https?://(www\\.)?ligonier\\.org/",10,[],[{"e":2723}],[{"v":2723}],[{"text":"Strictly Necessary","c":2723}],[],{}],[1,"auto_US_lilly.com_lh6_+1",0,"^https?://(www\\.)?lilly\\.com/|^https?://(www\\.)?zepbound\\.lilly\\.com/",10,[],[{"e":2724}],[{"v":2724}],[{"wait":500},{"c":2724}],[{"timeout":1000,"check":"none","wv":2724}],{}],[1,"auto_US_mixedbread.ai_tge",0,"^https?://(www\\.)?mixedbread\\.com/",10,[],[{"e":2696}],[{"v":2696}],[{"wait":500},{"c":2696}],[{"timeout":1000,"check":"none","wv":2696}],{}],[1,"auto_US_musicnotes.com_0",0,"^https?://(www\\.)?musicnotes\\.com/",10,[],[{"exists":["#polaris-css-lockdown-container",".polaris-consent-widget"]}],[{"visible":["#polaris-css-lockdown-container",".polaris-consent-widget"]}],[{"if":{"exists":["#polaris-css-lockdown-container","[data-testid='oneClickOptOutLink']"]},"then":[{"waitForThenClick":["#polaris-css-lockdown-container","[data-testid='oneClickOptOutLink']"]}],"else":[{"hide":["#polaris-css-lockdown-container",".polaris-consent-widget"]}]}],[],{}],[1,"auto_US_newmedicare.com_6jp",0,"^https?://(www\\.)?newmedicare\\.com/",10,[],[{"e":2725}],[{"v":2725}],[{"wait":500},{"c":2725}],[{"timeout":1000,"check":"none","wv":2725}],{}],[1,"auto_US_peptidesciences.com_0",0,"^https?://(www\\.)?peptidesciences\\.com/",10,[],[{"e":2726}],[{"v":2726}],[{"wait":500},{"c":2726}],[{"timeout":1000,"check":"none","wv":2726}],{}],[1,"auto_US_semrush.com_0",0,"^https?://(www\\.)?semrush\\.com/",10,[],[{"e":2727}],[{"v":2727}],[{"wait":500},{"c":2727}],[{"timeout":1000,"check":"none","wv":2727}],{}],[1,"auto_US_sso.passport.yandex.ru_0_+5",0,"^https?://(www\\.)?sso\\.passport\\.yandex\\.ru/|^https?://(www\\.)?translate\\.yandex\\.com/|^https?://(www\\.)?tv\\.yandex\\.com/|^https?://(www\\.)?ya\\.ru/|^https?://(www\\.)?yandex\\.com\\.tr/|^https?://(www\\.)?yandex\\.com/",10,[],[{"e":2728}],[{"v":2728}],[{"text":"Allow essential cookies","c":2728}],[],{}],[1,"auto_US_truecaller.com_0",0,"^https?://(www\\.)?truecaller\\.com/",10,[],[{"e":2729}],[{"v":2729}],[{"text":"Accept Necessary Cookies","c":2729}],[],{}],[1,"auto_US_weingartz.com_aso",0,"^https?://(www\\.)?weingartz\\.com/",10,[],[{"e":2730}],[{"v":2730}],[{"c":2730}],[],{}],[1,"axesor",2,"^https?://([\\w-]+\\.)?axesor\\.es/",22,[2731],[{"e":2732}],[{"v":2732}],[{"c":2732}],[{"cc":2733}],{}],[1,"aytm",2,"^https?://(www\\.|)?aytm\\.com/",22,[424],[{"e":2734}],[{"v":2734}],[{"c":2734}],[],{}],[1,"babylist",2,"^https?://(www\\.)?babylist\\.com/",22,[2735,2736],[{"e":2735}],[{"v":2737}],[{"c":2737},{"timeout":2000,"optional":true,"c":2738}],[],{}],[1,"babylonbee",2,"^https?://(www\\.)?babylonbee\\.com/",22,[],[{"e":2739}],[{"v":2739}],[{"retry":3,"c":2739}],[{"check":"none","v":2739}],{}],[1,"bahn-de",0,"^https://(www\\.)?bahn\\.de/",10,[],[{"exists":["body > div:first-child","#consent-layer"]}],[{"visible":["body > div:first-child","#consent-layer"]}],[{"waitForThenClick":["body > div:first-child","#consent-layer .js-accept-essential-cookies"]}],[{"eval":"EVAL_BAHN_TEST"}],{"intermediate":false}],[1,"bakeca",2,"^https?://([\\w-]+\\.)?bakecaincontrii\\.com/",22,[],[{"e":2740}],[{"v":2741}],[{"c":2742}],[{"check":"none","timeout":2000,"wv":2741}],{}],[1,"bandcamp.com",2,"^https://([a-z0-9-]+\\.)?bandcamp\\.com",22,[],[{"e":2743}],[{"any":[{"v":2744},{"visible":["menu-bar",".cookie-dialog-initial"]},{"visible":["page-footer",".cookie-dialog-initial"]}]}],[{"any":[{"timeout":500,"c":2745},{"waitForThenClick":["menu-bar",".cookie-dialog-initial button.g-button.outline"],"timeout":500},{"waitForThenClick":["page-footer",".cookie-dialog-initial button.g-button.outline"],"timeout":500}]}],[{"wait":500},{"cc":2746}],{}],[1,"bankmillennium.pl",2,"^https?://(www\\.)?bankmillennium\\.pl/",22,[2747],[{"e":2747}],[{"v":2747}],[{"waitForThenClick":["#cookie_modal_placeholder dialog.bm-modal--cookie","xpath///button[contains(normalize-space(.), 'Odrzu')]"]}],[{"cc":2748},{"cc":2749}],{}],[1,"banknorwegian",2,"^https?://(www\\.)?banknorwegian\\.(no|se|dk|fi|de|es)/",22,[2750],[{"e":2751}],[{"v":2752}],[{"c":2752},{"wv":2753},{"all":true,"optional":true,"k":2754},{"k":2753},{"check":"none","timeout":3000,"optional":true,"wv":2753}],[{"check":"none","v":2755}],{}],[1,"batteriexperten.com",2,"^https?://(\\w+\\.)?(batteriexperten\\.com|teknikdelar\\.se|teknikkdeler\\.no|teknikdele\\.dk|tekniikkaosat\\.fi)/",22,[2756],[{"e":2757}],[{"v":2757}],[{"if":{"e":2758},"then":[{"c":2759}],"else":[{"c":2760},{"wv":2761},{"all":true,"optional":true,"k":2762},{"c":2763}]},{"check":"none","wv":2757}],[{"cc":2764}],{}],[1,"bbc.com",2,"^https://(www\\.)?bbc\\.(com|co\\.uk)/",22,[2765,2766],[{"any":[{"e":2767},{"e":2768}]}],[{"any":[{"v":2767},{"v":2768}]}],[{"if":{"e":2768},"then":[{"c":2768}],"else":[{"c":2769}]}],[{"wait":500},{"cc":2770}],{}],[1,"bbc.com-orb-cosmetic",1,"^https://(www\\.)?bbc\\.(com|co\\.uk)/",22,[2771],[{"e":2772}],[{"v":2772}],[{"h":2771}],[{"check":"none","v":2773}],{}],[1,"bcferries.com",2,"^https?://(\\w+\\.)?bcferries\\.com/",22,[2774],[{"e":2775}],[{"v":2774}],[{"c":2776},{"c":2777},{"c":2778}],[],{}],[1,"berelax.com",2,"^https://(www\\.)?berelax\\.com/",22,[2779],[{"e":2780}],[{"v":2781}],[{"c":2782},{"check":"none","timeout":2000,"wv":2781}],[],{}],[1,"bibliotheek-nl",0,"^https?://(?:www\\.)?(?:onlinebibliotheek|bibliotheek)\\.nl/",10,[2783],[{"e":2784}],[{"v":2783}],[{"c":2785}],[],{}],[1,"blitzrechner",2,"^https?://(www\\.)?blitzrechner\\.de/",22,[2786],[{"e":2786}],[{"v":2787}],[{"all":true,"optional":true,"k":2788},{"c":2789}],[{"cc":2790}],{}],[1,"bokadirekt.se",2,"^https?://(\\w+\\.)?bokadirekt\\.se/",22,[],[{"e":2791}],[{"v":2791}],[{"c":2792},{"wv":2793},{"if":{"e":2794},"then":[{"all":true,"k":2794}]},{"k":2793}],[{"cc":2795}],{}],[1,"breuninger",2,"^https://(www\\.)?breuninger\\.com/",22,[2796],[{"e":2797}],[{"v":2798}],[{"c":2797}],[{"cc":2799}],{}],[1,"bricklink",2,"^https?://([a-z0-9-]+\\.)?bricklink\\.com/",22,[2800],[{"e":2800}],[{"v":2800}],[{"c":2801}],[{"cc":2802}],{}],[1,"bringatrailer",2,"^https?://(www\\.)?bringatrailer\\.com/",22,[],[{"e":2803},{"cc":2804}],[{"v":2805}],[{"c":2803}],[{"cc":2806}],{}],[1,"buonmedico",2,"^https?://(www\\.)?buonmedico\\.it/",22,[2807],[{"e":2808}],[{"v":2808}],[{"c":2808}],[{"cc":2809}],{}],[1,"canva",2,"^https?://(www\\.)?canva\\.com/",22,[2810],[{"e":2810}],[{"v":2810}],[{"c":2811},{"c":2812},{"c":2813}],[{"wait":1000},{"cc":2814}],{}],[1,"canyon.com",2,"^https://www\\.canyon\\.com/",22,[2815],[{"e":2815}],[{"v":2815}],[{"k":2816},{"c":2817}],[],{}],[1,"capitalone-ca",2,"^https://(www\\.)?capitalone\\.ca/",22,[],[{"e":2818}],[{"v":2818}],[{"c":2818}],[{"cc":2819}],{}],[1,"carpetaciudadana",2,"^https?://(\\w+\\.)?carpetaciudadana\\.gob\\.es/",22,[2820],[{"e":2821}],[{"v":2822}],[{"c":2821},{"wv":2823},{"if":{"e":2824},"then":[{"k":2823}]},{"retry":2,"retryInterval":600,"c":2825}],[{"cc":2826}],{}],[1,"carre.nl",2,"^https?://(www\\.)?carre\\.nl/",10,[2827],[{"e":2828}],[{"v":2827}],[{"c":2828}],[],{}],[1,"casier-judiciaire-justice-gouv-fr",2,"^https?://casier-judiciaire\\.justice\\.gouv\\.fr/",22,[2829],[{"e":2830}],[{"v":2829}],[{"c":2831},{"check":"none","timeout":2000,"optional":true,"wv":2829}],[{"check":"none","v":2829}],{}],[1,"ccm-net",1,"^https?://([\\w-]+\\.)?ccm\\.net/",22,[77,2832],[{"any":[{"e":78},{"e":2832}]}],[{"any":[{"v":77},{"v":2832}]}],[{"h":2832},{"if":{"v":77},"then":[{"waitForThenClick":["iframe[srcdoc*='frame-root']",".button__skip"]}]}],[],{}],[1,"chairish",2,"^https?://(www\\.)?chairish\\.com/",22,[2833],[{"e":2834}],[{"v":2835}],[{"c":2834},{"wv":2836},{"all":true,"optional":true,"k":2837},{"c":2838}],[{"cc":2839}],{}],[1,"channel4.com",2,"^https?://(www\\.)?channel4\\.com/",10,[233,2840],[{"e":2841}],[{"v":2841}],[{"c":2842}],[{"cc":2843}],{}],[1,"chatgpt",0,"^https?://(\\w+\\.)?chatgpt\\.com/",10,[2844],[{"e":2845}],[{"v":2846}],[{"c":2845}],[{"timeout":1000,"check":"none","wv":2847}],{}],[1,"chemicalbook",1,"^https?://(\\w+\\.)?chemicalbook\\.com/",22,[2848],[{"e":2849}],[{"v":2848}],[{"h":2848}],[],{}],[1,"chimnie-co-uk",2,"^https?://(\\w+\\.)?chimnie\\.co\\.uk/",22,[2850],[{"e":2850}],[{"v":2850}],[{"c":2851},{"c":2852}],[{"check":"none","timeout":2000,"wv":2850}],{}],[1,"chomikuj",2,"^https?://(\\w+\\.)?chomikuj\\.pl/",22,[],[{"e":2853}],[{"v":2853}],[{"c":2853}],[{"check":"none","timeout":2000,"wv":2854}],{}],[1,"citizensadvice",2,"^https?://(\\w+\\.)?citizensadvice\\.org\\.uk/",22,[2855],[{"e":2856}],[{"v":2856}],[{"c":2856},{"timeout":2000,"optional":true,"c":2857}],[{"cc":649}],{}],[1,"civilservicejobs-service-gov-uk",2,"^https?://(\\w+\\.)?civilservicejobs\\.service\\.gov\\.uk/",22,[2858],[{"e":2859}],[{"v":2859}],[{"c":2859},{"check":"none","timeout":2000,"optional":true,"wv":2858}],[{"cc":2860}],{}],[1,"clasohlson.com",2,"^https?://(www\\.)?clasohlson\\.com/",22,[2861],[{"e":2862}],[{"v":2863}],[{"retry":10,"retryInterval":500,"c":2864},{"check":"none","wv":2863}],[{"cc":2865}],{}],[1,"clustrmaps.com",1,"^https://(www\\.)?clustrmaps\\.com/",22,[1053],[{"e":1053}],[{"v":1053}],[{"h":1053}],[],{}],[3,"community.screwfix.com",2,"^https?://community\\.screwfix\\.com/",10,[2866],[{"e":2867}],[{"v":2867}],[{"c":2868},{"stylesheet":"#consent-banner::before { display: none !important; }","stylesheetId":"screwfix-backdrop"}],[{"cc":2869}],{}],[1,"concordia-ch",2,"^https://(\\w+\\.)?concordia\\.(ch|li)/",22,[2870],[{"e":2870}],[{"v":2871}],[{"c":2872}],[{"cc":2873}],{}],[1,"conjointly",2,"^https://(www\\.)?conjointly\\.com/",22,[2874],[{"e":2875}],[{"v":2875}],[{"if":{"e":2876},"then":[{"k":2877}]},{"c":2878}],[{"cc":2879}],{}],[1,"controlgame",2,"^https?://(www\\.)?controlgame\\.com/",22,[],[{"e":2880}],[{"v":2880}],[{"retry":10,"retryInterval":500,"c":2880}],[{"cc":637}],{}],[1,"copaamerica",1,"^https://(www\\.)?copaamerica\\.com/",22,[2881],[{"e":2881}],[{"v":2881}],[{"h":2881}],[],{}],[1,"copilot-microsoft",0,"^https://copilot\\.microsoft\\.com/",10,[34],[{"e":34}],[{"v":34}],[{"c":2882}],[{"cc":2883}],{}],[1,"costco",1,"^https?://([\\w-]+\\.)*costco(businesscentre|businessdelivery)?\\.(ca|com)/",22,[2884],[{"e":2885}],[{"v":2884}],[{"h":2886}],[],{}],[1,"csu-landtag-de",2,"^https://(www\\.|)?csu-landtag\\.de",22,[2887],[{"e":2887}],[{"v":2887}],[{"k":2888}],[],{}],[1,"ctv-disneyonice",2,"^https://www\\.ctv\\.co\\.jp/disneyonice(?:/|[?#]|$)",22,[2889],[{"e":2890}],[{"v":2890}],[{"c":2891}],[{"cc":2892}],{}],[1,"cuvva.com",0,"^https://(www\\.)?cuvva\\.com/",22,[],[{"e":2893}],[{"v":2893},{"negated":true,"cc":2894}],[{"retry":10,"retryInterval":500,"c":2895},{"wait":500},{"if":{"v":2895},"then":[{"retry":10,"retryInterval":500,"c":2895}]}],[{"cc":2896}],{}],[1,"dailymotion.com",2,"^https://(www\\.)?dailymotion\\.com/",22,[2897],[{"e":2898}],[{"v":2899}],[{"c":2900}],[{"cc":2901}],{}],[1,"dalecarnegie",2,"^https?://(\\w+\\.)?dalecarnegie\\.com/",22,[],[{"e":2902}],[{"v":2903}],[{"c":2902},{"wv":2904},{"all":true,"optional":true,"k":2905},{"k":2904}],[{"cc":2906}],{}],[1,"darkounity.com",2,"^https://(www\\.)?darkounity\\.com/",22,[2907],[{"exists":["gdpr-consent-popup","[data-action='necessary-only']"]}],[{"visible":["gdpr-consent-popup",".banner"]}],[{"waitForThenClick":["gdpr-consent-popup","[data-action='necessary-only']"]}],[{"waitForVisible":["gdpr-consent-popup",".banner"],"timeout":2000,"check":"none"}],{}],[1,"deliveroo",2,"^https?://(\\w+\\.)?deliveroo\\.(co\\.uk|\\w+)/",22,[2908],[{"e":2908}],[{"v":2908}],[{"c":2909},{"check":"none","wv":2908}],[{"cc":1947}],{}],[1,"delta.com",1,"^https://www\\.delta\\.com/",22,[2910],[{"e":2911}],[{"v":2911}],[{"h":2911}],[],{}],[2,"depop",1,"^https://(www\\.)?depop\\.com/",22,[1903,2912],[{"e":1903}],[{"visible":["#transcend-consent-manager","#consentManagerMainDialog"]}],[{"h":1903},{"h":2912},{"timeout":3000,"optional":true,"w":2912},{"addStyle":"overflow: auto !important","selector":"body","optional":true}],[],{}],[1,"dhbbank",2,"^https?://(www\\.)?dhbbank\\.(com|nl|be|de)/",22,[2913],[{"e":2914}],[{"v":2914}],[{"c":2914}],[{"check":"none","timeout":3000,"wv":2913},{"cc":2915}],{}],[1,"diag.pl",2,"^https?://(\\w+\\.)?diag\\.pl/",22,[],[{"e":2916}],[{"v":2916}],[{"c":2916}],[{"check":"none","timeout":3000,"wv":2916}],{}],[1,"dji",0,"^https://(\\w+\\.)+dji\\.com/",22,[2917],[{"e":2918}],[{"e":2917}],[{"c":2919}],[{"cc":2920}],{}],[1,"dndbeyond",2,"^https://(www\\.)?dndbeyond\\.com/",22,[2921],[{"e":2921}],[{"v":2921}],[{"c":2922}],[{"cc":2923}],{}],[1,"doktorabc",2,"^https?://(\\w+\\.)?doktorabc\\.com/",22,[2924],[{"e":2925}],[{"v":2925}],[{"c":2926},{"wv":2927},{"all":true,"optional":true,"k":2928},{"c":2929}],[{"cc":2930}],{}],[1,"dola",2,"^https?://(www\\.)?dola\\.com/",22,[2931],[{"e":2932}],[{"v":2932}],[{"c":2933}],[{"timeout":1000,"check":"none","wv":2931}],{}],[1,"dolphinfitness",2,"^https?://(www\\.)?dolphinfitness\\.co\\.uk/",22,[2934],[{"e":2935}],[{"v":2935}],[{"c":2936},{"wv":2937},{"k":2938},{"k":2939},{"k":2937},{"c":2940}],[{"e":2941},{"e":2942},{"e":2943}],{}],[1,"dwaalzin.nu",2,"^https?://(www\\.)?dwaalzin\\.nu/",22,[406],[{"e":2944}],[{"v":2944}],[{"c":2944}],[{"cc":1216}],{}],[1,"eastlink",2,"^https?://(www\\.)?eastlink\\.ca/",22,[],[{"e":2945}],[{"e":2946},{"negated":true,"cc":2947}],[{"timeout":10000,"wv":2948},{"k":2945},{"wv":2949},{"if":{"e":2950},"then":[{"k":2951}]},{"if":{"e":2952},"then":[{"k":2953}]},{"k":2946}],[],{}],[1,"ebay",0,"^https://(www\\.)?ebay\\.([.a-z]+)/",10,[2954],[{"e":2954}],[{"v":2954}],[{"c":2955},{"check":"none","timeout":2000,"optional":true,"wv":2954},{"if":{"v":2954},"then":[{"timeout":2000,"c":2955}]}],[],{}],[1,"ecosia",2,"^https://www\\.ecosia\\.org/",22,[2956],[{"e":2957}],[{"v":2957}],[{"c":2958}],[],{}],[1,"edpb-edps",2,"^https://(www\\.)?(edpb|edps)\\.europa\\.eu/",22,[2959],[{"e":2960}],[{"v":2959}],[{"c":2960}],[{"cc":2961}],{}],[1,"ef-ccpa",0,"^https://(www\\.)?eforms\\.com",22,[2962],[{"e":2962}],[{"v":2962}],[{"c":2963}],[],{}],[1,"ekd.de",2,"^https?://(\\w+\\.)?ekd\\.de/",22,[2964],[{"e":2965}],[{"v":2964}],[{"c":2965}],[{"cc":2966}],{}],[1,"elektro-material-ch",1,"^https?://(www\\.)?elektro-material\\.ch/",22,[2967],[{"e":2968}],[{"v":2969}],[{"h":2967}],[],{}],[1,"elsevier",2,"^https?://(\\w+\\.)?elsevier\\.(com|support)/",22,[2970],[{"e":2971}],[{"v":2971}],[{"if":{"e":2972},"then":[{"retry":3,"retryInterval":1000,"c":2972}],"else":[{"retry":3,"retryInterval":1000,"c":2973},{"timeout":10000,"wv":1943},{"all":true,"optional":true,"c":1945},{"timeout":5000,"c":1946}]},{"check":"none","timeout":10000,"wv":2974}],[{"cc":1947}],{}],[1,"eltax-lta-go-jp",2,"^https://(?:[^/]+\\.)?eltax\\.lta\\.go\\.jp/",22,[2975],[{"e":2976}],[{"v":2976}],[{"c":2976}],[],{}],[1,"emr-ch",2,"^https?://(www\\.)?(emr|emfeedback)\\.ch/",22,[2977],[{"e":2978}],[{"v":2977}],[{"all":true,"optional":true,"k":2979},{"retry":3,"retryInterval":500,"c":2978}],[{"cc":2980}],{}],[1,"endeavorhealth",2,"^https?://(www\\.)?endeavorhealth\\.org/",22,[2981],[{"e":2982}],[{"v":2982}],[{"retry":2,"retryInterval":1000,"c":2983}],[{"check":"none","timeout":2000,"wv":2982}],{}],[1,"endocrine.org",2,"^https?://(www\\.)?endocrine\\.org/",22,[],[{"e":2984}],[{"v":2985}],[{"c":2985}],[{"timeout":1000,"check":"none","wv":2984}],{}],[1,"eneba",0,"^https?://(www\\.)?eneba\\.com/",10,[2986],[{"e":2987}],[{"v":2987}],[{"c":2988},{"timeout":2000,"optional":true,"wv":2989},{"if":{"check":"none","v":2989},"then":[{"k":2988}]},{"wv":2989},{"all":true,"optional":true,"k":2990},{"c":2991}],[{"wait":500},{"cc":2992}],{}],[1,"england.nhs.uk",2,"^https?://(www\\.)?england\\.nhs\\.uk/",22,[2993],[{"e":2994}],[{"v":2993}],[{"c":2994},{"wv":360},{"if":{"e":2995},"then":[{"all":true,"k":2995}]},{"c":362}],[{"cc":2996}],{}],[1,"ensembleartsphilly",2,"^https?://(\\w+\\.)?ensembleartsphilly\\.org/",22,[2997],[{"e":2998}],[{"v":2999}],[{"c":2998}],[{"cc":3000}],{}],[1,"eon.pl",2,"^https?://(\\w+\\.)?eon\\.pl/",22,[3001],[{"e":3002}],[{"v":3001}],[{"c":3003},{"wv":3004},{"optional":true,"k":3005},{"k":3006}],[{"cc":3007}],{}],[1,"epidemicsound.com",2,"^https?://(\\w+\\.)?epidemicsound\\.com/",22,[3008],[{"e":3009}],[{"v":3010}],[{"w":1946},{"c":3010},{"wv":1943},{"all":true,"optional":true,"k":3011},{"c":1946},{"check":"none","wv":3010}],[{"cc":1947}],{}],[1,"eroticiracconti-it",1,"^https?://(www\\.)?eroticiracconti\\.it/",22,[3012],[{"e":3013}],[{"v":3014}],[{"h":3012}],[],{}],[1,"ersatzteile-24",2,"^https?://(www\\.)?ersatzteile-24\\.com/",22,[3015],[{"e":3016}],[{"v":3017}],[{"retry":5,"retryInterval":1000,"c":3018},{"wv":3019},{"k":3019},{"k":3016}],[{"cc":3020},{"cc":3021}],{}],[1,"escaparium.ca",2,"^https://(www\\.)?escaparium\\.ca/",22,[],[{"e":3022}],[{"v":3023}],[{"c":3024},{"c":3025}],[{"cc":3026}],{}],[1,"escorteintime",2,"^https?://(www\\.)?escorteintime\\.com/",22,[3027],[{"e":3027}],[{"v":3027}],[{"c":3028},{"c":3029}],[{"check":"none","timeout":2000,"wv":3027}],{}],[1,"espace-personnel.agirc-arrco.fr",2,"^https://espace-personnel\\.agirc-arrco\\.fr/",22,[3030],[{"e":3031}],[{"v":3031}],[{"c":3032}],[],{}],[1,"europa-eu",2,"^https://([a-z0-9.-]*\\.)?europa\\.eu/",22,[3033],[{"e":3033}],[{"v":3033}],[{"c":3034}],[{"cc":3035}],{}],[1,"eventfrog",2,"^https?://(www\\.)?eventfrog\\.(ch|de|at)/",22,[3036],[{"e":3037}],[{"v":3038}],[{"wv":3037},{"wait":500},{"k":3037}],[{"cc":3039}],{}],[1,"evium.de",2,"^https://(www\\.)?evium\\.de/",22,[3040],[{"e":3040}],[{"v":3040}],[{"c":3041},{"check":"none","timeout":2000,"wv":3040}],[],{}],[1,"evozen.fr",2,"^https?://(\\w+\\.)?evozen\\.fr/",22,[3042],[{"e":3043}],[{"v":3042}],[{"c":3044}],[],{}],[1,"facebook",2,"^https://(www\\.)?facebook\\.com/",22,[],[{"e":3045}],[{"v":3045}],[{"c":3045},{"check":"none","wv":3045}],[],{}],[1,"facebook-mobile",2,"^https://(m|mbasic)\\.facebook\\.com/",22,[1284],[{"e":1284}],[{"v":1284}],[{"c":3046},{"check":"none","wv":1284}],[],{}],[1,"fascicolosanitario-lombardia",0,"^https?://(\\w+\\.)?fascicolosanitario\\.regione\\.lombardia\\.it/",22,[473],[{"e":3047}],[{"v":3048}],[{"c":3049}],[{"cc":3050}],{}],[1,"fepblue.org",2,"^https?://(www\\.)?fepblue\\.org/",22,[3051],[{"e":3052}],[{"v":3053}],[{"c":3052}],[{"check":"none","timeout":2000,"wv":3052}],{}],[1,"fideuram",2,"^https?://(www\\.)?fideuram\\.it/",22,[3054],[{"e":3055}],[{"v":3055}],[{"c":3055}],[{"cc":3056}],{}],[1,"financestrategists.com",1,"^https://(www\\.)?financestrategists\\.com/",22,[3057],[{"e":3057}],[{"v":3057}],[{"h":3057}],[],{}],[1,"fis-data-exchange",2,"^https://services\\.dataexchange\\.fiscloudservices\\.com/",22,[3058],[{"e":3059}],[{"v":3059}],[{"c":3059}],[{"cc":3060}],{}],[1,"fod-fujitv",2,"^https?://fod\\.fujitv\\.co\\.jp/",22,[3061],[{"v":3062}],[{"v":3061}],[{"c":3062}],[{"cc":3063}],{}],[1,"fondoest.it",2,"^https?://(www\\.)?fondoest\\.it/",22,[3064],[{"e":3065}],[{"v":3066}],[{"c":3066},{"c":3067}],[{"cc":3068}],{}],[1,"fonts.google.com",2,"^https?://fonts\\.google\\.com/",22,[3069],[{"e":3070}],[{"v":3069}],[{"c":3071}],[{"check":"none","timeout":2000,"wv":3069}],{}],[1,"forsakringskassan.se",2,"^https?://(\\w+\\.)?forsakringskassan\\.se/",22,[3072],[{"e":3073}],[{"v":3073}],[{"c":3074}],[{"cc":3075}],{}],[1,"foto-erhardt",2,"^https?://(www\\.)?foto-erhardt\\.(de|com|fr)/",22,[],[{"e":3076}],[{"v":3077}],[{"c":3076},{"c":3078}],[{"cc":3079}],{}],[1,"fpl-com",2,"^https?://(www\\.)?(fpl|fplhome)\\.com/",22,[3080],[{"e":3080}],[{"v":3080}],[{"c":3081}],[{"check":"none","v":3080}],{}],[1,"fuqer",2,"^https?://(\\w+\\.)?fuqer\\.com/",22,[3082],[{"e":3083}],[{"v":3083}],[{"retry":10,"retryInterval":500,"c":3083}],[{"cc":3084}],{}],[1,"futoncompany",2,"^https?://(\\w+\\.)?futoncompany\\.co\\.uk/",22,[3085],[{"e":3085}],[{"v":3085}],[{"c":3086},{"wv":3087},{"all":true,"optional":true,"k":3088},{"k":3089}],[{"wait":1500},{"cc":3090}],{}],[1,"futurabolzano.it",1,"^https?://(www\\.)?futurabolzano\\.it/",22,[3091],[{"e":3091}],[{"v":3091}],[{"h":3091}],[{"check":"none","v":3091}],{}],[1,"gays-cruising",2,"^https?://([\\w-]+\\.)?gays-cruising\\.com/",22,[3092],[{"e":3093}],[{"v":3092}],[{"c":3094},{"wv":3095},{"all":true,"optional":true,"k":3096},{"k":3097}],[{"cc":3098}],{}],[1,"geeks-for-geeks",1,"^https://www\\.geeksforgeeks\\.org/",22,[3099],[{"e":3099}],[{"v":3099}],[{"h":3099}],[],{}],[1,"geni.com",1,"^https://(www\\.)?geni\\.com/",22,[3100],[{"e":3100}],[{"v":3100}],[{"h":3100}],[],{}],[1,"givedirectly",2,"^https?://(www\\.)?givedirectly\\.org/",22,[3101],[{"e":3101}],[{"v":3101}],[{"retry":3,"c":3102}],[{"check":"none","wv":3101}],{}],[1,"gla.ac.uk",2,"^https?://(\\w+\\.)?gla\\.ac\\.uk/",22,[3103],[{"e":3104}],[{"v":3104}],[{"c":3105},{"k":3106},{"k":3107}],[{"cc":3108},{"cc":3109},{"cc":3110}],{}],[1,"glastonburyfestivals",0,"^https://(\\w+\\.)?glastonburyfestivals\\.co\\.uk/",22,[3111],[{"e":3112}],[{"v":3112}],[{"c":3113}],[],{}],[1,"gnoccaforum",2,"^https?://(www\\.)?gnoccaforum\\.com/",22,[1464],[{"e":3114}],[{"v":1464}],[{"c":3115}],[{"check":"none","timeout":2000,"wv":1464}],{}],[1,"gobiernodecanarias",2,"^https?://(\\w+\\.)?(gobiernodecanarias\\.org|gobcan\\.net)/",22,[3116],[{"e":3117}],[{"v":3116}],[{"c":3118},{"wv":3117},{"optional":true,"k":3119},{"c":3120}],[{"cc":3121}],{}],[1,"gov-pl-cookies-info",1,"^https?://([\\w-]+\\.)*gov\\.pl/",22,[3122],[{"e":3123}],[{"v":3124}],[{"h":3122}],[],{}],[1,"greatschools",2,"^https?://(www\\.)?greatschools\\.org/",22,[3125],[{"e":3126}],[{"v":3125}],[{"c":3126}],[{"cc":3127}],{}],[1,"groundnews",0,"^https://(www\\.)?ground\\.news/",22,[],[{"e":3128}],[{"v":3128}],[{"waitForThenClick":[".fixed:has([data-testid=closeCookieBanner])","xpath///button[contains(., 'Manage cookies')]"]},{"waitFor":["[data-testid=modal]","xpath///span[contains(., 'Essential cookies')]"]},{"click":["[data-testid=modal]","xpath///button[contains(., 'On')]"],"all":true,"optional":true},{"waitForThenClick":["[data-testid=modal]","xpath///button[contains(., 'Save & reload')]"]}],[],{}],[1,"groupama.fr",2,"^https?://(www\\.)?groupama\\.fr/",22,[3129],[{"e":3130}],[{"v":3129}],[{"timeout":10000,"c":3131}],[{"cc":3132}],{}],[1,"gundam-base-entry",2,"^https://(www\\.)?gundam-base-entry\\.net/",22,[3133],[{"e":3134}],[{"v":3134}],[{"c":3134},{"c":3135},{"check":"none","wv":3133}],[{"cc":3136}],{}],[1,"hamradio.com",1,"^https?://(www\\.)?hamradio\\.com/",22,[2840],[{"e":3137}],[{"v":2840}],[{"h":2840}],[],{}],[1,"hashicorp",2,"^https://[a-z]*\\.hashicorp\\.com/",22,[3138],[{"e":3138}],[{"v":3138}],[{"c":3139},{"c":3140}],[],{}],[1,"head-fi",2,"^https?://(www\\.)?head-fi\\.org/",22,[3141],[{"e":3142}],[{"v":3141}],[{"c":3142}],[{"timeout":1000,"check":"none","wv":3141}],{}],[1,"hearst-us",1,"^https://(www\\.)?(menshealth|womenshealthmag|cosmopolitan|esquire|elle|elledecor|harpersbazaar|goodhousekeeping|popularmechanics|caranddriver|delish|veranda|roadandtrack|bestproducts|countryliving|housebeautiful|bicycling|biography|pitchfork|prevention|runnersworld|thepioneerwoman|townandcountrymag|seventeen|oprahdaily|womansday|redbookmag|autoweek)\\.com/",10,[3143],[{"e":3143}],[{"check":"any","v":3143}],[{"h":3143}],[{"check":"none","v":3143}],{}],[1,"hetzner.com",2,"^https://www\\.hetzner\\.com/",22,[3144],[{"e":3144}],[{"v":3144}],[{"k":3145}],[],{}],[1,"hsbc-au",2,"^https://(www\\.)?hsbc\\.com\\.au/",22,[3146],[{"e":3147}],[{"v":3147}],[{"c":3148}],[{"check":"none","timeout":3000,"wv":3147}],{}],[1,"hyrabostad.se",2,"^https?://(www\\.)?hyrabostad\\.se/",22,[3149],[{"e":3150}],[{"v":3150}],[{"c":3151},{"wv":3152},{"if":{"e":3153},"then":[{"k":3153}]},{"retry":3,"retryInterval":400,"c":3154}],[{"check":"none","v":3155}],{}],[1,"ibanez",2,"^https?://www\\.ibanez\\.com/",22,[3156],[{"e":3157}],[{"v":3158}],[{"c":3157}],[{"cc":3159}],{}],[1,"idoctors.it",2,"^https?://(www\\.)?idoctors\\.it/",22,[3160,3161],[{"e":3160}],[{"v":3160}],[{"c":3162},{"wv":3161},{"if":{"e":3163},"then":[{"k":3164}]},{"retry":3,"retryInterval":500,"c":3165}],[{"cc":3166}],{}],[1,"ign.es",1,"^https?://(www\\.)?ign\\.es/",22,[3167],[{"e":3168}],[{"v":3167}],[{"h":3167}],[{"check":"none","v":3167}],{}],[1,"iisvaldagno",1,"^https?://(www\\.)?iisvaldagno\\.it/",22,[3169],[{"e":3170}],[{"v":3169}],[{"h":3169}],[{"check":"none","v":3169}],{}],[1,"imdb",0,"^https://(www\\.)?(m\\.)?imdb.com/",22,[3138],[{"e":3138}],[{"v":3138}],[{"c":3171}],[],{}],[1,"ing-de",0,"^https://(\\w+\\.)?ing\\.de/",10,[],[{"exists":["ing-cc-manager","ing-cc-dialog-level0"]}],[{"exists":["ing-cc-manager[is-open]","ing-cc-dialog-level0",".cc-l0__button__more"]}],[{"waitForThenClick":["ing-cc-manager","ing-cc-dialog-level0",".cc-l0__button__more"]}],[],{}],[1,"ing-nl",2,"^https://([a-z0-9-]+\\.)?ing\\.nl/",22,[],[{"exists":["ing-app-open-page","#cookieDialog","ing-feat-cookie-dialog-nl"]}],[{"visible":["ing-app-open-page","#cookieDialog","ing-feat-cookie-dialog-nl","ing-feat-global-cookie-preference","cookie-preference-main","[data-testid=reject]"]}],[{"waitForThenClick":["ing-app-open-page","#cookieDialog","ing-feat-cookie-dialog-nl","ing-feat-global-cookie-preference","cookie-preference-main","[data-testid=reject]"]}],[{"cc":3172}],{}],[1,"instagram",2,"^https://www\\.instagram\\.com/",22,[],[{"e":3173}],[{"v":3173}],[{"c":3174},{"wait":2000}],[],{}],[1,"intesasanpaolo",2,"^https?://(\\w+\\.)?intesasanpaolo\\.com/",22,[3175],[{"e":3176}],[{"v":3176}],[{"c":3176}],[{"cc":3177},{"negated":true,"cc":3178}],{}],[1,"io.no",0,"^https?://([a-z0-9-]+\\.)?io\\.no/",22,[3179],[{"e":3180}],[{"v":3179}],[{"c":3180}],[{"check":"none","timeout":1000,"wv":3179}],{}],[2,"istore.co.za",1,"^https?://(www\\.)?istore(preowned)?\\.co\\.za/",22,[289],[{"e":289}],[{"v":289}],[{"h":289},{"optional":true,"h":3181},{"removeClass":"no-scroll","selector":"body","optional":true}],[],{}],[1,"itopvpn.com",1,"^https://(www\\.)?itopvpn.com/",22,[],[{"e":3182}],[{"e":3182}],[{"h":3182}],[],{}],[1,"iubenda-rti",2,"^https?://([\\w-]+\\.)*(mediaset\\.it|meteo\\.it|wittytv\\.it|today\\.it|milanotoday\\.it|romatoday\\.it|padovaoggi\\.it|bolognatoday\\.it|torinotoday\\.it|genovatoday\\.it|trevisotoday\\.it)/",10,[1096],[{"e":3183}],[{"v":3183}],[{"c":3183},{"c":3184}],[],{}],[1,"iworks-footer-notice",2,"^https?://(www\\.)?prorankingi\\.pl/",22,[3185],[{"e":3185}],[{"v":3185},{"negated":true,"cc":3186}],[{"timeout":15000,"optional":true,"w":3187},{"retry":3,"retryInterval":1000,"c":3188}],[{"cc":3186}],{}],[1,"jetpens",2,"^https?://(www\\.)?jetpens\\.com/",22,[3189],[{"e":3190}],[{"v":3189}],[{"c":3191},{"wv":3192},{"all":true,"optional":true,"k":3193},{"k":3194},{"check":"none","timeout":2000,"wv":3189}],[],{}],[1,"jurahilfe-de",2,"^https?://(\\w+\\.)?jurahilfe\\.de/",22,[3195],[{"e":3196}],[{"v":3196}],[{"all":true,"optional":true,"k":3197},{"c":3198}],[{"cc":3199},{"cc":3200},{"cc":3201}],{}],[1,"justgiving.com",2,"^https://(?:[a-z0-9-]+\\.)?justgiving\\.com/",22,[3202],[{"any":[{"e":3202},{"e":3203}]}],[{"v":3202},{"e":3204}],[{"c":3204}],[{"wait":500},{"cc":3205}],{}],[1,"justwatch.com",2,"^https?://(\\w+\\.)?justwatch\\.com/",22,[3206],[{"e":3207}],[{"v":3207}],[{"k":3208},{"c":3209},{"all":true,"c":3210},{"all":true,"optional":true,"k":3211},{"wv":3212},{"k":3212}],[],{}],[1,"juzaphoto",2,"^https?://(\\w+\\.)?juzaphoto\\.com/",22,[3213],[{"e":3213}],[{"v":3213}],[{"c":3214}],[{"cc":3215}],{}],[1,"kanopy",2,"^https?://(www\\.)?kanopy\\.com/",22,[],[{"e":3216}],[{"v":3216}],[{"if":{"e":3217},"then":[{"c":3217}],"else":[{"c":3218}]},{"wv":3219},{"if":{"e":3220},"then":[{"k":3220}]},{"if":{"e":3221},"then":[{"k":3221}]},{"if":{"e":3222},"then":[{"k":3222}]},{"k":3219}],[],{}],[1,"kartverket",0,"^https?://([a-z0-9-]+\\.)?kartverket\\.no/",22,[3223],[{"e":3224}],[{"v":3224}],[{"c":3224},{"wv":3225},{"optional":true,"k":3226},{"k":3225}],[{"check":"none","timeout":1000,"wv":3225}],{}],[1,"kickstarter.com",2,"^https?://(www\\.)?kickstarter\\.com/",22,[3227],[{"e":3228}],[{"v":3228}],[{"c":3229}],[{"check":"none","v":3228}],{}],[1,"kingrecords-co-jp",2,"^https?://(?:[^/]+\\.)?kingrecords\\.co\\.jp/",22,[3230],[{"e":3231}],[{"v":3231}],[{"timeout":10000,"optional":true,"w":3232},{"c":3231},{"if":{"v":3233},"then":[{"wait":1000},{"k":3231}]},{"check":"none","timeout":5000,"wv":3233}],[{"cc":3234}],{}],[1,"kiwico",2,"^https?://(www\\.)?kiwico\\.com/",10,[3235],[{"e":3236}],[{"v":3237}],[{"c":3236},{"c":3238},{"check":"none","timeout":3000,"wv":3239},{"c":3240}],[{"check":"none","timeout":3000,"wv":3235}],{}],[1,"kleinanzeigen-de",2,"^https?://(www\\.)?kleinanzeigen\\.de",22,[3241],[{"e":3242}],[{"v":3242}],[{"k":3242}],[],{}],[1,"klimatabelle.com",2,"^https?://(www\\.)?klimatabelle\\.com/",22,[714],[{"e":3243}],[{"v":3243}],[{"c":3243}],[{"cc":3244}],{}],[1,"kuendigung.org",1,"^https?://(www\\.)?kuendigung\\.org/",22,[3245],[{"e":3246}],[{"v":3245}],[{"h":3245}],[{"check":"none","v":3245}],{}],[1,"la-becanerie",2,"^https://(www\\.)?la-becanerie\\.com/",22,[3247],[{"e":3248}],[{"v":3249}],[{"c":3250}],[{"cc":3251}],{}],[1,"lacoccinelle",2,"^https?://(\\w+\\.)?lacoccinelle\\.net/",22,[1533],[{"e":1533}],[{"check":"any","v":3252}],[{"if":{"e":1535},"then":[{"all":true,"retry":3,"c":1539},{"c":3253},{"timeout":5000,"optional":true,"c":3254}],"else":[{"c":3255},{"c":3256},{"check":"none","timeout":1500,"optional":true,"wv":1549},{"if":{"check":"any","v":3257},"then":[{"all":true,"k":3257},{"check":"none","timeout":5000,"wv":1549}]}]}],[{"check":"none","v":3252}],{}],[1,"lantmateriet",2,"^https?://(www\\.)?lantmateriet\\.se/",22,[3258],[{"e":3259}],[{"v":3260}],[{"c":3259}],[{"cc":3261}],{}],[3,"latrobe.edu.au",1,"^https?://(\\w+\\.)?latrobe\\.edu\\.au/",10,[3262],[{"e":3263}],[{"v":3262}],[{"h":3262},{"stylesheet":"body.gdpr-on #header { top: 0 !important; } body.vi #header #gdpr ~ #global-search-button, body.vi #header #gdpr ~ #global-search-button + label { top: 1.25rem; bottom: auto; }","stylesheetId":"latrobe-gdpr-layout"}],[],{}],[1,"leafly",1,"^https://(www\\.)?leafly\\.com/",22,[],[{"e":3264}],[{"v":3264}],[{"h":3264}],[],{}],[1,"legislation-gov-uk",2,"^https?://(\\w+\\.)?legislation\\.gov\\.uk/",22,[3265],[{"e":3266}],[{"v":3266}],[{"c":3266},{"timeout":3000,"optional":true,"c":3267}],[{"cc":3268}],{}],[1,"lego",2,"^https?://(www\\.)?lego\\.com/",22,[3269],[{"any":[{"e":3270},{"e":3271}]}],[{"any":[{"v":3270},{"v":3271}]}],[{"any":[{"cc":3272},{"timeout":3000,"wv":3271}],"optional":true},{"check":"none","timeout":120000,"wv":3271},{"c":3270},{"any":[{"cc":3272},{"timeout":3000,"wv":3271}],"optional":true},{"if":{"v":3271},"then":[{"check":"none","timeout":120000,"wv":3271},{"timeout":5000,"c":3270}],"optional":true}],[{"cc":3273}],{}],[1,"lendable",2,"^https?://([\\w-]+\\.)?lendable\\.co\\.uk/",22,[3274],[{"e":3275}],[{"v":3274}],[{"c":3276},{"c":3277},{"check":"none","wv":3274}],[{"cc":458}],{}],[1,"leukhuis-nl",1,"^https?://(www\\.)?leukhuis\\.nl/",22,[3278],[{"e":3279}],[{"v":3278}],[{"h":3278}],[{"check":"none","v":3278}],{}],[1,"lexbase.se",1,"^https?://(www\\.)?lexbase\\.se/",22,[3280],[{"e":3281}],[{"v":3280}],[{"h":3280}],[{"check":"none","v":3280}],{}],[1,"libris.nl",2,"^https?://(www\\.)?libris\\.nl/",22,[3282],[{"e":3283}],[{"v":3283}],[{"if":{"e":3284},"then":[{"all":true,"k":3284}]},{"c":3283}],[{"cc":3285}],{}],[1,"librus",2,"^https?://([a-z0-9-]+\\.)?librus\\.pl/",22,[3286],[{"e":3287}],[{"v":3287}],[{"c":3287},{"w":3288},{"if":{"e":3289},"then":[{"all":true,"k":3289}]},{"c":3290}],[{"check":"none","timeout":2000,"wv":3291}],{}],[1,"livsmedelsverket",2,"^https?://(\\w+\\.)?livsmedelsverket\\.se/",22,[34],[{"e":3292}],[{"v":3293}],[{"c":3292},{"wv":3294},{"all":true,"optional":true,"k":3295},{"k":3296}],[{"cc":3297}],{}],[1,"lucozade.com",2,"^https://(www\\.)?lucozade\\.com/",22,[2948,3298],[{"e":2948}],[{"v":2948}],[{"c":3299}],[{"cc":3300}],{}],[1,"lucrin",2,"^https?://(www\\.)?lucrin\\.(com|com\\.au|co\\.uk|ca|ch|de|es|fr|it)/",22,[3301,3302],[{"e":3303}],[{"v":289}],[{"c":3303},{"wv":3304},{"all":true,"optional":true,"k":3305},{"c":3304}],[{"cc":3306}],{}],[1,"luxmed",2,"^https?://([a-z0-9-]+\\.)?luxmed\\.pl/",22,[],[{"e":3307}],[{"v":3307}],[{"c":3308}],[{"cc":3309}],{}],[1,"mackeeper",0,"^https?://(\\w+\\.)?mackeeper\\.com/",22,[3310],[{"e":3311}],[{"v":3311}],[{"c":3312}],[{"cc":3313}],{}],[1,"mainichi",2,"^https?://(\\w+\\.)?mainichi\\.jp/",22,[],[{"e":3314},{"negated":true,"e":912}],[{"v":3314}],[{"c":3315}],[{"check":"none","timeout":2000,"wv":3316}],{}],[1,"mainlinemenswear",2,"^https://(www\\.)?mainlinemenswear\\.co\\.uk/",22,[3317],[{"e":3318}],[{"v":3318}],[{"c":3319},{"wv":3320},{"all":true,"optional":true,"k":3321},{"c":3322}],[],{}],[1,"makitatools",2,"^https://(www\\.)?makitatools\\.com/",22,[3323],[{"e":3323}],[{"v":3323}],[{"c":3324},{"c":3325},{"check":"none","wv":3323}],[{"check":"none","v":3323}],{}],[1,"malaysiaairlines.com",0,"^https?://(\\w+\\.)?malaysiaairlines\\.com/",22,[],[{"e":3326}],[{"v":3326}],[{"c":3327},{"wv":3328},{"all":true,"optional":true,"k":3329},{"c":3330}],[],{}],[1,"mango",2,"^https://(shop\\.mango|www\\.mangooutlet)\\.com/",22,[3331],[{"e":3332}],[{"v":3332}],[{"if":{"e":3333},"then":[{"retry":5,"retryInterval":500,"c":3333}],"else":[{"retry":5,"retryInterval":500,"c":3334},{"retry":5,"retryInterval":500,"c":3335}]}],[{"cc":3336}],{}],[1,"massaggiamilano",2,"^https?://(www\\.)?massagg(iamilano|iemozionali)\\.it/",22,[3337],[{"e":3338}],[{"v":3338}],[{"c":3338},{"c":3339}],[{"check":"none","timeout":5000,"wv":3340}],{}],[1,"massgeneralbrigham",0,"^https?://(\\w+\\.)?massgeneralbrigham\\.org/",22,[3341],[{"e":3342}],[{"v":3342}],[{"c":3342}],[{"negated":true,"e":3341}],{}],[1,"matemaks",1,"^https?://(www\\.)?matemaks\\.pl/",22,[3343],[{"e":3344}],[{"v":3343}],[{"h":3343}],[],{}],[1,"maticrobots-com",2,"^https?://(\\w+\\.)?maticrobots\\.com/",22,[3345],[{"e":3345}],[{"v":3345}],[{"c":3346},{"wv":3347},{"c":3348},{"c":3349}],[],{}],[1,"medium",1,"^https://([a-z0-9-]+\\.)?medium\\.com/",10,[],[{"e":3350}],[{"v":3350}],[{"h":3350}],[],{}],[1,"mega.io",2,"^https?://(\\w+\\.)?mega\\.(io|nz)/",22,[3351],[{"e":3352}],[{"v":3351}],[{"if":{"v":3353},"then":[{"k":3353}],"else":[{"k":3352},{"wv":3354},{"all":true,"optional":true,"k":3355},{"k":3354}]}],[{"cc":3166}],{}],[1,"merito.pl",2,"^https?://(\\w+\\.)?merito\\.pl/",22,[],[{"e":3356}],[{"v":3357}],[{"c":3358},{"wv":3359},{"all":true,"optional":true,"k":3360},{"k":3361}],[{"cc":3362}],{}],[1,"midway-usa",1,"^https://www\\.midwayusa\\.com/",22,[3363],[{"e":3363}],[{"v":3363}],[{"h":3363}],[],{}],[1,"miles-and-more",2,"^https://(www\\.)?miles-and-more\\.com/",22,[3364],[{"e":3365}],[{"v":3366}],[{"wait":500},{"c":3366}],[{"cc":3367}],{}],[1,"mipro.com.tw",2,"^https?://(\\w+\\.)?mipro\\.com\\.tw/",22,[3368],[{"e":3369}],[{"v":3370}],[{"c":3370}],[{"negated":true,"e":3368}],{}],[1,"mizuno.com",2,"^https?://(\\w+\\.)?mizuno\\.com/",22,[79],[{"e":3371}],[{"v":79}],[{"c":3371}],[{"cc":3372}],{}],[1,"mobile.de",2,"^https?://([a-z0-9-]+\\.)?mobile\\.de/",22,[3373],[{"e":3373}],[{"v":3374}],[{"retry":3,"retryInterval":500,"c":3375}],[{"wait":500},{"cc":3376}],{}],[1,"modelsociety",2,"^https?://(www\\.)?modelsociety\\.com/",22,[3377],[{"e":3377}],[{"v":3377}],[{"c":3378},{"timeout":3000,"optional":true,"c":3379}],[{"check":"none","timeout":2000,"wv":3377}],{}],[1,"money.co.uk",2,"^https?://(www\\.)?money\\.co\\.uk/",10,[3380],[{"e":3381}],[{"v":3381}],[{"all":true,"optional":true,"k":3382},{"c":3381}],[{"cc":3166}],{}],[1,"mq.edu.au",2,"^https?://(\\w+\\.)?mq\\.edu\\.au/",10,[3383],[{"exists":["mq-alert-cookies",".alert"]}],[{"visible":["mq-alert-cookies",".alert"],"check":"any"}],[{"if":{"exists":["mq-alert-cookies[variant=tiktok]",".alert .button.secondary"]},"then":[{"waitForThenClick":["mq-alert-cookies[variant=tiktok]",".alert .button.secondary"]}],"else":[{"waitForThenClick":["mq-alert-cookies[variant=cookies]",".alert .button-container button"]}]}],[{"waitForVisible":["mq-alert-cookies",".alert"],"check":"none","timeout":2000}],{}],[1,"msn",0,"^https?://(www\\.)?msn\\.com/",10,[3384,3385],[{"e":3384}],[{"v":3384}],[{"c":3386}],[{"cc":1947}],{}],[1,"myjobquote",2,"^https?://(www\\.)?myjobquote\\.co\\.uk/",22,[3387],[{"e":3388}],[{"v":3388}],[{"c":3389},{"wv":3390},{"all":true,"optional":true,"k":3391},{"k":3390}],[],{}],[1,"nba.com",1,"^https://(www\\.)?nba\\.com/",22,[3392],[{"e":3392}],[{"v":3392}],[{"h":3392}],[],{}],[1,"ndl-go-jp",2,"^https://([a-z0-9-]+\\.)?ndl\\.go\\.jp/",22,[3393],[{"e":3394}],[{"v":3394}],[{"c":3395}],[{"timeout":2000,"check":"none","wv":3394}],{}],[1,"nederlandseloterij",2,"^https?://([a-z0-9-]+\\.)?nederlandseloterij\\.nl/",22,[3396,3397],[{"e":3398}],[{"v":3398}],[{"c":3399}],[{"timeout":2000,"check":"none","wv":3400}],{}],[1,"nestpensions",0,"^https?://(www\\.)?nestpensions\\.org\\.uk/",22,[3401],[{"e":3402}],[{"v":3401}],[{"c":3402}],[{"cc":3403}],{}],[1,"netbeat.de",2,"^https://(www\\.)?netbeat\\.de/",22,[3404],[{"e":3404}],[{"v":3404}],[{"c":3405}],[],{}],[1,"newsbreak",0,"^https?://(www\\.)?newsbreak\\.com/",10,[],[{"e":3406}],[{"v":3406}],[{"c":3406}],[{"check":"none","timeout":2000,"wv":3406}],{}],[1,"nhm.ac.uk",1,"^https?://(\\w+\\.)?nhm\\.ac\\.uk/",22,[3407,3408],[{"e":3407}],[{"v":3407}],[{"h":3409}],[],{}],[1,"nhnieuws",2,"^https://(www\\.)?nhnieuws\\.nl/",22,[3410],[{"e":3411}],[{"check":"any","v":3411}],[{"c":3412}],[{"eval":"EVAL_NHNIEUWS_TEST"}],{}],[1,"nhs-jobs",2,"^https?://(\\w+\\.)?jobs\\.nhs\\.uk/",22,[34],[{"e":3413}],[{"v":3413}],[{"c":3413}],[],{}],[1,"nhsapp",2,"^https?://(\\w+\\.)?nhsapp\\.service\\.nhs\\.uk/",22,[3414],[{"e":3415}],[{"v":3416}],[{"c":3415}],[{"timeout":1000,"check":"none","wv":3416}],{}],[1,"niedziela-pl",1,"^https?://([\\w-]+\\.)?niedziela\\.pl/",22,[3417],[{"e":3418}],[{"v":3418}],[{"h":3417}],[{"check":"none","v":3418}],{}],[1,"nike",2,"^https://(www\\.)?nike\\.com/",22,[],[{"e":3419}],[{"v":3419}],[{"all":true,"c":3420},{"c":3421}],[],{}],[1,"nordea",2,"^https?://([a-z0-9-]+\\.)?nordea\\.(se|fi|no|dk)/",22,[],[{"e":3422}],[{"v":606}],[{"all":true,"optional":true,"k":3423},{"c":3424}],[{"cc":3425}],{}],[1,"nordnet",2,"^https?://(www\\.)?nordnet\\.(dk|se|no|fi)/",22,[],[{"e":3426}],[{"v":3426}],[{"c":3427}],[{"cc":3428}],{}],[1,"northwell.edu",1,"^https?://(\\w+\\.)?northwell\\.edu/",22,[3429],[{"exists":["nwhlit-gdpr-banner",".nwhlit-gdpr-banner"]}],[{"visible":["nwhlit-gdpr-banner",".nwhlit-gdpr-banner"]}],[{"h":3429}],[],{}],[1,"nos.nl",1,"^https://nos\\.nl/",22,[1366],[{"e":1366}],[{"visible":["ccm-notification"]}],[{"h":1366}],[],{}],[1,"nts-org-uk",2,"^https?://(\\w+\\.)?nts\\.org\\.uk/",22,[3430],[{"e":3431}],[{"v":3432}],[{"c":3433},{"timeout":2000,"wv":3431},{"if":{"e":3434},"then":[{"all":true,"k":3434}]},{"k":3431}],[{"cc":3435}],{}],[1,"nutritionix.com",0,"^https://(www\\.)?nutritionix\\.com/",22,[3436],[{"e":3436}],[{"v":3436}],[{"waitForThenClick":["gdpr-banner","xpath///button[contains(., 'Refuse')]"]}],[],{}],[1,"octopusenergy-it",2,"^https?://(www\\.)?octopusenergy\\.it/",22,[],[{"e":3437}],[{"v":3437}],[{"c":3437},{"w":3438},{"if":{"e":3439},"then":[{"k":3438}]},{"if":{"e":3440},"then":[{"k":3441}]},{"c":3442}],[{"cc":3443}],{}],[1,"ofsted-reports-cosmetic",1,"^https?://reports\\.ofsted\\.gov\\.uk/",22,[3444],[{"e":3445}],[{"v":3445}],[{"h":3444}],[{"check":"none","v":3445}],{}],[1,"ok",0,"^https://(\\w+\\.)?ok\\.ru/",22,[3446],[{"e":3447}],[{"v":3447}],[{"retry":6,"retryInterval":1000,"c":3448},{"wv":3449},{"wait":500},{"all":true,"optional":true,"k":3450},{"c":3451}],[],{}],[1,"olvg",2,"^https?://(www\\.)?olvg\\.nl/",22,[3452],[{"e":3453}],[{"v":3454}],[{"c":3453},{"c":3455},{"check":"none","timeout":2000,"optional":true,"wv":3452}],[{"cc":3456}],{}],[1,"onlineradiobox",1,"^https?://(\\w+\\.)?onlineradiobox\\.com/",22,[3457],[{"e":3458}],[{"v":3457}],[{"h":3457}],[{"check":"none","v":3457}],{}],[1,"onlyFans.com",2,"^https://onlyfans\\.com/",22,[3459],[{"e":3459}],[{"e":3459}],[{"k":3460},{"if":{"e":3461},"then":[{"all":true,"k":3462},{"k":3463}]}],[],{}],[1,"opalcollection-com",1,"^https://(www\\.)?opalcollection\\.com/",22,[3464],[{"v":3465}],[{"v":3464}],[{"h":3464}],[],{}],[1,"openai",0,"^https://([a-z0-9-]+\\.)?openai\\.com/",22,[3466],[{"e":3466}],[{"v":3466}],[{"c":3467}],[{"wait":500},{"cc":3468}],{}],[1,"opera.com",0,"^https?://(www\\.|)?opera\\.com/",22,[424],[{"e":3469}],[{"v":3469}],[{"all":true,"timeout":500,"optional":true,"c":3470},{"c":3471}],[{"cc":3472},{"negated":true,"cc":3473}],{}],[1,"optum",2,"^https?://(\\w+\\.)?optum\\.com/",22,[3474],[{"e":3475}],[{"v":3475}],[{"c":3475}],[{"check":"none","timeout":2000,"wv":3474}],{}],[1,"optyczne-pl",1,"^https?://(\\w+\\.)?optyczne\\.pl/",22,[3476],[{"e":3477}],[{"v":3476}],[{"h":3476}],[],{}],[1,"orbys",1,"^https?://(\\w+\\.)?orbys\\.eu/",22,[3478],[{"e":3479}],[{"v":3478}],[{"h":3478}],[{"check":"none","v":3478}],{}],[1,"osf.io",1,"^https?://(\\w+\\.)?osf\\.io/",22,[3480],[{"e":3481}],[{"v":3481}],[{"h":3480}],[],{}],[1,"oslosportslager.no",0,"^https?://(www\\.)?oslosportslager\\.no/",22,[3482],[{"e":3483}],[{"v":3482}],[{"c":3483}],[{"cc":3484}],{}],[1,"ourworldindata",2,"^https://ourworldindata\\.org/",22,[3485],[{"e":3485}],[{"v":3486}],[{"c":3487}],[],{}],[1,"palace-company",1,"^https://(www\\.)?(moonpalace|palaceresorts|leblancsparesorts|baglionihotels)\\.com/",22,[424,3488],[{"e":3489}],[{"v":3489}],[{"h":3490}],[],{}],[1,"paychex",1,"^https://(www\\.)?paychex\\.com/",22,[3491],[{"e":3491}],[{"v":3491}],[{"h":3491}],[],{}],[1,"payfip",1,"^https?://(www\\.)?payfip\\.gouv\\.fr/",22,[3492],[{"e":3493}],[{"check":"any","v":3492}],[{"h":3492}],[{"check":"none","v":3492}],{}],[1,"pcloud",2,"^https?://(\\w+\\.)?pcloud\\.com/",22,[],[{"e":3494}],[{"v":3494}],[{"c":3495},{"wv":3496},{"all":true,"optional":true,"k":3497},{"k":3498}],[{"cc":3499}],{}],[1,"pcspecialist",2,"^https?://(www\\.)?pcspecialist\\.[a-z.]+/",22,[3500,3501],[{"e":3502}],[{"v":3501}],[{"c":3502}],[{"cc":3503}],{}],[1,"pekao24",2,"^https?://(www\\.)?pekao24\\.pl/",22,[3504],[{"e":3505}],[{"v":3505}],[{"c":3506}],[{"cc":3507}],{}],[1,"pensionsmyndigheten",2,"^https?://(\\w+\\.)?pensionsmyndigheten\\.se/",22,[3508],[{"e":3508}],[{"v":3508}],[{"c":3509}],[{"cc":3510}],{}],[1,"pharmasave",2,"^https?://(www\\.)?pharmasave\\.com/",22,[3511],[{"e":3512}],[{"v":3512}],[{"retry":10,"retryInterval":500,"c":3513},{"check":"none","wv":3511}],[{"cc":3514}],{}],[1,"pinterest-business",2,"^https://[a-z]*\\.pinterest\\.com/",22,[3515],[{"e":3515}],[{"v":3516}],[{"c":3517}],[],{}],[1,"pitt-edu",1,"^https?://(\\w+\\.)?pitt\\.edu/",22,[3518],[{"e":3518}],[{"v":3518}],[{"h":3518}],[],{}],[1,"pizzapilgrims.co.uk",2,"^https?://(www\\.)?pizzapilgrims\\.co\\.uk/",10,[3519],[{"e":3520}],[{"v":3521}],[{"c":3522},{"wv":3523},{"all":true,"optional":true,"k":3524},{"k":3525}],[{"cc":3526},{"cc":3527}],{}],[1,"plex.tv",2,"^https?://(\\w+\\.)?plex\\.tv/",22,[3528,3529],[{"any":[{"e":3528},{"e":3530},{"e":3529}]}],[{"any":[{"v":3528},{"v":3530},{"v":3529}]}],[{"if":{"v":3530},"then":[{"c":3531},{"timeout":5000,"optional":true,"c":3532}],"else":[{"c":3533}]}],[{"cc":3534}],{}],[1,"plos",0,"^https://([.a-zA-Z0-9-]+\\.)?plos\\.org/",22,[424],[{"e":3535}],[{"v":3535}],[{"all":true,"optional":true,"k":3536},{"waitForThenClick":["#cookie-consent","xpath///button[contains(., 'Save Selected')]"]}],[{"cc":3537}],{}],[1,"podimo",2,"^https?://(www\\.)?podimo\\.com/",22,[],[{"e":3538}],[{"check":"any","v":3538}],[{"if":{"v":3539},"then":[{"c":3539}],"else":[{"c":3540}]},{"wv":3541},{"all":true,"optional":true,"k":3542},{"c":3543}],[{"cc":3544},{"negated":true,"cc":3545}],{}],[1,"poki",2,"^https?://(\\w+\\.)?poki\\.com/",22,[3546],[{"e":3547}],[{"v":3547}],[{"c":3547}],[{"check":"none","timeout":2000,"wv":3548}],{}],[1,"pornhub-compact-cookie-banner",0,"^https://(\\w+\\.)?pornhub\\.(com|org)/",22,[3549],[{"e":3550}],[{"v":3550}],[{"k":3550}],[],{}],[1,"pornhub.com",0,"^https://(\\w+\\.)?pornhub\\.(com|org)/",22,[3551],[{"e":3552}],[{"v":3552}],[{"if":{"e":3553},"then":[{"c":3553}]},{"if":{"e":3554},"then":[{"k":3554}],"else":[{"c":3555}]}],[],{}],[1,"pornpics.de",2,"^https?://(www\\.)?pornpics\\.(com|de)/",22,[],[{"e":3556}],[{"v":3556}],[{"c":3557}],[{"cc":3558}],{}],[1,"posthog",2,"^https?://(www\\.)?posthog\\.com/",22,[],[{"e":3559}],[{"v":3559}],[{"c":3560}],[{"check":"none","timeout":2000,"wv":3559}],{}],[2,"postnl",0,"^https://([a-z]*\\.)?postnl\\.nl/",22,[3561],[{"e":3561}],[{"visible":["pnl-cookie-wall-widget",".pnl-cookie-wall"]}],[{"waitForThenClick":["pnl-cookie-wall-widget",".cookie-overview__footer button.stamp-button--variant-secondary:last-child"]},{"waitForVisible":["pnl-cookie-wall-widget",".pnl-cookie-wall"],"check":"none","timeout":3000,"optional":true},{"setStyle":"","selector":"body","optional":true}],[{"cc":3562}],{}],[1,"povr",0,"^https://povr\\.com/",22,[],[{"e":3563}],[{"v":3563}],[{"h":3564},{"if":{"e":3565},"then":[{"w":3566},{"all":true,"optional":true,"k":3567},{"c":3568},{"eval":"EVAL_POVR_GOBACK"}],"else":[{"c":3569}]}],[],{}],[1,"praca-pl",2,"^https?://(www\\.)?praca\\.pl/",22,[3570],[{"e":3571}],[{"v":3571}],[{"c":3571},{"wv":3572},{"k":3571}],[{"check":"none","wv":3573}],{}],[1,"praktikertjanst",2,"^https?://(www\\.)?praktikertjanst\\.se/",22,[3574],[{"e":3575}],[{"v":3576}],[{"all":true,"optional":true,"k":3577},{"c":3576}],[{"cc":3578}],{}],[1,"productz.com",2,"^https://productz\\.com/",22,[],[{"e":3579}],[{"v":3579}],[{"c":3580}],[],{}],[1,"profiler-dk",1,"^https?://(www\\.)?(profiler|debtor)\\.dk/",22,[3581],[{"e":3582}],[{"v":3581}],[{"h":3581}],[],{}],[1,"publicmobile",2,"^https?://(www\\.)?publicmobile\\.ca/",22,[3583],[{"e":3583}],[{"v":3584}],[{"c":3585},{"wv":3586},{"all":true,"optional":true,"k":3587},{"c":3588},{"check":"none","timeout":3000,"wv":3584}],[{"cc":3589}],{}],[1,"puesc-gov-pl",2,"^https?://(www\\.)?puesc\\.gov\\.pl/",22,[3590],[{"e":3591}],[{"v":3591}],[{"retry":3,"retryInterval":500,"c":3591}],[{"cc":3592}],{}],[3,"racv",1,"^https?://(www\\.)?racv\\.com\\.au/",10,[3593],[{"e":3594}],[{"v":3594}],[{"h":3593},{"stylesheet":"body.gdpr-active { overflow: auto !important; } body.gdpr-active::before { display: none !important; }","stylesheetId":"racv-gdpr-backdrop"}],[],{}],[1,"raspberrypi.com",0,"^https://([a-z0-9-]+\\.)?raspberrypi\\.com/",10,[],[{"e":3595}],[{"v":3595}],[{"c":3595}],[{"check":"none","v":3595}],{}],[1,"readly",2,"^https://([a-z0-9-]+\\.)?readly\\.(com|co)/",22,[3596,3597],[{"e":3598}],[{"check":"any","v":3598}],[{"if":{"e":3599},"then":[{"c":3599}],"else":[{"c":3600},{"if":{"e":3601},"then":[{"all":true,"c":3601}],"else":[]},{"c":3602}]}],[],{}],[1,"reddit.com",2,"^https://(www|old)\\.reddit\\.com/",22,[3603],[{"e":3604}],[{"v":3604}],[{"c":3605}],[{"cc":3606}],{}],[1,"refurbed",2,"^https?://(www\\.)?refurbed\\.(com|co\\.uk|[a-z]{2})/",22,[3607],[{"e":3608}],[{"v":3607}],[{"c":3608},{"check":"none","timeout":2000,"wv":3607}],[{"cc":3609},{"cc":3610}],{}],[1,"regjeringen.no",2,"^https?://(www\\.)?regjeringen\\.no/",22,[3611],[{"e":3612}],[{"v":3613}],[{"c":3614}],[{"check":"none","timeout":2000,"wv":3611}],{}],[1,"rejestr.io",0,"^https?://(www\\.)?rejestr\\.io/",22,[],[{"e":3615}],[{"v":3615}],[{"c":3615}],[{"timeout":1000,"check":"none","wv":3615}],{}],[1,"remarkable.com",1,"^https://(www\\.)?remarkable\\.com/",22,[3616],[{"e":3617}],[{"v":3617}],[{"h":3616}],[],{}],[1,"reviewsolicitors.co.uk",2,"^https?://(www\\.)?reviewsolicitors\\.co\\.uk/",22,[3618,3619],[{"e":3620}],[{"v":3618}],[{"c":3621},{"wv":3622},{"wait":500},{"k":3622}],[{"cc":3623}],{}],[1,"rinkabyror-se",1,"^https?://(www\\.)?rinkabyror\\.se/",22,[3624],[{"e":3625}],[{"v":3624}],[{"h":3624}],[],{}],[1,"rittal",2,"^https?://(\\w+\\.)?rittal\\.com/",22,[3298],[{"e":3626}],[{"v":3626}],[{"c":3627}],[{"cc":3628}],{}],[1,"roblox",0,"^https://(www\\.)?roblox\\.com/",10,[],[{"e":3629}],[{"v":3630}],[{"c":3631}],[{"cc":3632}],{}],[1,"rog-forum.asus.com",2,"^https://rog-forum\\.asus\\.com/",22,[3633],[{"e":3633}],[{"v":3633}],[{"k":3634},{"c":3635}],[],{}],[1,"roll20",2,"^https://([a-z0-9-]+\\.)?roll20\\.net/",22,[3636],[{"e":3637}],[{"v":3636}],[{"c":3638},{"timeout":2000,"wv":3639},{"if":{"e":3640},"then":[{"k":3641}]},{"k":3642}],[{"cc":3643}],{}],[1,"romeo",2,"^https?://(www\\.)?romeo\\.com/",22,[],[{"e":3644}],[{"v":3644}],[{"c":3645},{"wv":3646},{"if":{"e":3647},"then":[{"k":3646}]},{"k":3648},{"check":"none","wv":3644}],[],{}],[1,"roofingmegastore.co.uk",2,"^https://(www\\.)?roofingmegastore\\.co\\.uk",22,[3649],[{"e":3649}],[{"v":3649}],[{"k":3650},{"c":3651}],[],{}],[1,"route-inn",2,"^https?://(\\w+\\.)?(route-inn|ark-hotel)\\.co\\.jp/",22,[3099],[{"e":3652}],[{"v":3653}],[{"c":3652}],[{"cc":3654}],{}],[1,"rspb.org.uk",0,"^https://(\\w+\\.)?rspb\\.org\\.uk/",10,[3655],[{"e":3655}],[{"v":3655}],[{"c":3656},{"wv":3657},{"c":3658}],[{"cc":3659}],{}],[1,"rt",1,"^https://(www\\.)?rt\\.com/",22,[3660],[{"e":3660}],[{"v":3660}],[{"h":3660}],[],{}],[1,"rug-nl",0,"^https?://(\\w+\\.)?rug\\.nl/",10,[3661],[{"e":3662}],[{"v":3661}],[{"c":3662}],[],{}],[1,"rule34-xxx",2,"^https?://(www\\.)?rule34\\.xxx/",22,[3663],[{"e":3663}],[{"v":3663}],[{"c":3664}],[{"cc":3665}],{}],[1,"rutjes",2,"^https?://(www\\.)?rutjes(paardenboxen\\.nl|pferdeboxen\\.de)/",22,[3607],[{"e":3666}],[{"v":3667}],[{"c":3667}],[{"wait":500},{"cc":3668}],{}],[1,"ryanair",0,"^https://(www\\.)?ryanair\\.com/",10,[3669],[{"e":3669}],[{"v":3669}],[{"c":3670}],[{"cc":3671}],{}],[1,"samsung.com",1,"^https://www\\.samsung\\.com/",22,[3672],[{"e":3672}],[{"v":3672}],[{"h":3672}],[],{}],[1,"saturdaysnyc",2,"^https?://(www\\.)?saturdaysnyc\\.com/",22,[3673],[{"e":3674}],[{"v":3673}],[{"c":3674}],[{"cc":3675}],{}],[1,"scb.se",2,"^https?://(www\\.)?scb\\.se/",22,[3676],[{"e":3677}],[{"v":3676}],[{"waitForThenClick":["#kakrutan scb-button[value='inget']","button"]}],[{"check":"none","v":3676}],{}],[1,"schadefonds",2,"^https?://(www\\.)?schadefonds\\.nl/",22,[2736],[{"e":3678}],[{"v":3678}],[{"timeout":2000,"optional":true,"w":3679},{"c":2738}],[],{}],[1,"schoolhouse-com",1,"^https://(www\\.)?schoolhouse\\.com/",22,[3680],[{"e":3680}],[{"v":3680}],[{"h":3680}],[],{}],[1,"schumacher.com",2,"^https?://(www\\.)?schumacher\\.com/",22,[],[{"e":3681}],[{"v":3681}],[{"if":{"e":3682},"then":[{"k":3682}],"else":[{"c":3683},{"c":3684}]}],[{"cc":3685},{"cc":3686},{"cc":3687}],{}],[1,"scmp",2,"^https://(www\\.)?scmp\\.com/",22,[3688],[{"any":[{"e":3689},{"e":912}]}],[{"any":[{"v":3689},{"v":2259}]}],[{"timeout":4000,"optional":true,"wv":2259},{"if":{"v":2259},"then":[{"k":914},{"all":true,"optional":true,"k":916},{"optional":true,"k":917}]},{"timeout":3000,"optional":true,"wv":3689},{"h":3688}],[],{}],[1,"scotland-police-uk",1,"^https?://(www\\.)?scotland\\.police\\.uk/",22,[3690],[{"e":3691}],[{"v":3691}],[{"h":3690}],[{"check":"none","v":3690}],{}],[1,"seg-social",2,"^https?://([a-z0-9-]+\\.)*seg-social\\.(gob\\.)?es/",22,[3692],[{"e":3693}],[{"v":3693}],[{"c":3693}],[{"cc":3694}],{}],[1,"seniorweb",2,"^https?://(www\\.)?seniorweb\\.nl/",22,[3695],[{"e":3695}],[{"v":3695}],[{"c":3696},{"wv":3697},{"k":3697},{"c":3698}],[{"cc":3699}],{}],[1,"serpstat-com",1,"^https://(\\w+\\.)?serpstat\\.com/",22,[3700],[{"e":3701}],[{"v":3701}],[{"h":3700}],[],{}],[1,"service2school",2,"^https?://(www\\.)?service2school\\.org/",22,[1729,1043],[{"e":1737},{"negated":true,"cc":3702}],[{"v":1731}],[{"h":1729},{"timeout":5000,"c":1044}],[{"cc":3703}],{}],[1,"sex.com",2,"^https?://(\\w+\\.)?sex\\.com/",22,[3704],[{"e":3705}],[{"v":3706}],[{"w":3707},{"c":3708},{"c":3709}],[{"cc":649}],{}],[1,"sfanytime",2,"^https?://(www\\.)?sfanytime\\.com/",22,[2970],[{"e":2970}],[{"v":2970}],[{"c":3710},{"wv":3711},{"all":true,"optional":true,"k":3712},{"c":3713}],[{"check":"none","v":2970}],{}],[1,"shein.com",2,"^https?://([a-z]+\\.)?shein\\.com/",22,[3714],[{"e":3715}],[{"v":3715}],[{"c":3715}],[{"timeout":1000,"check":"none","wv":3715}],{}],[1,"shimano-bike",1,"^https?://bike\\.shimano\\.com/",22,[3716],[{"e":3717}],[{"v":3716}],[{"h":3716}],[],{}],[1,"shinden.pl",2,"^https?://(www\\.)?shinden\\.pl/",22,[473],[{"e":3718}],[{"check":"any","v":3718}],[{"h":473},{"timeout":10000,"optional":true,"wv":1904},{"if":{"v":1904},"then":[{"retry":2,"retryInterval":500,"c":1905},{"c":1906},{"check":"none","wv":1904}]}],[],{}],[1,"shoezone",1,"^https?://(www\\.)?shoezone\\.com/",22,[3719],[{"e":3720}],[{"v":3719}],[{"h":3719}],[{"check":"none","v":3719}],{}],[1,"shopquarters",1,"^https?://(www\\.)?shopquarters\\.com/",22,[1644],[{"e":3721}],[{"check":"any","v":3722}],[{"h":3721},{"timeout":2000,"optional":true,"c":1645}],[],{}],[1,"simplehuman-com",2,"^https?://(www\\.)?simplehuman\\.com/",10,[3723],[{"e":3724}],[{"v":3725}],[{"c":3724},{"c":3726}],[],{}],[1,"simyo-nl",2,"^https?://(www\\.)?simyo\\.nl/",10,[3727],[{"v":3727}],[{"v":3727}],[{"c":3728}],[{"cc":3729}],{}],[1,"skatteverket-se",2,"^https?://(www\\.)?skatteverket\\.se/",22,[3730],[{"exists":["skv-cookie-banner",".skv-cookie-banner-root"]}],[{"visible":["skv-cookie-banner",".skv-cookie-banner-root"]}],[{"waitForThenClick":["skv-cookie-banner","#deny-all"]}],[{"cc":3731}],{}],[1,"skyscanner",0,"^https://(www\\.)?skyscanner[\\.a-z]+/",10,[3629],[{"e":3732}],[{"v":3732}],[{"c":3733},{"check":"none","wv":3732}],[{"eval":"EVAL_SKYSCANNER_TEST"}],{}],[1,"sl-se",2,"^https?://(www\\.)?sl\\.se/",22,[3734],[{"e":3735}],[{"v":3735}],[{"c":3735}],[{"cc":3736}],{}],[1,"smallpdf",2,"^https?://(www\\.)?smallpdf\\.com/",22,[],[{"e":3737}],[{"v":3737}],[{"c":3738},{"wv":3739},{"all":true,"optional":true,"k":3740},{"k":3739}],[{"cc":3741}],{}],[1,"smile-insurances",2,"^https?://(www\\.)?smile-insurances\\.com/",22,[3742],[{"e":3742}],[{"v":3743}],[{"c":3743}],[{"cc":3744}],{}],[1,"snb.ch",2,"^https?://(www\\.)?snb\\.ch/",22,[3745,3746],[{"e":3747}],[{"v":3748}],[{"c":3747},{"wv":3749},{"all":true,"optional":true,"k":3750},{"k":3749}],[{"check":"none","v":3745}],{}],[1,"solvhealth.com",2,"^https://(www\\.)?solvhealth\\.com/",22,[2949],[{"e":3751}],[{"v":2949}],[{"c":3752},{"check":"none","wv":2949}],[{"check":"none","v":2949}],{}],[1,"sostereo.com",2,"^https://(www\\.)?sostereo\\.com/",22,[3753],[{"e":3753}],[{"v":3753}],[{"c":3754},{"w":3755},{"all":true,"optional":true,"k":3756},{"c":3757}],[],{}],[1,"speciesplus.net",2,"^https?://(www\\.)?speciesplus\\.net/",22,[3758],[{"e":3759}],[{"v":3758}],[{"c":3760},{"check":"none","wv":3758}],[{"cc":3761}],{}],[1,"spermidinelife-us",1,"^https://(www\\.)?spermidinelife\\.us/",22,[3762],[{"e":3763}],[{"v":3764}],[{"h":3762}],[],{}],[3,"sportmedizin-rheuma",1,"^https?://(www\\.)?sportmedizin-rheuma\\.de/",22,[406],[{"e":407}],[{"v":407}],[{"h":3765},{"stylesheet":"body#home { overflow: visible !important; }"}],[],{}],[1,"sportsmans.com",2,"^https?://(www\\.)?sportsmans\\.com/",22,[3766],[{"e":3766},{"exists":[".dg-consent-banner","button.dg-button.reject_all"]}],[{"check":"any","v":3766}],[{"waitForThenClick":[".dg-consent-banner","button.dg-button.reject_all"]},{"h":3766}],[],{}],[1,"store2000.fr",2,"^https?://(www\\.)?store2000\\.fr/",22,[3767],[{"e":3767}],[{"v":3767}],[{"c":3768},{"h":3767}],[],{}],[1,"strato.de",2,"^https://www\\.strato\\.de/",22,[3769],[{"e":3770}],[{"v":3770}],[{"k":3771},{"c":3772}],[],{}],[1,"studentapan",2,"^https?://(www\\.)?studentapan\\.se/",22,[3773],[{"e":3773}],[{"v":3773}],[{"c":3774},{"wv":3775},{"all":true,"optional":true,"k":3776},{"c":3777}],[{"cc":3778}],{}],[1,"sujetdebac.fr",2,"^https?://(www\\.)?sujetdebac\\.fr/",22,[3779],[{"e":3779}],[{"v":3779}],[{"c":3780}],[{"check":"none","v":3779}],{}],[1,"svt.se",2,"^https://(\\w+\\.)?svt\\.se/",22,[3781],[{"e":3781}],[{"v":3782}],[{"c":3783}],[{"cc":3784}],{}],[1,"teacherspensions.co.uk",2,"^https?://(www\\.)?teacherspensions\\.co\\.uk/",10,[3785],[{"e":3786}],[{"v":3785}],[{"c":3786},{"wv":3787},{"all":true,"optional":true,"k":3788},{"k":3787}],[{"cc":3789}],{}],[1,"telegram-im",2,"^https?://(www\\.)?(telegram\\.im|telegramcn\\.org\\.cn|telegramim\\.ru)/",22,[3790],[{"e":3791}],[{"v":3790}],[{"c":3790}],[{"check":"none","v":3790}],{}],[1,"temu",2,"^https://([a-z0-9-]+\\.)?temu\\.com/",22,[],[{"e":3792}],[{"v":3792}],[{"c":3793}],[{"wait":500},{"cc":3794}],{}],[1,"tesco",0,"^https://(www\\.)?tesco\\.com/",22,[3795],[{"e":3795}],[{"v":3795}],[{"w":1943},{"c":3796}],[{"cc":3797}],{}],[1,"tesla",2,"^https://(www\\.)?tesla\\.com/",10,[],[{"e":221}],[{"v":221}],[{"c":3798}],[{"cc":3799}],{}],[1,"texas.gov",2,"^https?://(www\\.)?texas\\.gov/",22,[3800],[{"e":3801}],[{"check":"any","v":3802}],[{"if":{"v":3803},"then":[{"k":3803}],"else":[{"k":3804}]},{"check":"none","wv":3800}],[],{}],[1,"thecode",2,"^https?://(www\\.)?(thecode\\.co\\.uk|lovethesales\\.com)/",22,[3805],[{"e":3805}],[{"v":3806}],[{"c":3807},{"wv":3808},{"if":{"e":3809},"then":[{"k":3810}]},{"k":3811}],[{"wait":1000},{"cc":3812}],{}],[1,"thegrandyork",2,"^https?://(www\\.)?thegrandyork\\.co\\.uk/",22,[3813],[{"e":3814}],[{"v":3815}],[{"c":3814},{"wv":3816},{"all":true,"optional":true,"k":3817},{"k":3818}],[{"wait":500},{"cc":3819}],{}],[1,"theinfatuation",2,"^https://(www\\.)?theinfatuation\\.com",10,[2866],[{"e":3820}],[{"v":3820}],[{"c":3820}],[{"check":"none","v":2866}],{}],[1,"thenounproject",2,"^https?://(\\w+\\.)?thenounproject\\.com/",22,[3821],[{"e":3822}],[{"check":"any","v":3822}],[{"c":3822},{"any":[{"timeout":2000,"check":"any","wv":3823},{"k":3822}]},{"check":"any","wv":3823},{"all":true,"optional":true,"k":3824},{"c":3825}],[{"cc":649},{"cc":3826}],{}],[1,"thenude",0,"^https?://(www\\.)?thenude\\.com/",10,[3827],[{"e":3827}],[{"v":3827}],[{"c":3828},{"wv":3829},{"if":{"e":3830},"then":[{"k":3830},{"timeout":1000,"c":3831}]},{"if":{"e":3830},"then":[{"k":3830},{"timeout":1000,"c":3831}]},{"if":{"e":3830},"then":[{"k":3830},{"timeout":1000,"c":3831}]},{"if":{"e":3830},"then":[{"k":3830},{"timeout":1000,"c":3831}]},{"k":3832},{"check":"none","timeout":3000,"wv":3827}],[{"cc":1947},{"cc":3833}],{}],[1,"therealest",2,"^https?://([a-z0-9-]+\\.)?therealest\\.com/",22,[3834],[{"e":3834}],[{"v":3834}],[{"c":3835},{"c":3836},{"w":3837},{"c":3838}],[{"cc":649}],{}],[1,"thomsonlocal.com",2,"^https?://(www\\.)?thomsonlocal\\.com/",22,[2827],[{"e":3839}],[{"v":3840}],[{"c":3839}],[{"cc":3841}],{}],[1,"tinder",2,"^https?://(www\\.)?tinder\\.com/",22,[3842],[{"e":3842}],[{"v":3842}],[{"c":3843},{"c":3844}],[{"check":"none","timeout":2000,"wv":3842}],{}],[1,"tineye",1,"^https://(www\\.)?tineye\\.com/",22,[3845],[{"e":3845}],[{"v":3845}],[{"h":3845}],[{"check":"none","v":3845}],{}],[1,"tinyurl",1,"^https://tinyurl\\.com/",22,[3846],[{"e":3846}],[{"v":3846}],[{"h":3846}],[],{}],[1,"tiresize.com",0,"^https?://(www\\.)?tiresize\\.com/",22,[3847],[{"e":3848}],[{"v":3847}],[{"c":3848},{"check":"none","timeout":2000,"wv":3847}],[{"cc":3849}],{}],[1,"tk-aerztefuehrer.de",0,"^https?://(www\\.)?tk-aerztefuehrer\\.de/",10,[3850],[{"e":3850}],[{"v":3850}],[{"c":3851}],[{"cc":3852}],{}],[1,"tlc-direct",2,"^https?://(\\w+\\.)?tlc-direct\\.co\\.uk/",22,[424],[{"e":3853},{"e":3854}],[{"v":424}],[{"c":3855},{"if":{"e":3856},"then":[{"k":3857}]},{"if":{"e":3858},"then":[{"k":3859}]},{"c":3860}],[{"cc":3861}],{}],[1,"todostuslibros",2,"^https?://(www\\.)?todostuslibros\\.com/",22,[3862],[{"e":3863}],[{"v":3862}],[{"c":3864},{"wv":3863},{"if":{"e":3865},"then":[{"k":3866}]},{"if":{"e":3867},"then":[{"k":3868}]},{"k":3863}],[{"cc":3869},{"negated":true,"cc":3870}],{}],[1,"toho-one.com",2,"^https?://www\\.toho-one\\.com/",22,[],[{"e":3871}],[{"v":3871}],[{"c":3872},{"waitFor":["xpath///div[contains(@class, 'fixed') and .//button[normalize-space()='設定を保存する']]","input[type=checkbox]:checked:not(:disabled)"]},{"click":["xpath///div[contains(@class, 'fixed') and .//button[normalize-space()='設定を保存する']]","input[type=checkbox]:checked:not(:disabled)"],"all":true},{"c":3873}],[{"timeout":1000,"check":"none","wv":3871}],{}],[1,"tohotheater-jp",2,"^https?://(?:[^/]+\\.)?tohotheater\\.jp/",22,[3874],[{"e":3875}],[{"v":3874}],[{"c":3875},{"c":3876},{"c":3877},{"c":3878},{"c":3879},{"c":3880}],[{"cc":3881},{"cc":3882}],{}],[1,"track.amazon.com",2,"^https://[a-z]*\\.amazon\\.",22,[3883],[{"e":3884}],[{"v":3884}],[{"k":3885}],[],{}],[1,"tradecalculator.co.uk",2,"^https?://(www\\.)?tradecalculator\\.co\\.uk/",22,[],[{"e":3886}],[{"v":3886}],[{"if":{"e":3887},"then":[{"k":3887},{"timeout":1000,"w":3888}]},{"c":3889}],[{"check":"none","timeout":1000,"wv":3886}],{}],[1,"transip-nl",2,"^https://www\\.transip\\.nl/",22,[3890],[{"any":[{"e":3890},{"e":3891}]}],[{"any":[{"v":3890},{"v":3891}]}],[{"if":{"e":3891},"then":[{"k":3892}],"else":[{"k":3893}]}],[],{}],[1,"truecar",1,"^https://(www\\.)?truecar\\.com/",22,[3894],[{"e":3895}],[{"v":3895}],[{"h":3894}],[],{}],[1,"turkishairlines.com",2,"^https?://(\\w+\\.)?turkishairlines\\.com/",22,[3896],[{"e":3897}],[{"v":3898}],[{"c":3898}],[{"cc":3899}],{}],[1,"tvp",0,"^https?://(\\w+\\.)?tvp\\.pl/",10,[3900],[{"e":3901}],[{"v":3901}],[{"c":3902},{"w":3903},{"if":{"e":3904},"then":[{"k":3905}]},{"k":3903},{"check":"none","timeout":2000,"optional":true,"wv":3901}],[{"cc":3906}],{}],[1,"twitch.tv",2,"^https?://([\\w-]+\\.)?twitch\\.tv/",22,[3907],[{"e":3908}],[{"v":3908}],[{"if":{"e":3909},"then":[{"retry":3,"retryInterval":1000,"c":3910},{"check":"none","wv":3908}],"else":[{"c":3911},{"w":3912},{"all":true,"optional":true,"k":3913},{"c":3914},{"check":"none","wv":3915}]}],[],{}],[1,"ubisoft.com",2,"^https?://(\\w+\\.)?ubisoft\\.com/",22,[3091,3916],[{"e":3917}],[{"check":"any","v":3918}],[{"if":{"e":3919},"then":[{"c":3919}],"else":[{"c":3920},{"c":3921}]}],[{"cc":3922},{"cc":3923}],{}],[1,"uhcprovider",2,"^https?://(www\\.)?uhc(provider|dental)\\.com/",22,[3924],[{"e":3925}],[{"v":3924}],[{"c":3926}],[{"check":"none","timeout":2000,"wv":3924}],{}],[1,"unicourt",1,"^https://(www\\.)?unicourt\\.com/",22,[2840],[{"e":2840}],[{"v":2840}],[{"h":2840}],[],{}],[1,"unitedutilities",2,"^https?://(www\\.)?unitedutilities\\.com/",10,[3927],[{"e":3928}],[{"v":3929}],[{"c":3928},{"wv":3930},{"optional":true,"k":3931},{"optional":true,"k":3932},{"k":3930}],[{"cc":3933},{"cc":3934}],{}],[1,"unive-nl",0,"^https?://(?:[^/]+\\.)?unive\\.nl/",10,[3935],[{"e":3936}],[{"v":3935}],[{"c":3937}],[{"check":"none","timeout":2000,"wv":3935}],{}],[1,"unive.it",0,"^https?://(\\w+\\.)?unive\\.it/",22,[3938],[{"e":3939}],[{"any":[{"v":3939},{"negated":true,"cc":3940}]}],[{"timeout":15000,"wv":3939},{"retry":3,"retryInterval":500,"c":3939}],[{"cc":3940},{"negated":true,"cc":3941},{"negated":true,"cc":3942}],{}],[1,"urvaerket",2,"^https?://(www\\.)?(urvaerket\\.dk|uret\\.se|urverket\\.no|laatukellot\\.fi|thewatchagency\\.com)/",22,[3943],[{"e":3944}],[{"v":3944}],[{"c":3945}],[{"cc":3861}],{}],[1,"usherbrooke",2,"^https?://(\\w+\\.)?usherbrooke\\.ca/",22,[3946],[{"e":3947}],[{"v":233}],[{"c":3948},{"wv":3949},{"if":{"e":3858},"then":[{"k":3859}]},{"if":{"e":3950},"then":[{"k":3951}]},{"retry":3,"retryInterval":600,"c":3949},{"check":"none","wv":3952}],[],{}],[1,"uswitch.com",2,"^https://(www\\.)?uswitch\\.com/",10,[3953],[{"e":3954}],[{"v":3954}],[{"c":3955}],[],{}],[1,"uttings.co.uk",2,"^https?://(www\\.)?uttings\\.co\\.uk/",22,[714,3956],[{"e":3957}],[{"v":3957}],[{"c":3957},{"waitForVisible":["#colorbox iframe.cboxIframe","#cookie_notice_save"],"timeout":10000},{"click":["#colorbox iframe.cboxIframe",".cookie-field input[type=checkbox]:checked:not(:disabled)"],"all":true,"optional":true},{"waitForThenClick":["#colorbox iframe.cboxIframe","#cookie_notice_save"],"timeout":10000,"retry":5,"retryInterval":1000}],[{"cc":3958}],{}],[1,"uwv-nl",0,"^https?://(?:www\\.)?uwv\\.nl/",10,[3959],[{"e":3959}],[{"v":3960}],[{"c":3960}],[{"check":"none","timeout":2000,"wv":3960}],{}],[1,"vd-ch",0,"^https?://(\\w+\\.)?vd\\.ch/",22,[],[{"e":3961}],[{"v":3961}],[{"c":3961}],[{"cc":3962}],{}],[1,"venngage.com",2,"^https?://(\\w+\\.)?venngage\\.com/",22,[3963,3964],[{"e":3965},{"v":3966}],[{"v":3966}],[{"c":3965},{"c":3967}],[{"cc":3968}],{}],[1,"vgn.de",2,"^https?://(\\w+\\.)?vgn\\.de/",22,[3969],[{"e":3970}],[{"v":3971}],[{"if":{"e":3972},"then":[{"all":true,"k":3972}]},{"c":3970},{"check":"none","timeout":2000,"wv":3971}],[{"cc":3973},{"negated":true,"cc":3974}],{}],[1,"vinnova-se",2,"^https?://(www\\.)?vinnova\\.se/",22,[3975],[{"e":3976}],[{"v":3976}],[{"c":3977},{"wv":3978},{"if":{"e":3979},"then":[{"k":3979}]},{"c":3980}],[{"cc":3981}],{}],[1,"vmock",2,"^https?://(\\w+\\.)?vmock\\.com/",22,[3982,3983],[{"e":3984}],[{"v":3984}],[{"c":3984},{"c":3985},{"timeout":2000,"check":"none","wv":3983}],[{"cc":2034}],{}],[1,"vodafone.de",2,"^https://www\\.vodafone\\.de/",22,[3986],[{"e":3987}],[{"v":3988}],[{"k":3989}],[],{}],[1,"volvocars-com",2,"^https://([a-z0-9-]+\\.)?volvocars\\.com/",10,[3990],[{"exists":["cookie-banner#cookie-banner-host","#dialog_cookie_consent"]}],[{"visible":["cookie-banner#cookie-banner-host","#dialog_cookie_consent"]}],[{"wait":500},{"if":{"exists":["cookie-banner#cookie-banner-host","#onetrust-reject-all-handler"]},"then":[{"waitForThenClick":["cookie-banner#cookie-banner-host","#onetrust-reject-all-handler"]}],"else":[{"waitForThenClick":["cookie-banner#cookie-banner-host","#onetrust-pc-btn-handler"]},{"c":1944}]},{"waitForVisible":["cookie-banner#cookie-banner-host","#dialog_cookie_consent"],"check":"none","timeout":5000}],[{"cc":1947},{"cc":3991},{"cc":3992}],{}],[1,"vowels",1,"^https://(www\\.)?vowels\\.(net|jp)/",22,[3993],[{"e":3994}],[{"v":3995}],[{"h":3993}],[],{}],[1,"walmart-ca",0,"^https?://(www\\.)?walmart\\.ca/",22,[],[{"e":3996}],[{"v":3996}],[{"retry":5,"retryInterval":500,"c":3997},{"c":3998}],[{"check":"none","timeout":5000,"wv":3996}],{}],[1,"warszawa19115.pl",2,"^https?://(\\w+\\.)?warszawa19115\\.pl/",22,[],[{"e":3999}],[{"v":3999}],[{"c":4000},{"wv":4001},{"if":{"e":4002},"then":[{"all":true,"k":4002}]},{"k":4001}],[{"check":"none","timeout":3000,"wv":4003}],{}],[1,"web-rewind.com",0,"^https?://(www\\.)?web-rewind\\.com/",22,[],[{"e":4004}],[{"v":4004}],[{"all":true,"timeout":500,"optional":true,"c":4005},{"c":4004}],[],{}],[1,"westminster.ac.uk",2,"^https?://(\\w+\\.)?westminster\\.ac\\.uk/",22,[4006],[{"e":4007}],[{"v":4008}],[{"c":4009},{"wv":4010},{"all":true,"optional":true,"k":4011},{"k":4010}],[{"cc":4012},{"cc":4013}],{}],[1,"what3words",2,"^https?://(\\w+\\.)?what3words\\.com/",22,[],[{"e":4014}],[{"check":"any","v":4014}],[{"if":{"e":4015},"then":[{"k":4015},{"c":4016}],"else":[{"k":4017},{"c":4018}]},{"timeout":4000,"optional":true,"wv":2259},{"if":{"v":2259},"then":[{"k":914},{"all":true,"optional":true,"k":916},{"optional":true,"k":917}]}],[{"any":[{"cc":3861},{"cc":4019}]}],{}],[1,"wikiwand",1,"^https://(www\\.)?wikiwand\\.com/",22,[4020],[{"e":4020}],[{"v":4020}],[{"h":4020}],[],{}],[1,"wildling-com",1,"^https://(www\\.)?wildling\\.com/",22,[4021],[{"e":4022}],[{"v":4022}],[{"h":4021}],[],{}],[1,"wojsko-polskie-pl",1,"^https?://(www\\.)?wojsko-polskie\\.pl/",22,[4023],[{"e":4024}],[{"v":4023}],[{"h":4023}],[],{}],[1,"xe.com",2,"^https?://(www\\.)?xe\\.com/",22,[4025,4026],[{"e":4027}],[{"v":4027}],[{"retry":3,"retryInterval":500,"c":4028},{"wv":4029},{"c":4030}],[{"cc":4031}],{}],[1,"xhamster-eu",2,"^https://(\\w+\\.)?xhamster\\d?\\.com",22,[4032],[{"e":4033}],[{"v":4033}],[{"wv":4034},{"wait":500},{"k":4034},{"optional":true,"h":4035}],[],{}],[1,"xhamster-us",1,"^https://(\\w+\\.)?xhamster\\d?\\.com",22,[4036],[{"e":4036}],[{"v":4037}],[{"h":4036}],[],{}],[1,"xlbygg.se",2,"^https?://(\\w+\\.)?xlbygg\\.se/",22,[],[{"e":4038}],[{"v":4039}],[{"c":4040},{"wv":4041},{"all":true,"optional":true,"k":4042},{"k":4038}],[{"cc":4043}],{}],[1,"xtb",2,"^https?://(www\\.)?xtb\\.com/",22,[4044,3570],[{"e":4045}],[{"v":4044}],[{"c":4046},{"wv":4047},{"all":true,"optional":true,"k":4048},{"k":4047}],[{"check":"none","wv":4044},{"cc":4049}],{}],[1,"xvideos",2,"^https://[a-z]*\\.xvideos\\.com/",22,[],[{"e":2152}],[{"v":2153}],[{"c":2154}],[],{}],[1,"yachtclubgames.com",2,"^https?://(www\\.)?yachtclubgames\\.com/",22,[4050],[{"e":4050}],[{"v":4050}],[{"c":4051}],[{"timeout":1000,"check":"none","wv":4050}],{}],[1,"Yahoo",2,"^https://consent\\.yahoo\\.com/v2/",22,[1850],[{"e":4052}],[{"v":4052}],[{"c":4053}],[],{}],[1,"yourspares",2,"^https?://(www\\.)?yourspares\\.co\\.uk/",22,[4054,4055],[{"e":4056}],[{"v":4054}],[{"w":4057},{"k":4057},{"check":"none","wv":4054}],[{"cc":4058}],{}],[1,"yuntrack",2,"^https://(www\\.|m\\.)?yuntrack\\.com/",22,[4059],[{"e":4060}],[{"v":4059}],[{"c":4060},{"wv":4061},{"if":{"e":4062},"then":[{"all":true,"k":4062}]},{"c":4063}],[{"cc":4064}],{}],[1,"zentralruf-de",2,"^https://(www\\.)?zentralruf\\.de",22,[4065],[{"e":4065}],[{"v":4065}],[{"c":4066}],[],{}],[1,"zinio",0,"^https://(www\\.)?zinio\\.com/",22,[],[{"e":4067}],[{"v":4067}],[{"c":4068},{"c":4069}],[{"cc":4070}],{}],[1,"ziptozipmoving",2,"^https://(www\\.)?ziptozipmoving\\.com/",22,[],[{"e":4071}],[{"v":4071}],[{"c":4072},{"wv":4073},{"all":true,"optional":true,"k":4074},{"c":4075}],[{"cc":4076}],{}]],"index":{"genericRuleRange":[0,493],"frameRuleRange":[491,525],"specificRuleRange":[493,1355],"genericStringEnd":2182,"frameStringEnd":2246}} }, {"enabled":true,"autoAction":"optOut","disabledCmps":[],"enablePrehide":true,"enableCosmeticRules":true,"enableGeneratedRules":true,"enableHeuristicDetection":true,"heuristicMode":"reject","detectRetries":20,"isMainWorld":true,"prehideTimeout":2000,"enableFilterList":false,"logs":{"lifecycle":false,"rulesteps":false,"detectionsteps":false,"evals":false,"errors":false,"messages":false,"waits":false}});
"use strict";
(() => {
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

  // lib/rules.ts
  var SUPPORTED_RULE_STEP_VERSION = 3;

  // lib/random.ts
  function getRandomID() {
    if (crypto && typeof crypto.randomUUID !== "undefined") {
      return crypto.randomUUID();
    }
    return Math.random().toString();
  }

  // lib/eval-handler.ts
  var Deferred = class {
    constructor(id, timeout = 1e3) {
      this.id = id;
      this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      this.timer = window.setTimeout(() => {
        this.reject(new Error("timeout"));
      }, timeout);
    }
  };
  var evalState = {
    pending: /* @__PURE__ */ new Map(),
    sendContentMessage: null
  };
  function requestEval(code, snippetId) {
    if (!evalState.sendContentMessage) {
      return Promise.reject(new Error("AutoConsent is not initialized yet"));
    }
    const id = getRandomID();
    evalState.sendContentMessage({
      type: "eval",
      id,
      code,
      snippetId
    });
    const deferred = new Deferred(id);
    evalState.pending.set(deferred.id, deferred);
    return deferred.promise;
  }
  function resolveEval(id, value) {
    const deferred = evalState.pending.get(id);
    if (deferred) {
      evalState.pending.delete(id);
      deferred.timer && window.clearTimeout(deferred.timer);
      deferred.resolve(value);
    } else {
      console.warn("no eval #", id);
    }
  }

  // lib/utils.ts
  function getStyleElement(styleOverrideElementId = "autoconsent-css-rules") {
    const styleSelector = `style#${styleOverrideElementId}`;
    const existingElement = document.querySelector(styleSelector);
    if (existingElement && existingElement instanceof HTMLStyleElement) {
      return existingElement;
    } else {
      const parent = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
      const css = document.createElement("style");
      css.id = styleOverrideElementId;
      parent.appendChild(css);
      return css;
    }
  }
  function getHidingStyle(method) {
    const hidingSnippet = method === "opacity" ? `opacity: 0` : `display: none`;
    return `${hidingSnippet} !important; z-index: -1 !important; pointer-events: none !important;`;
  }
  function hideElements(styleEl, selector, method = "display") {
    const rule = `${selector} { ${getHidingStyle(method)} } `;
    if (styleEl instanceof HTMLStyleElement) {
      styleEl.innerText += rule;
      return selector.length > 0;
    }
    return false;
  }
  function appendStylesheetRule(styleEl, cssRule, marker) {
    if (!(styleEl instanceof HTMLStyleElement) || cssRule.length === 0) {
      return false;
    }
    const markerComment = marker ? `/* autoconsent:${marker} */` : "";
    if (markerComment && styleEl.innerText.includes(markerComment)) {
      return true;
    }
    if (!markerComment && styleEl.innerText.includes(cssRule.trim())) {
      return true;
    }
    styleEl.innerText += `${markerComment}${markerComment ? " " : ""}${cssRule} `;
    return true;
  }
  async function waitFor(predicate, maxTimes, interval) {
    const result = await predicate();
    if (!result && maxTimes > 0) {
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(waitFor(predicate, maxTimes - 1, interval));
        }, interval);
      });
    }
    return Promise.resolve(result);
  }
  function isElementVisible(elem) {
    if (!elem) {
      return false;
    }
    if (elem.offsetParent !== null) {
      return true;
    } else {
      const css = window.getComputedStyle(elem);
      if (css.position === "fixed" && css.display !== "none") {
        return true;
      }
    }
    return false;
  }
  function copyObject(data) {
    if (globalThis.structuredClone) {
      return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data));
  }
  function normalizeConfig(providedConfig) {
    const defaultConfig = {
      enabled: true,
      autoAction: "optOut",
      // if falsy, the extension will wait for an explicit user signal before opting in/out
      disabledCmps: [],
      enablePrehide: true,
      enableCosmeticRules: true,
      enableGeneratedRules: true,
      enableHeuristicDetection: false,
      enablePopupMutationObserver: false,
      detectRetries: 20,
      isMainWorld: false,
      prehideTimeout: 2e3,
      visualTest: false,
      logs: {
        lifecycle: false,
        rulesteps: false,
        detectionsteps: false,
        evals: false,
        errors: true,
        messages: false,
        waits: false
      },
      performanceLoggingEnabled: false,
      heuristicPopupSearchTimeout: 100,
      enableHeuristicHitTest: false,
      heuristicMode: "off"
      // heuristic disabled by default
    };
    const updatedConfig = copyObject(defaultConfig);
    for (const key of Object.keys(defaultConfig)) {
      if (typeof providedConfig[key] !== "undefined") {
        updatedConfig[key] = providedConfig[key];
      }
    }
    return updatedConfig;
  }
  function scheduleWhenIdle(callback, timeout = 500) {
    if (globalThis.requestIdleCallback) {
      requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, 0);
    }
  }
  function highlightNode(node) {
    const highlightedNode = node;
    if (!node.style) return;
    if (highlightedNode.__oldStyles !== void 0) {
      return;
    }
    if (node.hasAttribute("style")) {
      highlightedNode.__oldStyles = node.style.cssText;
    }
    node.style.animation = "pulsate .5s infinite";
    node.style.outline = "solid red";
    let styleTag = document.querySelector("style#autoconsent-debug-styles");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "autoconsent-debug-styles";
    }
    styleTag.textContent = `
      @keyframes pulsate {
        0% {
          outline-width: 8px;
          outline-offset: -4px;
        }
        50% {
          outline-width: 4px;
          outline-offset: -2px;
        }
        100% {
          outline-width: 8px;
          outline-offset: -4px;
        }
      }
    `;
    document.head.appendChild(styleTag);
  }
  function unhighlightNode(node) {
    const highlightedNode = node;
    if (!node.style || !node.hasAttribute("style")) return;
    if (highlightedNode.__oldStyles !== void 0) {
      node.style.cssText = highlightedNode.__oldStyles;
      delete highlightedNode.__oldStyles;
    } else {
      node.removeAttribute("style");
    }
  }
  function isTopFrame() {
    return window.top === window && (!globalThis.location.ancestorOrigins || globalThis.location.ancestorOrigins.length === 0);
  }

  // lib/eval-snippets.ts
  var snippets = {
    // code-based rules
    EVAL_0: () => console.log(1),
    EVAL_DIDOMI_OPT_OUT: () => {
      if (window.Didomi) {
        window.Didomi.setUserDisagreeToAll();
        return true;
      }
      return false;
    },
    EVAL_DIDOMI_TEST: () => {
      const purposes = window.Didomi?.getCurrentUserStatus?.()?.purposes;
      if (purposes) {
        return Object.values(purposes).some((p) => !p.enabled);
      }
      const disabled = window.Didomi?.getUserConsentStatusForAll?.()?.purposes?.disabled;
      return Array.isArray(disabled) && disabled.length > 0;
    },
    EVAL_CONSENTMANAGER_1: () => {
      const cmpData = window.__cmp?.("getCMPData");
      return !!cmpData && typeof cmpData === "object";
    },
    EVAL_CONSENTMANAGER_2: () => window.__cmp?.("consentStatus")?.userChoiceExists === false,
    EVAL_CONSENTMANAGER_3: () => __cmp("setConsent", 0),
    EVAL_CONSENTMANAGER_4: () => __cmp("setConsent", 1),
    EVAL_CONSENTMANAGER_5: () => __cmp("consentStatus").userChoiceExists,
    EVAL_CONSENTMANAGER_NCMP_REJECT: () => {
      if (typeof window.__npcmp !== "function") return false;
      window.__npcmp("reject");
      return true;
    },
    EVAL_CONSENTMANAGER_NCMP_ACCEPT: () => {
      if (typeof window.__npcmp !== "function") return false;
      window.__npcmp("save");
      return true;
    },
    EVAL_COOKIEBOT_1: () => !!window.Cookiebot,
    EVAL_COOKIEBOT_2: () => !window.Cookiebot.hasResponse && window.Cookiebot.dialog?.visible === true,
    EVAL_COOKIEBOT_3: () => window.Cookiebot.withdraw() || true,
    EVAL_COOKIEBOT_4: () => window.Cookiebot.hide() || true,
    EVAL_COOKIEBOT_5: () => window.Cookiebot.declined === true,
    EVAL_KLARO_1: () => {
      const config = globalThis.klaroConfig || globalThis.klaro?.getManager && globalThis.klaro.getManager().config;
      if (!config) {
        return true;
      }
      const optionalServices = (config.services || config.apps).filter((s) => !s.required).map((s) => s.name);
      if (klaro && klaro.getManager) {
        const manager = klaro.getManager();
        return optionalServices.every((name) => !manager.consents[name]);
      } else if (klaroConfig && klaroConfig.storageMethod === "cookie") {
        const cookieName = klaroConfig.cookieName || klaroConfig.storageName;
        const consents = JSON.parse(
          decodeURIComponent(
            document.cookie.split(";").find((c) => c.trim().startsWith(cookieName)).split("=")[1]
          )
        );
        return Object.keys(consents).filter((k) => optionalServices.includes(k)).every((k) => consents[k] === false);
      }
    },
    EVAL_KLARO_OPEN_POPUP: () => {
      klaro.show(void 0, true);
    },
    EVAL_KLARO_TRY_API_OPT_OUT: () => {
      if (window.klaro && typeof klaro.show === "function" && typeof klaro.getManager === "function") {
        try {
          klaro.getManager().changeAll(false);
          klaro.getManager().saveAndApplyConsents();
          return true;
        } catch (e) {
          console.warn(e);
          return false;
        }
      }
      return false;
    },
    EVAL_ONETRUST_1: () => window.OnetrustActiveGroups.split(",").filter((s) => s.length > 0).length <= 1,
    EVAL_TRUSTARC_TOP: () => window && window.truste && window.truste.eu.bindMap.prefCookie === "0",
    EVAL_TRUSTARC_FRAME_TEST: () => window && window.QueryString && window.QueryString.preferences === "0",
    EVAL_TRUSTARC_FRAME_GTM: () => window && window.QueryString && window.QueryString.gtm === "1",
    // declarative rules
    EVAL_ADOPT_TEST: () => !!localStorage.getItem("adoptConsentMode"),
    EVAL_ADULTFRIENDFINDER_TEST: () => !!localStorage.getItem("cookieConsent"),
    EVAL_AYLO_COOKIE_MANAGER_READY: () => !!(window.wl_cookie_consent_manager || window._Cookie_Consent_Manager_brand),
    EVAL_BAHN_TEST: () => utag.gdpr.getSelectedCategories().length === 1,
    EVAL_BIGCOMMERCE_CONSENT_MANAGER_DETECT: () => !!(window.consentManager && window.consentManager.version),
    EVAL_BORLABS_0: () => !JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((c) => c.indexOf("borlabs-cookie") !== -1).split("=", 2)[1]
      )
    ).consents.statistics,
    EVAL_CC_BANNER2_0: () => !!document.cookie.match(/sncc=[^;]+D%3Dtrue/),
    EVAL_COINBASE_0: () => JSON.parse(decodeURIComponent(document.cookie.match(/cm_(eu|default)_preferences=([0-9a-zA-Z\\{\\}\\[\\]%:]*);?/)[2])).consent.length <= 1,
    // the close icon is an SVG, which has no click() method
    EVAL_COOKIE_POPUP_CLOSE: () => document.querySelector("#cookie-popup #close-cookies").dispatchEvent(new MouseEvent("click", { bubbles: true })) || true,
    EVAL_COOKIE_LAW_INFO_0: () => {
      if (CLI.disableAllCookies) CLI.disableAllCookies();
      if (CLI.reject_close) CLI.reject_close();
      document.body.classList.remove("cli-barmodal-open");
      return true;
    },
    EVAL_COOKIE_LAW_INFO_DETECT: () => !!window.CLI,
    EVAL_COOKIE_MANAGER_POPUP_0: () => JSON.parse(
      document.cookie.split(";").find((c) => c.trim().startsWith("CookieLevel")).split("=")[1]
    ).social === false,
    EVAL_COOKIEALERT_0: () => document.querySelector("body").removeAttribute("style") || true,
    EVAL_COOKIEALERT_1: () => document.querySelector("body").removeAttribute("style") || true,
    EVAL_COOKIEALERT_2: () => window.CookieConsent.declined === true,
    EVAL_COOKIEFIRST_0: () => ((o) => o.performance === false && o.functional === false && o.advertising === false)(
      JSON.parse(
        decodeURIComponent(
          document.cookie.split(";").find((c) => c.indexOf("cookiefirst") !== -1).trim()
        ).split("=")[1]
      )
    ),
    EVAL_COOKIEFIRST_1: () => document.querySelectorAll("button[data-cookiefirst-accent-color=true][role=checkbox]:not([disabled])").forEach((i) => i.getAttribute("aria-checked") === "true" && i.click()) || true,
    EVAL_COOKIEINFORMATION_0: () => CookieInformation.declineAllCategories() || true,
    EVAL_COOKIEINFORMATION_1: () => CookieInformation.submitAllCategories() || true,
    // banner button order and meaning are configurable per site, so set the consent levels through the public API
    EVAL_COOKIEREPORTS_OPT_OUT: () => {
      const cr = window._cookiereports;
      if (typeof cr?.saveConsent !== "function") return false;
      cr.saveConsent({ 1: true, 2: false, 3: false, 4: false, 5: false });
      cr.processConsent("banner", { trigger: "ok" });
      cr.hideBanner();
      return true;
    },
    EVAL_COOKIEREPORTS_OPT_IN: () => {
      const cr = window._cookiereports;
      if (typeof cr?.saveConsent !== "function") return false;
      cr.saveConsent({ 1: true, 2: true, 3: true, 4: true, 5: true });
      cr.processConsent("banner", { trigger: "ok" });
      cr.hideBanner();
      return true;
    },
    EVAL_COOKIEREPORTS_TEST: () => {
      const levels = window._cookiereports?.loadConsent?.();
      return !!levels && Object.keys(levels).length > 0 && Object.values(levels).every((v) => !v);
    },
    // turn the single-button form into a decline submission, same fields as the CMP's own decline form
    EVAL_EE_CONSENT_DECLINE_0: () => document.querySelectorAll('#cookieConsentFormAccept input[name^="ee:cookies_"]').forEach((i) => i.value = "n") || true,
    EVAL_ETSY_0: () => document.querySelectorAll(".gdpr-overlay-body input").forEach((toggle) => {
      toggle.checked = false;
    }) || true,
    EVAL_ETSY_1: () => document.querySelector(".gdpr-overlay-view button[data-wt-overlay-close]").click() || true,
    EVAL_EZOIC_0: () => ezCMP.handleAcceptAllClick(),
    EVAL_FIDES_DETECT_POPUP: () => window.Fides?.initialized,
    EVAL_GDPR_LEGAL_COOKIE_DETECT_CMP: () => !!window.GDPR_LC,
    EVAL_GDPR_LEGAL_COOKIE_TEST: () => !!window.GDPR_LC?.userConsentSetting,
    EVAL_IUBENDA_0: () => document.querySelectorAll(".purposes-item input[type=checkbox]:not([disabled])").forEach((x) => {
      if (x.checked) x.click();
    }) || true,
    EVAL_IUBENDA_1: () => !!document.cookie.match(/_iub_cs-\d+=/),
    EVAL_KROWN_COOKIE_BANNER_TEST: () => localStorage.getItem("krown-cookie-banner") === "true",
    EVAL_MICROSOFT_0: () => Array.from(document.querySelectorAll("div > button")).filter((el) => el.innerText.match("Reject|Ablehnen"))[0].click() || true,
    EVAL_MICROSOFT_1: () => Array.from(document.querySelectorAll("div > button")).filter((el) => el.innerText.match("Accept|Annehmen"))[0].click() || true,
    EVAL_MICROSOFT_2: () => !!document.cookie.match("MSCC|GHCC"),
    EVAL_MOOVE_0: () => document.querySelectorAll("#moove_gdpr_cookie_modal input").forEach((i) => {
      if (!i.disabled) i.checked = i.name === "moove_gdpr_strict_cookies" || i.id === "moove_gdpr_strict_cookies";
    }) || true,
    EVAL_NHNIEUWS_TEST: () => !!localStorage.getItem("psh:cookies-seen"),
    EVAL_OSANO_DETECT: () => !!window.Osano?.cm?.dialogOpen,
    EVAL_PANDECTES_TEST: () => document.cookie.includes("_pandectes_gdpr=") && JSON.parse(
      atob(
        document.cookie.split(";").find((s) => s.trim().startsWith("_pandectes_gdpr")).split("=")[1]
      )
    ).status === "deny",
    EVAL_POVR_GOBACK: () => window.history.back() || true,
    EVAL_PUBTECH_0: () => document.cookie.includes("euconsent-v2") && (document.cookie.match(/.YAAAAAAAAAAA/) || document.cookie.match(/.aAAAAAAAAAAA/) || document.cookie.match(/.YAAACFgAAAAA/)),
    EVAL_SHOPIFY_TEST: () => document.cookie.includes("gdpr_cookie_consent=0") || document.cookie.includes("_tracking_consent=") && JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((s) => s.trim().startsWith("_tracking_consent")).split("=")[1]
      )
    ).purposes.a === false,
    EVAL_SKYSCANNER_TEST: () => document.cookie.match(/gdpr=[^;]*adverts:::false/) && !document.cookie.match(/gdpr=[^;]*init:::true/),
    EVAL_SIRDATA_UNBLOCK_SCROLL: () => {
      document.documentElement.classList.forEach((cls) => {
        if (cls.startsWith("sd-cmp-")) document.documentElement.classList.remove(cls);
      });
      return true;
    },
    EVAL_SOURCEPOINT_RESTORE_SCROLL: () => {
      const root = document.documentElement;
      const saved = root.dataset.previousScrollY;
      if (saved && saved !== "null") {
        root.dataset.previousScrollY = "null";
        const y = -parseInt(saved, 10);
        if (y > 0 && window.scrollY === 0) {
          const behavior = root.style.scrollBehavior;
          root.style.scrollBehavior = "auto";
          window.scrollTo(0, y);
          root.style.scrollBehavior = behavior;
        }
      }
      window.addEventListener("pagehide", () => {
        if (root.dataset.previousScrollY) root.dataset.previousScrollY = "null";
      });
      return true;
    },
    EVAL_STEAMPOWERED_0: () => JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((s) => s.trim().startsWith("cookieSettings")).split("=")[1]
      )
    ).preference_state === 2,
    EVAL_TAKEALOT_0: () => document.body.classList.remove("freeze") || (document.body.style = "") || true,
    EVAL_TARTEAUCITRON_0: () => tarteaucitron.userInterface.respondAll(false) || true,
    EVAL_TARTEAUCITRON_1: () => tarteaucitron.userInterface.respondAll(true) || true,
    EVAL_TARTEAUCITRON_2: () => document.cookie.match(/tarteaucitron=[^;]*/)?.[0].includes("false"),
    EVAL_TEALIUM_0: () => typeof window.utag !== "undefined" && typeof utag.gdpr === "object",
    EVAL_TEALIUM_1: () => utag.gdpr.setConsentValue(false) || true,
    EVAL_TEALIUM_DONOTSELL: () => utag.gdpr.dns?.setDnsState(false) || true,
    EVAL_TEALIUM_2: () => utag.gdpr.setConsentValue(true) || true,
    EVAL_TEALIUM_3: () => utag.gdpr.getConsentState() !== 1,
    EVAL_TEALIUM_DONOTSELL_CHECK: () => utag.gdpr.dns?.getDnsState() !== 1,
    EVAL_TESTCMP_STEP: () => !!document.querySelector("#reject-all"),
    EVAL_TESTCMP_0: () => window.results.results[0] === "button_clicked",
    EVAL_TESTCMP_COSMETIC_0: () => window.results.results[0] === "banner_hidden",
    EVAL_THEFREEDICTIONARY_0: () => cmpUi.showPurposes() || cmpUi.rejectAll() || true,
    EVAL_THEFREEDICTIONARY_1: () => cmpUi.allowAll() || true,
    EVAL_USERCENTRICS_API_0: () => typeof UC_UI === "object",
    EVAL_USERCENTRICS_API_1: () => !!UC_UI.closeCMP(),
    EVAL_USERCENTRICS_API_2: () => !!UC_UI.denyAllConsents(),
    EVAL_USERCENTRICS_API_3: () => !!UC_UI.acceptAllConsents(),
    EVAL_USERCENTRICS_API_4: () => !!UC_UI.closeCMP(),
    EVAL_USERCENTRICS_API_5: () => UC_UI.areAllConsentsAccepted() === true,
    EVAL_USERCENTRICS_API_6: () => UC_UI.areAllConsentsAccepted() === false,
    EVAL_USERCENTRICS_BUTTON_0: () => JSON.parse(localStorage.getItem("usercentrics")).consents.every((c) => c.isEssential || !c.consentStatus),
    EVAL_WAITROSE_0: () => Array.from(document.querySelectorAll("label[id$=cookies-deny-label]")).forEach((e) => e.click()) || true,
    EVAL_WBD_LTP_CLOSE: () => document.querySelector("dialog#ltp-dialog").close() || true
  };
  function getFunctionBody(snippetFunc) {
    const snippetStr = snippetFunc.toString();
    return `(${snippetStr})()`;
  }

  // lib/heuristic-patterns.ts
  var DETECT_PATTERNS = [
    /accept cookies/gi,
    /accept all/gi,
    /reject all/gi,
    /only necessary cookies/gi,
    // "only necessary" is probably too broad
    /(?:by continuing.{0,100}cookie)|(?:cookie.{0,100}by continuing)/gi,
    /(?:by continuing.{0,100}privacy)|(?:privacy.{0,100}by continuing)/gi,
    // up to two qualifiers are common: "optional", "essential", "analytics", "google analytics", "third party", ...
    /we (?:use|serve)(?: \w+){0,2} cookies/gi,
    /we are using cookies/gi,
    /use of cookies/gi,
    /website uses cookies to enhance your browsing experience/gi,
    /(?:this|our) (?:web)?site.{0,100}cookies/gi,
    /cookies (?:and|or) .{0,100} technologies/gi,
    /such as cookies/gi,
    /read more about.{0,100}cookies/gi,
    /consent to.{0,100}cookies/gi,
    /we and our partners.{0,100}cookies/gi,
    /we.{0,100}store.{0,100}information.{0,100}such as.{0,100}cookies/gi,
    /store and\/or access information.{0,100}on a device/gi,
    /personalised ads and content, ad and content measurement/gi,
    // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
    // /cookies? settings/i,
    // /cookies? preferences/i,
    // FR
    /utilisons.{0,100}des.{0,100}cookies/gi,
    /des.{0,100}cookies.{0,100}pour/gi,
    /retirer.{0,100}votre.{0,100}consentement/gi,
    /et.{0,100}nos.{0,100}partenaires/gi,
    /publicités.{0,100}et.{0,100}du.{0,100}contenu/gi,
    /utilise.{0,100}des.{0,100}cookies/gi,
    /utilisent.{0,100}des.{0,100}cookies/gi,
    /stocker.{0,100}et.{0,100}ou.{0,100}accéder/gi,
    /consentement.{0,100}à.{0,100}tout.{0,100}moment/gi,
    /votre.{0,100}consentement/gi,
    /accepter.{0,100}tout/gi,
    /utilisation.{0,100}des.{0,100}cookies/gi,
    /cookies.{0,100}ou.{0,100}technologies/gi,
    /acceptez.{0,100}l.{0,100}utilisation/gi,
    /continuer sans accepter/gi,
    /tout refuser/gi,
    /(?:refuser|rejeter) tous les cookies/gi,
    /je refuse/gi,
    /refuser et continuer/gi,
    /refuser les cookies/gi,
    /seulement nécessaires/gi,
    /je désactive les finalités non essentielles/gi,
    /cookies essentiels uniquement/gi,
    /nécessaires uniquement/gi,
    // DE
    /wir.{0,100}verwenden.{0,100}cookies/gi,
    /wir.{0,100}und.{0,100}unsere.{0,100}partner/gi,
    /zugriff.{0,100}auf.{0,100}informationen.{0,100}auf/gi,
    /inhalte.{0,100}messung.{0,100}von.{0,100}werbeleistung.{0,100}und/gi,
    /cookies.{0,100}und.{0,100}andere/gi,
    /verwendung.{0,100}von.{0,100}cookies/gi,
    /wir.{0,100}nutzen.{0,100}cookies/gi,
    /verwendet.{0,100}cookies/gi,
    /sie.{0,100}können.{0,100}ihre.{0,100}auswahl/gi,
    /und.{0,100}ähnliche.{0,100}technologien/gi,
    /cookies.{0,100}wir.{0,100}verwenden/gi,
    /alles?.{0,100}ablehnen/gi,
    /(?:nur|nicht).{0,100}(?:zusätzliche|essenzielle|funktionale|notwendige|erforderliche).{0,100}(?:cookies|akzeptieren|erlauben|ablehnen)/gi,
    /weiter.{0,100}(?:ohne|mit).{0,100}(?:einwilligung|zustimmung|cookies)/gi,
    /(?:cookies|einwilligung).{0,100}ablehnen/gi,
    /nur funktionale cookies akzeptieren/gi,
    /optionale ablehnen/gi,
    /zustimmung verweigern/gi,
    // NL
    /gebruik.{0,100}van.{0,100}cookies/gi,
    /(?:we|wij).{0,100}gebruiken.{0,100}cookies.{0,100}om/gi,
    /cookies.{0,100}en.{0,100}vergelijkbare/gi,
    /(?:alles|cookies).{0,100}(?:afwijzen|weigeren|verwerpen)/gi,
    /alleen.{0,100}noodzakelijke?\b/gi,
    /cookies weigeren/gi,
    /weiger.{0,100}(?:cookies|alles)/gi,
    /doorgaan zonder (?:te accepteren|akkoord te gaan)/gi,
    /alleen.{0,100}(?:optionele|functionele|functioneel|noodzakelijke|essentiële).{0,100}cookies/gi,
    /wijs alles af/gi,
    // Spanish (ES)
    /(si|al) contin[úu]a[sr]?( navegando)?.{0,100} cookie/gi,
    /(usamos|utilizar?|utilizamos)( (tanto|las))?.{0,20}cookie/gi,
    /\b(hacemos|hace) uso de cookies\b/gi,
    /\busa cookies de google\b/gi,
    /acepta.{0,80} uso de cookies/gi,
    /al utilizar nuestro sitio web.{0,80}cookie/gi,
    /almacenar la información en un dispositivo y\/?o acceder a ella/gi,
    /cookie.{0,30} utiliza/gi,
    /cookies propias y de/gi,
    /cookies.{0,80}son necesarias/gi,
    /est[ea] (sitio|página|web)( web)?( también)? (usa|utiliza|requiere del uso de|se sirven|emplea) cookies?/gi,
    /navegando.{0,100}cookie/gi,
    /nosotros y nuestros( \d+)? (socios|proveedores).{0,180} cookies/gi,
    /recopilamos y almacenamos datos de usted y de su dispositivo/gi,
    /utilizamos tecnolog[ií]as como las cookies/gi,
    // Polish (PL)
    // examples:
    //  wykorzystuje pliki cookie (uses cookies)
    //  Wykorzystujemy informacje w plikach cookie (We use information in cookies)
    /(używamy|stosujemy|stosuje|wykorzystujemy|wykorzyst(uje|ywane))( są)?.{0,20} plik(i|ów|ach) cookie/gi,
    /(używać|używamy).{0,80} (ciasteczek|cookie)/gi,
    /cele przetwarzania twoich danych przez zaufanych partnerów iab/gi,
    /dzięki (plikom cookie|ciasteczkom|cookie)/gi,
    /korzysta.{0,80} plików cookie/gi,
    /korzystamy z technologii, takich jak pliki cookie/gi,
    /korzystamy.{0,50} cookies/gi,
    /niektóre pliki cookies/gi,
    /pliki cookies i pokrewne im technologie umożliwiają poprawne działanie strony i pomagają nam dostosować ofertę do twoich potrzeb/gi,
    /przechowywanie informacji na urządzeniu lub dostęp do nich/gi,
    /przechowywanie plików cookie na swoim urządzeniu/gi,
    /przechowywać i uzyskiwać dostęp do informacji na twoich urządzeniach/gi,
    /przetwarzamy.{0,80} cookie/gi,
    /strona.{0,50} używa (ciasteczek|cookie)/gi,
    /ta strona korzysta z ciasteczek/gi,
    /uzyskujemy dostęp i przechowujemy informacje na urządzeniu/gi,
    /używa plik[ió]w? cookie/gi,
    /używamy plików.{0,20}cookie/gi,
    /wykorzystują .{0,100}cookie/gi,
    /za pomocą plików cookies.{0,100} my lub nasi partnerzy/gi,
    /zgodą my i nasi partnerzy możemy wykorzystywać precyzyjne dane geolokalizacyjne i identyfikację/gi,
    // Catalan (CA)
    /cookies pròpies i de tercers/gi,
    /utilitzem galetes/gi,
    /\búnicament utilitza galetes pròpies amb finalitat tècnica\b/gi,
    /este lloc web utilitza només cookies tècniques necessàries per al seu funcionament/gi,
    /utilitza cookies tècniques,\s*de personalització i anàlisi/gi,
    /utilitzem cookies i altres tecnologies/gi,
    // Basque (EU)
    /cookie propio eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/gi,
    /cookie propioak eta hirugarrenen cookieak erabiltzen ditugu/gi,
    /cookie propioak eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/gi,
    /cookie[-\s]*ak erabiltzen ditu/gi,
    /cookieak erabiltzen ditu/gi,
    /guk eta gure \d+ bazkideek cookieak eta identifikadoreak erabiltzen ditugu/gi,
    /norberaren eta hirugarrenen cookie-?ak baino ez ditu erabiltzen/gi,
    /web orri honek cookieak erabiltzen ditu/gi,
    /webgune honek cookie propioak eta hirugarrenen cookie-fitxategiak erabiltzen ditu/gi,
    // Galician (GL)
    /^\s*empregamos cookies propias\b/gi,
    /este portal emprega cookies propias ou de terceiros con fins analíticos/gi,
    // Russian (RU)
    // e.g. "мы используем файлы cookie", "сайт использует куки", "используются технологии cookie"
    // note: \w does not match Cyrillic, so these use explicit character ranges
    /использу[а-яё]*.{0,40}(?:файл[а-яё]*[\s-]+)?(?:cookie|куки)/gi,
    /(?:cookie|куки).{0,40}использу[а-яё]*/gi,
    /(?:использовани[а-яё]*|обработк[а-яё]*|хранени[а-яё]*).{0,20}(?:файл(?:ов|ы)[\s-]+)?(?:cookie|куки)/gi,
    /технологи[а-яё]*\s+(?:cookie|куки)/gi,
    // e.g. "сайт собирает cookie", "мы применяем файлы cookie", "сохраняем куки на вашем устройстве"
    /(?:собира[а-яё]*|сбор|применя[а-яё]*|сохраня[а-яё]*|размеща[а-яё]*|устанавлива[а-яё]*).{0,30}(?:файл[а-яё]*[\s-]+)?(?:cookie|куки)/gi,
    // "файлы cookie" / "cookie-файлы" / "куки-файлы" in any phrasing
    /(?:файл[а-яё]*[\s-]+(?:cookie|куки)|(?:cookie|куки)[\s-]+файл[а-яё]*)/gi,
    // Italian (IT)
    // e.g. "usiamo i cookie", "utilizziamo cookie tecnici", "questo sito utilizza i cookie", "noi e i nostri partner utilizziamo i cookie"
    /(?:usiamo|utilizziamo).{0,20}cookie/gi,
    /sito.{0,50}(?:usa|utilizza).{0,20}cookie/gi,
    /noi e i nostri.{0,20}partner.{0,100}cookie/gi,
    /(?:archiviare|memorizzare) e\/o accedere a informazioni su un dispositivo/gi,
    // Swedish (SV)
    // e.g. "vi använder cookies", "vi använder spårningstekniker såsom cookies", "webbplatsen använder kakor"
    /(?:vi|webbplatsen|webbplats|sajten|sidan)\s+använder.{0,60}(?:cookies|kakor)/gi,
    // Japanese (JA)
    // e.g. "当サイトはCookieを使用しています", "クッキー（Cookie）を利用しています"
    /(?:cookie|クッキー).{0,10}を(?:使用|利用)/gi,
    // Danish (DA)
    // e.g. "vi bruger cookies", "hjemmesiden bruger cookies til at ..."
    /bruger cookies/gi,
    // Norwegian (NO)
    // e.g. "vi bruker informasjonskapsler", "kan vi bruke valgfrie informasjonskapsler", "nettstedet bruker cookies"
    /\b(?:vi|nettstedet|nettsiden|siden)\s+bruker?\s.{0,60}?(?:informasjonskapsler|cookies)/gi
  ];
  var REJECT_PATTERNS_ENGLISH = [
    // e.g. "reject", "reject all", "reject all cookies", "deny all", "refuse cookies", "decline",
    // "reject non-essential cookies", "reject unnecessary cookies", "reject all but necessary", "reject all and close"
    // note that "reject and subscribe" and "reject and pay" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    /^\s*(no,?\s*)?(i\s+)?(reject|deny|refuse|decline|disable)\s*(all)?\s*(but|except)?\s*(non[- ]?essential|un(necessary|required)|optional|additional|targeting|analytics|marketing|non[- ]?necessary|extra|tracking|advertising|necessary|essential)?\s*(cookies)?\s*(and\s+close)?\s*$/is,
    // e.g. "i do not accept", "do not accept cookies", "i do not accept the use of cookies"
    /^\s*(no,?\s*)?(i\s+)?do\s+not\s+accept\s*(the\s+use\s+of\s+)?(any\s+)?(cookies)?\s*$/is,
    // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
    /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/is,
    // essential/necessary/functional-only, e.g. "essential cookies only", "accept only essential cookies",
    // "allow necessary cookies continue", "use essential cookies only", "functional only", "essential only cookies", "i confirm necessary"
    /^\s*(i\s+)?(want\s+to\s+)?(only\s+)?(use|accept|allow|keep|enable|choose|continue\s+with|i\s+confirm)\s*(only\s+)?(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s*(cookies)?\s*(continue|only)?\s*$/is,
    /^\s*(i\s+)?(want\s+to\s+)?only\s+(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s*(cookies)?\s*(continue|only)?\s*$/is,
    /^\s*(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s+((cookies\s+)?only|only\s+cookies)\s*$/is,
    // e.g. "do not sell or share my personal information", "do not share my personal information", "opt out of sale ..." (CCPA)
    // "do not sell page" is a link; "do not sellcookie settings" is two concatenated buttons
    /do\s+not\s+sell(?!\s*(page|cookie settings))|do\s+not\s+share\s+my\s+(personal\s+)?(information|info|data)|opt\s+out\s+of\s+sale/is,
    // e.g. "opt-out of sale/share or targeted advertising", "opt-out of advertising/social media cookies"
    /^opt[ -]?out of /is,
    // e.g. "reject all except strictly necessary", "reject all (except necessary cookies)"
    /except\s+(strictly\s+)?necessary/is,
    // e.g. "disagree", "i disagree", "disagree and close"
    /^(i\s+)?disagree\s*(and\s+close)?$/i,
    "no",
    /^no,? thank(s| you)$/is,
    /^opt[ -]out$/is,
    "dont enable",
    "i do not agree"
  ];
  var REJECT_PATTERNS_DUTCH = [
    // weigeren / afwijzen / verwerpen (reject verbs, any position)
    /weiger|afwijz|verwerp/is,
    // "wijs (alles/ze) af" (reject verb with split particle)
    /wijs\b.*\baf\b/is,
    // "alleen/enkel/uitsluitend ... (noodzakelijk|functioneel|essentieel|...)"
    /(^|\s)(alleen|enkel|uitsluitend)\s+.{0,20}(noodzakelijk|functione|essenti|vereiste|verplichte|strikt|minimale|basis|basic|standaard)/is,
    // essential/necessary-only nouns
    /^\s*(accepteer\s+|aanvaard\s+|gebruik\s+|sta\s+|ik wil\s+)?(alleen\s+|enkel\s+|uitsluitend\s+|strikt\s+)?(de\s+)?(noodzakelijke?|functionele?|functioneel|essentiële|essentieel|vereiste|verplichte|minimale|basiscookies|basis|standaard)\s*(cookies?)?\s*(accepteren|toestaan|aanvaarden)?\s*$/is,
    // continue without accepting / consent
    /(doorgaan|ga door|ga verder|verder)\s+.{0,15}(zonder|aanvaard)/is,
    // "nee" refusals (but not "nee, sluiten" → acknowledge)
    /^nee(,?\s+(bedankt|dank je|dankje|liever niet|liever geen cookies|geen persoonlijke cookies|geen cookies.*|weigeren?))?$/is,
    "niet accepteren",
    "niet akkoord",
    "ik ga niet akkoord",
    "liever niet",
    "geen cookies toestaan",
    "liever geen cookies",
    "functioneel altijd actief"
  ];
  var REJECT_PATTERNS_FRENCH = [
    // refuser / rejeter / interdire / décliner (reject verbs, any position)
    // "refuser et s'abonner" / "refuser et payer" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    // skip English prose such as "cookies that you can refuse"
    /^(?!.*\bcan refuse\b)(.*\s)?(refus|rejet|rejeter|interdire|interdis|déclin|declin)/is,
    // only necessary / essential / technical / functional
    /^(?=.*(cookie|nécessaire|essentiel|techni|requis|obligatoire|fonctionnel|indispensable|sdk)).*(uniquement|seulement|indispensable|strictement nécessaire|que les cookies\s+(nécessaires|techniques|essentiels|indispensables|fonctionnels))/is,
    // continue/proceed without accepting; refuse everything; disable purposes
    /(sans accepter|ne pas accepter|je naccepte rien|je désactive)/is,
    // "non" / "non, merci"
    /^non(,?\s+merci\.?)?$/is
  ];
  var REJECT_PATTERNS_GERMAN = [
    // "... ablehnen" / "ablehnen ..." (reject/decline). Exclude the settings-list phrase "einstell(ungen|en) oder ablehnen".
    /^(?!einstell(ungen|en) oder ablehnen$).*ablehnen/is,
    // verweigern / verweigere / verweigert (refuse)
    /verweiger/is,
    // essential/necessary/functional-only variants (accepting only necessary → reject)
    /^\s*(nur|ausschließlich|lediglich|weiter\s+mit|mit|akzeptiere?n?|unbedingt|es\s+werden\s+nur)?\s*(technisch\s+)?(notwendige?[nrs]?|essenzielle?[nrs]?|essentielle?[nrs]?|erforderliche?[nrs]?|funktionale?[nrs]?|funktionelle?[nrs]?|wesentliche?[nrs]?)\s*(cookies?|technologien|funktionscookies|dienste)?\s*(akzeptieren|erlauben|zulassen|verwenden|annehmen|setzen|speichern|zustimmen|auswählen)?\.?\s*$/is,
    // continue without consent
    /(^|\s)(ohne\s+(zu\s+)?(einwilligung|zustimmung|einverständnis|annahme|annehmen|akzeptanz|akzeptieren)|(weiter|fortfahren)\s+ohne)/is,
    // negations / refusals not covered by the regexes above
    "nein, danke",
    "nein, bitte nicht",
    "nein, ich stimme nicht zu",
    "nicht zustimmen",
    "nicht einverstanden",
    "ich lehne ab",
    "mit erforderlichen einstellungen fortfahren",
    "mit erforderlichen cookies fortfahren",
    "mit notwendigen fortfahren"
  ];
  var REJECT_PATTERNS_ITALIAN = [
    // rifiuta / rifiutare / rifiuto / nega / negare / blocca (reject verbs)
    /(^|\s)(rifiut|neg(a|are|hi)|blocca i cookie)/is,
    // accept/use only necessary / essential / technical
    /^\s*(accetta|accettare|usa|installa|consenti|chiudi e prosegui( solo con)?)?\s*(solo|soltanto|unicamente)?\s*(i\s+|gli\s+)?(cookies?\s+)?(strettamente\s+)?(necessari|necessary|essenziali|tecnici|di navigazione)\s*(necessari|tecnici|essenziali)?\s*$/is,
    // continue without accepting
    /continua(re)? senza accettare/is,
    "non accetto"
  ];
  var REJECT_PATTERNS_BRAZILIAN_PORTUGUESE = [
    // (deny)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*$/is,
    // (proceed) (without accepting)
    /^\s*(continuar|prosseguir|seguir)\s*(sem\s*aceitar)\s*$/is,
    // (deny) (everything) (optional)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(tudo|o)?\s*(opcional|(não[-\s](essencial|funcional|obrigatório|necessário)))?\s*$/is,
    // (deny) (all) (the) (optional) (cookies)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(todos)?\s*(os)?\s*(cookies)?\s*(opcionais|(não[-\s](essenciais|funcionais|obrigatórios|necessários)))?\s*$/is,
    // (accept) (only) (the) (essential)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(o)?\s*(essencial|funcional|obrigatório|necessário)\s*$/is,
    // (accept) (only) (the) (essential) (cookies)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(os)?\s*(cookies)?\s*(essenciais|funcionais|obrigatórios|necessários)\s*$/is
  ];
  var REJECT_PATTERNS_SPANISH = [
    // rechazar / denegar / declinar / negar (reject verbs, any position)
    // "rechazar y pagar" / "rechazar y suscribirse" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    /(^|\s)(rechaz|recház|deneg|negar|declin)/is,
    // accept/allow/use (only) necessary / essential / technical / functional / own
    /^\s*(aceptar?|acepta|permitir|permite|usar|utilizar)?\s*(solo|sólo|només|únicamente)?\s*(las?\s+|los\s+)?(cookies?\s+)?(estrictamente\s+)?(necesari\w*|esencial\w*|técnic\w*|obligatori\w*|funcional\w*|propias)\s*$/is,
    // "solo/sólo/no, sólo ... necessary/essential"
    /^(no,?\s+)?(solo|sólo|només)\s+(usar\s+|las?\s+|los\s+|lo\s+)?.{0,20}(necesari|esencial|estrictamente)/is,
    // refusals / opt-outs
    /^(no acept|no consentir|no permitir|no estoy de acuerdo|no,? gracias|sin consentimiento|continuar sin aceptar|prefiero rechazarlas|descartar todas)/is,
    "acceptar nom\xE9s les necess\xE0ries",
    "nom\xE9s sutilitzen cookies quan \xE9s necessari",
    "pulsa aqu\xED para desactivar las cookies opcionales"
  ];
  var REJECT_PATTERNS_SWEDISH = [
    // avvisa / avböj / neka / förneka (reject verbs)
    /(^|\s)(avvisa|avböj|neka|nekar|förneka)/is,
    // (allow/accept/use) only necessary cookies/kakor
    /(bara|endast|enbart)\s+nödvändig/is,
    // "godkänn/acceptera/använd/tillåt (bara/endast/enbart) nödvändiga (cookies/kakor)"
    /^(ok,?\s+|nej,?\s+)?(jag\s+)?(godkänn\w*|godta|acceptera\w*|använd\w*|tillåt|spara)?\s*(bara|endast|enbart)?\s*(strikt\s+)?nödvändiga?t?( (cookies|kakor|tjänster))?\.?$/is,
    // continue without accepting
    /fortsätt utan att (acceptera|godkänna)/is,
    /strikt nödvändig/is,
    "till\xE5t inte cookies",
    "jag accepterar endast grundl\xE4ggande kakor"
  ];
  var REJECT_PATTERNS_DANISH = [
    // afvis / afvis alle / afvis alle cookies (reject verbs)
    /(^|\s)afvis/is,
    // (accept/allow) only necessary cookies
    /^(accepter\s+|tillad\s+)?(kun|udelukkende)\s+(strengt\s+)?nødvendige( cookies)?$/is,
    // "nej tak" (no thanks)
    /^nej(,?\s+tak)?$/is
  ];
  var REJECT_PATTERNS_NORWEGIAN = [
    // avvis / avslå (reject verbs)
    /(^|\s)(avvis|avslå)/is,
    // (accept/allow/use) only necessary cookies
    /^(godta\s+|tillat\s+|aksepter\s+|bruk\s+)?(kun|bare)\s+(strengt\s+)?nødvendige( (informasjonskapsler|cookies))?$/is,
    // "nei" / "nei takk" (no thanks)
    /^nei(,?\s+takk)?$/is
  ];
  var REJECT_PATTERNS_CATALAN = [
    /(^|\s)rebutj/is,
    "no accepto",
    "no, gr\xE0cies",
    // accept/allow/use (only) necessary / essential / technical / functional
    /^\s*(acceptar?|accepto|permetre|utilitzar|usar)?\s*(només|sols|únicament)?\s*(les\s+|els\s+)?(galetes\s+|cookies?\s+)?(estrictament\s+)?(necess[aà]ri\w*|essencial\w*|tècni\w*|funcional\w*|imprescindibles)\s*$/is,
    // continue without accepting
    /^continuar sense acceptar/is
  ];
  var REJECT_PATTERNS_GALICIAN = [/(^|\s)rexeitar/is];
  var REJECT_PATTERNS_BASQUE = [/(^|\s)(baztertu|ukatu)/is];
  var REJECT_PATTERNS_PORTUGUESE = [/^aceitar apenas cookies essenciais\.$/];
  var REJECT_PATTERNS_CZECH = ["povolit pouze nezbytn\xE9 cookie"];
  var REJECT_PATTERNS_POLISH = [
    // odrzuć / odrzucam / odmawiam / rezygnuję / blokuj wszystkie (reject verbs)
    /odrzu(ć|cam|cenie|cać|canie|cić)|odmaw|odmowa|odmów|rezygnuj|blokuj wszystk/is,
    // (accept) only necessary / required
    /(^|\s)tylko\s+(bezwzględnie\s+)?(niezbędn\w*|wymagan\w*|konieczne)/is,
    /(akceptuj|akceptuję|zaakceptuj|zatwierdź|potwierdzam|zezwól)\s+(tylko\s+)?(na\s+)?(niezbędn\w*|wymagan\w*|konieczne)/is,
    /korzystaj wyłącznie z niezbędn/is,
    // continue without accepting / consent
    /kontynuuj bez (akceptacj|akceptowani|wyrażania zgody)/is,
    // refusals
    /nie (akceptuję|zgadzam|wyrażam zgody|wyrażaj zgody|zezwalaj|potwierdzam)/is,
    /^nie(,?\s+(dziękuję|nie zgadzam.*))?$/is,
    "niezb\u0119dne",
    "niezb\u0119dne pliki cookie",
    /^funkcjonalne pliki cookie \(wymagane\)$/
  ];
  var REJECT_PATTERNS_RUSSIAN = [
    // отклонить / отказаться / запретить (reject verbs); \w does not match Cyrillic
    /(^|\s)(отклон[а-яё]*|отказ[а-яё]*|откаж[а-яё]*|запрет[а-яё]*|запрещ[а-яё]*)/is,
    // "только необходимые (файлы cookie)" / "принять только необходимые куки"
    /^\s*(принять\s+|принима[а-яё]+\s+|разрешить\s+|использовать\s+|оставить\s+)?(только|лишь)\s+(строго\s+)?(необходим[а-яё]+|нужн[а-яё]+|обязательн[а-яё]+|техническ[а-яё]+|функциональн[а-яё]+)(\s+файл[а-яё]*)?([\s-]+(cookie|куки)([\s-]+файл[а-яё]*)?)?\s*$/is,
    // refusals: "не принимаю", "не согласен", "не соглашаюсь", "нет, спасибо"
    /^\s*(не\s+(принима[а-яё]+|соглас[а-яё]+|разреша[а-яё]+|хочу)|нет(,?\s+спасибо)?)\s*$/is
  ];
  var REJECT_PATTERNS_TURKISH = ["reddet", "\xE7erezleri reddet"];
  var REJECT_PATTERNS_INDONESIAN = ["tolak cookie"];
  var REJECT_PATTERNS_JAPANESE = [
    // e.g. "拒否", "すべて拒否", "全て拒否する", "cookieを拒否"
    /^(すべて|全て)?\s?(の)?(cookie|クッキー)?\s?(を)?拒否(する)?$/i,
    "\u540C\u610F\u3057\u306A\u3044",
    "\u540C\u610F\u3057\u307E\u305B\u3093"
  ];
  var REJECT_PATTERNS = [
    ...REJECT_PATTERNS_ENGLISH,
    ...REJECT_PATTERNS_DUTCH,
    ...REJECT_PATTERNS_FRENCH,
    ...REJECT_PATTERNS_GERMAN,
    ...REJECT_PATTERNS_ITALIAN,
    ...REJECT_PATTERNS_BRAZILIAN_PORTUGUESE,
    ...REJECT_PATTERNS_SPANISH,
    ...REJECT_PATTERNS_SWEDISH,
    ...REJECT_PATTERNS_DANISH,
    ...REJECT_PATTERNS_NORWEGIAN,
    ...REJECT_PATTERNS_CATALAN,
    ...REJECT_PATTERNS_GALICIAN,
    ...REJECT_PATTERNS_BASQUE,
    ...REJECT_PATTERNS_PORTUGUESE,
    ...REJECT_PATTERNS_CZECH,
    ...REJECT_PATTERNS_POLISH,
    ...REJECT_PATTERNS_RUSSIAN,
    ...REJECT_PATTERNS_TURKISH,
    ...REJECT_PATTERNS_INDONESIAN,
    ...REJECT_PATTERNS_JAPANESE
  ];
  var BUTTON_NEVER_MATCH_PATTERNS = [
    // text of several concatenated buttons, or popup body text rather than a button
    /accept all.*reject all|reject all.*accept all/is,
    /^.{300,}$/s,
    /pay|subscribe/is,
    /abonneer/is,
    /abonnier/is,
    /abonner/is,
    /abbonati/is,
    /iscriviti/is,
    /abbonare/is,
    /iscrivere/is,
    /sostienici/is,
    /suscribir/is,
    // Spanish (ES)
    /^abandonar este sitio$/,
    /suscribo/,
    /^accede gratis con cookies publicitarias$/,
    /pagar/,
    /suscríbete/,
    /sin cookies .{0,10}euro/s,
    // Polish (PL)
    /subskrybuj/,
    // Russian (RU): paywall/subscription wording, e.g. "отказаться от подписки", "оплатить"
    /подписатьс|подписк|оплатит|оплачива/is
  ];
  var DETECT_NEVER_MATCH_PATTERNS = [
    // e.g. "age verification", "age confirmation", "age check", "age gate", "age restriction"
    /age\s+(?:verification|confirmation|check|gate|restriction)/i,
    // e.g. "over 18 years", "at least 21 years", "older than 21", "18+"
    /(?:over|above|at\s*least|minimum|older\s+than)\s*(?:18|21)\s*(?:years|yo|y\.?o\.?|\+)?/i,
    // e.g. "18 years of age", "18+ years old", "21 years or older"
    /(?:18|21)\s*(?:\+|years?)\s*(?:of\s*age|or\s*older|or\s*above)/i,
    // e.g. "I am 18+", "I am over 18", "I'm 21 or older"
    /(?:i'?m|i\s*am)\s*(?:over|above|at\s*least)?\s*(?:18|21)(?:\+|\s*(?:or\s*older|years))?/i,
    // e.g. "you must be 18", "users must be at least 21", "visitors must be over 18"
    /(?:you|users?|visitors?)\s+must\s+be\s+(?:over|above|at\s*least)?\s*(?:18|21)/i,
    // e.g. "adult oriented material", "adult content", "adult-only website"
    /adult[\s-]+(?:oriented|only|content|material|websites?)/i
  ];
  var SETTINGS_PATTERNS = [
    // Multilingual "open customization" patterns: a customization verb next to a
    // cookie/preference/settings/options/details/purposes noun (both word orders).
    // The negative lookahead avoids policy links and save/confirm/accept phrases (those are accept/acknowledge/other).
    /^(?!.*\b(policy|policies|notice|statement|impressum|\w*richtlinie\w*|\w*erklärung|page|beschrijving|privacy$|beleid|politique|política|polityk|speichern|guardar|opslaan|zapisz|enregistrer|sauvegarder|bevestig|bestätig|confirm|save|submit|akzeptier|accept|zaakcept)\b)(customi[sz]e|manage|adjust|configure|personali[sz]e|let me choose|edit|change|set|select|view|see|review|update|open|show|choose|anpassen|verwalten|konfigurieren|bearbeiten|öffnen|anzeigen|einblenden|einstellen|festlegen|auswählen|wählen|aanpassen|beheren|instellen|wijzig\w*|personaliseren|personaliseer|kies|bekijk|toon|personnaliser|paramétrer|gérer|configurer|choisir|afficher|définir|modifier|configurar|personalizar|gestionar|administrar|ajustar|seleccionar|modificar|establecer|dostosuj|zarządzaj|personalizuj|ustaw\w*|zmień|pokaż|wybierz)\b.{0,20}(cookies?|preferences?|settings?|options?|choices?|controls?|details?|purposes?|services?|consent|einstellung\w*|optionen|präferenzen|einzelheiten|zwecke|dienste|datenschutz\w*|auswahl|voorkeur\w*|instelling\w*|opties|diensten|préférences|paramètres|réglages|choix|détails|finalités|témoins|preferencia\w*|opciones|ajustes|configuraci\w*|detalles|servicios|elección|preferencj\w*|ustawie\w*|opcje|szczegół\w*|cele|galetes)\b/is,
    /^(?!.*\b(policy|policies|notice|statement|impressum|\w*richtlinie\w*|\w*erklärung|page|beschrijving|privacy$|beleid|politique|política|polityk|speichern|guardar|opslaan|zapisz|enregistrer|sauvegarder|bevestig|bestätig|confirm|save|submit|akzeptier|accept|zaakcept)\b)(cookies?|preferences?|settings?|options?|choices?|controls?|details?|purposes?|services?|consent|einstellung\w*|optionen|präferenzen|einzelheiten|zwecke|dienste|datenschutz\w*|auswahl|voorkeur\w*|instelling\w*|opties|diensten|préférences|paramètres|réglages|choix|détails|finalités|témoins|preferencia\w*|opciones|ajustes|configuraci\w*|detalles|servicios|elección|preferencj\w*|ustawie\w*|opcje|szczegół\w*|cele|galetes)\b(.{0,14}\W)?(customi[sz]e|manage|adjust|configure|personali[sz]e|let me choose|edit|change|set|select|view|see|review|update|open|show|choose|anpassen|verwalten|konfigurieren|bearbeiten|öffnen|anzeigen|einblenden|einstellen|festlegen|auswählen|wählen|aanpassen|beheren|instellen|wijzig\w*|personaliseren|personaliseer|kies|bekijk|toon|personnaliser|paramétrer|gérer|configurer|choisir|afficher|définir|modifier|configurar|personalizar|gestionar|administrar|ajustar|seleccionar|modificar|establecer|dostosuj|zarządzaj|personalizuj|ustaw\w*|zmień|pokaż|wybierz)\b/is,
    // settings noun + cookies, e.g. "paramètres des cookies", "ajustes de cookies", "instellingen voor cookies en diensten"
    /^(paramètres|préférences|réglages|ajustes|opciones|elección|preferencias|instellingen)( (de|des|les|voor|van))? cookies( (et des|en|y) (services|diensten|servicios))?$/is,
    "settings",
    "preferences",
    /customi(s|z)e/is,
    "more options",
    /(manage|configure) (my|your) (preferences|choices|cookies)/is,
    /(cookie )?preference center/is,
    "configure",
    "cookie manager",
    "cookie preference",
    "let me choose",
    "cookieconsent preferences",
    /privacy choices/is,
    /^(privacy|cookie|custom) settings$/is,
    /^cookies? (settings|preferences|setting)(?!.*\bdo not\b)/is,
    /^(?!.*\bpolic(y|ies)\b).*(manage|customize|customise|opt-out|edit).*(cookies|preferences|settings|options)/is,
    "cookie consent options",
    "privacy controls",
    // German
    "einstellungen",
    // Spanish (ES)
    /^(configurar|configuración|administrar)$/,
    /^(gestionar|ver|establecer) preferencias$/,
    "ajustes",
    "centro de preferencias",
    "configura",
    /^configuración( de( las)?)? cookies?( y servicios)?$/,
    /^configurar\.\.\.$/,
    "configurarlas",
    "detalles",
    "gestiona tus preferencias",
    /^gestionar ?(las?|mis)? ?(configuración|preferencias)?(( de)? cookies?)?$/,
    "gesti\xF3n cookies",
    "gesti\xF3n de cookies",
    "mis preferencias",
    "mostrar detalles",
    "mostrar los prop\xF3sitos",
    "m\xE1s opciones",
    "no, ajustar",
    "obtener m\xE1s informaci\xF3n y configuraci\xF3n",
    "opciones de gesti\xF3n",
    "panel de configuraci\xF3n de cookies",
    "personalice",
    "personalizar",
    "preferencias de privacidad",
    "preferencias",
    "quiero configurarlas",
    "saber m\xE1s y personalizar",
    "seleccionar fines individuales",
    // Catalan (CA)
    "configura-les",
    "personalitza",
    "veure prefer\xE8ncies",
    /^(configuració|personalitzar|preferències|més opcions)$/,
    /^(configuració|preferències|opcions)( de( les)?)? (galetes|cookies?)$/is,
    /^(gestiona|gestionar|configura|configurar|personalitza|personalitzar|veure|establir|administrar)( les)?( meves)? (preferències|galetes|cookies?|opcions)$/is,
    // Galician (GL)
    "xestionar preferencias",
    // Basque (EU)
    /^(konfigurazioa|konfiguratu)$/,
    // Portuguese (PT)
    "gerenciar cookies",
    // French (FR)
    "param\xE9trage des cookies",
    "param\xE9trer",
    "personnaliser",
    "param\xE8tres",
    "pr\xE9f\xE9rences",
    "r\xE9glages",
    "d\xE9tails",
    "gestion des cookies",
    /^gérer (les |mes )?cookies$/,
    "je choisis",
    "voir les pr\xE9f\xE9rences",
    // German (DE)
    "abschnitt einzelheiten",
    "cookie-details",
    /^datenschutz-?einstellungen$/,
    "cookie-einstellungen",
    /^einstell(ungen|en) oder ablehnen$/,
    "ausw\xE4hlen",
    /^einstellungen (anpassen|ansehen|verwalten|ändern)$/,
    "erweiterte einstellungen",
    "individuelle datenschutz-pr\xE4ferenzen",
    "individuelle datenschutzeinstellungen",
    "konfigurieren",
    "mehr optionen",
    "pr\xE4ferenzen",
    "individuelle einstellungen",
    "privatsph\xE4re einstellungen",
    // Dutch (NL)
    /^(aan|an)passen$/,
    /^cookie[- ]instellingen$/,
    "cookiestatement instellingen",
    /^details (tonen|weergeven)$/,
    "instellingen",
    "meer opties",
    "zelf instellen",
    // Czech (CS)
    "podrobn\xE9 nastaven\xED",
    // Polish (PL)
    // examples:
    //  dostosuj pliki cookie (adjust cookies)
    //  zarządzaj plikami cookie (manage cookies)
    /^(dostosuj|s?personalizuj|chcę dostosować|zarządzaj) ?(moje|moimi)? ?(ustawieniami|preferencjami)? ?(zgody|wybory|(plik(i|ami|ów))? cookies?)?$/,
    /^(preferencje|zarządzaj preferencjami)$/,
    /^(ustawienia|zmień ustawienia|zmiana ustawień|zarządzaj opcjami)$/,
    "centrum preferencji",
    /^chcę dokonać ustawień cookies\.$/,
    "dostosuj wyb\xF3r",
    "edytuj ustawienia",
    "konfiguracja zg\xF3d",
    "otw\xF3rz ustawienia",
    "personalizacja",
    "poka\u017C cele",
    "poka\u017C szczeg\xF3\u0142y",
    "szczeg\xF3\u0142y",
    "pozw\xF3l mi wybra\u0107",
    /^przejdź do ustawień plików cookies\.$/,
    "przejd\u017A do ustawie\u0144 prywatno\u015Bci",
    "przejd\u017A do ustawie\u0144",
    "skonfiguruj",
    "ustaw swoje wybory",
    "ustawienia ciasteczek",
    "ustawienia prywatno\u015Bci",
    "ustawienia zaawansowane",
    "ustawienia zgody",
    /^ustawienia(ch)?( plików)? cookies?$/,
    "ustawieniach",
    "ustawie\u0144 zaawansowanych",
    "wi\u0119cej opcji",
    "wi\u0119cej ustawie\u0144",
    /^wybierz, jakie pliki cookies chcesz zaakceptować\.$/,
    "zaawansowane",
    "zarz\u0105dzaj zgodami dotycz\u0105cymi plik\xF3w cookies",
    "zarz\u0105dzaj zgodami",
    "zarz\u0105dzania zgodami",
    "zarz\u0105dzanie opcjami",
    "zarz\u0105dzanie preferencjami",
    "zarz\u0105dzanie ustawieniami plik\xF3w cookie",
    "zmieniam ustawienia",
    "zmieniam zgody",
    "zmie\u0144 swoje preferencje",
    /^zmień ustawienia( plików)? cookies?$/,
    "zmie\u0144 zgody",
    "zobacz preferencje",
    // Russian (RU)
    // e.g. "настроить", "настройки куки", "параметры конфиденциальности"; \w does not match Cyrillic
    /^\s*((мои|моими|свои|своими)\s+)?(настро[а-яё]+|парамет[а-яё]+|предпочтени[а-яё]+)([\s-]+(мои|моими|свои|своими|файл[а-яё]*|cookie|куки[а-яё]*|конфиденциальност[а-яё]*|согласи[а-яё]*|приватност[а-яё]*))*\s*$/is,
    // e.g. "управление файлами cookie", "изменить настройки", "выбрать категории"
    // "подробн" is deliberately excluded: it would also match the "подробнее о cookie" policy link
    /^\s*(управл[а-яё]+|измен[а-яё]+|выбрать|персонализ[а-яё]+|расширенн[а-яё]+|индивидуальн[а-яё]+)[\s-]+.{0,20}(настройк[а-яё]*|парамет[а-яё]*|предпочтени[а-яё]*|категори[а-яё]*|файл[а-яё]*|cookie|куки[а-яё]*|согласи[а-яё]*|конфиденциальност[а-яё]*)\s*$/is,
    "\u043F\u043E\u0434\u0440\u043E\u0431\u043D\u044B\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    // Italian (IT)
    "personalizza cookie",
    // English (EN)
    "advanced settings",
    "consent settings",
    /^details (anzeigen|zeigen|section)$/,
    "no, adjust",
    "personalize",
    "plus doptions",
    "privacy manager"
  ];
  var ACCEPT_PATTERNS = [
    // EN accept/agree/allow/consent/enable (+ all/cookies/selection/continue/close/proceed...).
    // The negative lookahead avoids essential-only/reject wording (those are reject).
    /^(?!.*\b(essential|necessary|required|functional|minimal|reject|deny|refuse|decline|only|dismiss)\b)(?!.*all cookies continue)(yes,?\s+)?(i\s+)?(accept|agree|allow|consent|enable)(\s+(to\s+)?(all( cookies)?|cookies|selection|selected( cookies)?|everything|recommended( cookies| settings)?|optional( cookies)?|additional cookies|analytics cookies))?(\s+(and\s+)?(continue|close|proceed|save))?\s*$/is,
    /^continue (and accept|using cookies|with (all|recommended cookies|cookies))$/is,
    // DE accept verbs
    /^(alle[sn]?\s+|allem\s+|ich\s+|cookies\s+|ausgewählte\s+|webanalyse\s+)?(cookies?\s+)?(akzeptieren|annehmen|zustimmen|zulassen|erlauben|einwilligen|aktivieren|auswählen)(\s+(und\s+)?(weiter|schlie(ß|ss)en))?\s*$/is,
    /^((meine\s+)?auswahl|alle)\s+(bestätigen|akzeptieren|auswählen)$/is,
    /^(alle[nm]?\s+)?(zustimmen|einverstanden|einwilligung|zustimmung)$/is,
    /^ich (bin einverstanden|akzeptiere( alle)?|stimme zu)$/is,
    // NL accept verbs
    /^(ja,?\s+)?(alle[s]?\s+|ik\s+)?(cookies?\s+)?(accepteer|accepteren|toestaan|aanvaard|aanvaarden|ga akkoord|akkoord)(\s+((en\s+)?sluiten|en\s+(doorgaan|verdergaan)|cookies|alle))?\s*$/is,
    /^(selectie (accepteren|toestaan)|accepteer (selectie|alle)|alle (toestaan|accepteren|aanvaarden)|ja, (dat is prima|prima|alles toestaan|accepteren|ik accepteer cookies|ik ga akkoord)|is goed)$/is,
    // FR accept verbs
    /^(oui,?\s+)?(je\s+)?(tout\s+)?(accepter|jaccepte|autoriser)(\s+(tout|tous les (cookies|témoins)|les (cookies|témoins)|la sélection|et (continuer|fermer|poursuivre)))?\s*$/is,
    /^(oui, (jaccepte|je suis daccord)|jaccepte (les cookies|lutilisation de cookies)|accepter (continuer|et poursuivre)|continuer et accepter|fermer et accepter)$/is,
    // ES/CA accept verbs
    /^(sí,?\s+|si,?\s+)?(aceptar|acepta|permitir|permitirlas|consentir|estoy de acuerdo|de acuerdo|estic dacord)(\s+(todo|todas( las cookies)?|cookies|la selección|selección|y (cerrar|continuar|seguir( leyendo)?|leer gratis)))?\s*$/is,
    // save / submit selection / preferences (accept semantics; acknowledge catches "guardar configuración/selección" first)
    /^(save|store|submit|guardar|sauvegarder|zapisz|opslaan|bewaar)\b.{0,25}(preference|setting|selection|choice|mes choix|cookie|voorkeur|keuze|ustawien|zgod)/is,
    /^((meine\s+)?auswahl|einstellungen|einwilligung|voorkeuren|instellingen|selectie|keuzes)\s+(speichern|opslaan)$/is,
    /i (accept|allow)( all)?/is,
    "yes",
    /accept all above/is,
    "close and accept",
    /(^|\s)accept all$/is,
    "im ok with that",
    // Spanish (ES)
    /^acept(ar|o)( cookies)?$/,
    /^acept(o|ar) todas las cookies$/,
    "aceptar cookies opcionales",
    "aceptar gratis",
    "aceptar las cookies",
    "aceptar todas cookies",
    "aceptar todas y cerrar",
    "aceptar todas y continuar",
    "aceptar todo y cerrar",
    /^aceptar y (continuar|seguir|navegar)( gratis)?$/,
    "aceptar y seguir navegando",
    "aceptarlas todas",
    "guardar preferencias",
    "ok, las acepto",
    /^s[íi], acepto todas las cookies$/,
    /^s[íi], acepto$/,
    /^s[íi], estoy de acuerdo$/,
    "x aceptar y cerrar",
    // Catalan (CA)
    /^accept(ar|o)( cookies)?$/,
    "accepta",
    "accepta totes les cookies",
    "accepta-ho tot",
    // FR/CA "d'accord" / "d'acord"
    /^dac?cord( fermer)?$/is,
    "accepta-les totes",
    "acceptar galetes",
    "acceptar i tancar",
    "acceptar tot",
    "acepta-les totes",
    "permet-les totes",
    "permetre totes les cookies",
    "permetre la selecci\xF3",
    // Basque (EU)
    /^denak? onartu$/,
    /^onartu \(cookie\)$/,
    "onartu cookieak",
    "onartu",
    // Portuguese (PT)
    "aceitar cookies",
    "aceitar",
    "de acordo",
    // French (FR)
    /^accepter (tout|tous les cookies|fermer)$/,
    // German (DE)
    /^(alles akzeptieren|alle zulassen|auswahl erlauben|cookies zulassen|einverstanden|einwilligung|zustimmen|zustimmung)$/,
    // Dutch (NL)
    /^(accepteer (alles|alle cookies)|alles (accepteren|toestaan)|alle cookies (accepteren|toestaan))$/,
    // Czech (CS)
    "souhlas\xEDm",
    // Polish (PL)
    // examples:
    //  akceptuj cookies (Accept cookies)
    //  akceptuj wszystkie pliki cookie (Accept all cookies)
    /^(zaakceptuj|akceptuj[eę]|akceptuj) ?(wszystkie|wszystko)?( pliki)? ?(zgody|ciasteczka|cookies?)?$/,
    "akceptowanie plik\xF3w cookie",
    "akceptuj wybrane",
    "akceptuj i zamknij",
    "akceptuj wszystkie i przejd\u017A do serwisu",
    "akceptuj\u0119 i przechodz\u0119 do serwisu",
    "akceptuj\u0119 polityk\u0119 plik\xF3w cookies i przechodz\u0119 do strony",
    "akceptuj\u0119 ustawienia cookies",
    "akceptuj\u0119 wszystkie i korzystam z us\u0142ug",
    "akceptuj\u0119!",
    "ok, zgadzam si\u0119",
    "potwierdzam wszystkie",
    "tak",
    "tak, zgadzam si\u0119 na wszystkie pliki cookie",
    "tak, zgadzam si\u0119",
    "wyra\u017A zgod\u0119 na wszystko",
    "wyra\u017Cam zgod\u0119 na wszystkie",
    "wyra\u017Cam zgod\u0119",
    "w\u0142\u0105cz wszystkie ciasteczka",
    "zaakceptuj i kontynuuj",
    "zaakceptuj i zamknij",
    "zaakceptuj wszystkie i przejd\u017A do serwisu",
    "zaakceptuj wszystkie zgody i wejd\u017A do serwisu",
    "zaakceptuj wszystkie zgody i zapisz",
    "zatwierd\u017A",
    "zezwolenie na wszystkie",
    "zezw\xF3l na wszystkie ciasteczka",
    "zezw\xF3l na wszystkie cookies",
    "zezw\xF3l na wszystkie pliki cookies",
    "zezw\xF3l na wszystkie",
    "zezw\xF3l na wyb\xF3r",
    "zezw\xF3l",
    "zgadzam si\u0119 na wszystkie",
    "zgadzam si\u0119",
    "zgoda na wszystkie",
    "zgoda",
    "zaakceptuj wybrane",
    "zezw\xF3l na wybrane",
    "zgoda na wybrane",
    // Russian (RU)
    // e.g. "принять всё", "принять все файлы cookie", "разрешить куки", "я согласен"
    // confirm/save wording (подтвердить, сохранить) is acknowledge, not accept
    /^\s*(да,?\s+)?(я\s+)?(принять|принима[а-яё]+|соглас[а-яё]+|разрешить|разреша[а-яё]+)(\s+(вс[её]|(все\s+)?(файлы[\s-]+)?(cookie|куки)([\s-]+файл[а-яё]*)?|выбранные|выбор))?\s*$/is,
    "\u043F\u0440\u0438\u043D\u044F\u0442\u044C",
    // Turkish (TR)
    "kabul et",
    // Italian (IT)
    "accetta",
    "accetta tutti i cookie",
    "accetto tutti i cookie"
  ];
  var ACKNOWLEDGE_PATTERNS = [
    // close / dismiss the banner/dialog/message (multilingual). The negative lookahead avoids
    // accept/save phrases (e.g. "agree and close", "akkoord en sluiten", "speichern schließen").
    /^(?!.*\b(accept\w*|accepter|accepteer|accepteren|agree|allow|akkoord|aanvaard\w*|zustimm\w*|annehm\w*|akzeptier\w*|aceptar|acepta|permit\w*|consent\w*|einverstanden|zezw\w*|zgadzam|zgoda|guardar|opslaan|enregistrer|speicher\w*|zapisz)\b)(x\s+|nee,?\s+)?(close|dismiss|schlie(ß|ss)en|sluiten|afsluiten|fermer|cerrar|tanca|beenden|masquer|zamknij)( (this|the|ce|le|el|de|des|het|la|een)?\s*(banner|bandeau|banier|bar|dialog|dialogue|window|okno|melding|message|notification|informa\w*|notificaci\w*|cookie\w*|bannière|rgpd|gdpr|hier|des cookies|de cookies|x))*\.?\s*$/is,
    // "ok" / "okay" / "oké" (optionally followed by a short acknowledgement)
    /^(ok|okay|oké|okey|k)([ .!,]*)(got it|verstanden|compris|rozumiem|thanks|gracias|ik begrijp( dat| het)?|continue to website|pour moi|fermer)?[ .!]*$/is,
    // "understood" / "got it" / "that's ok" (multilingual)
    /^(i understand|understood|got it|thats (ok|fine|okay)|alright|alles klar|in ordnung|verstanden|begrepen|jai compris|je comprends|compris|ik begrijp het|ik snap het|entendido|c(e)?st ok pour moi)[ !.,]*(merci|bedankt|dismiss this banner)?[ !.]*$/is,
    // confirm
    /^(confirm|bestätigen|bevestigen|confirmar|potwierdź)[ !.]*$/is,
    // neutral "continue" without accept/reject wording
    /^(continuer|doorgaan|ga verder)$/is,
    "continue",
    "x",
    /^got it!?$/,
    "acknowledge",
    /^close (banner|cookie notification)$/is,
    /understood$/is,
    "confirm my choices",
    // German (DE)
    "speichern schlie\xDFen",
    // Spanish (ES)
    /^.?( lo)?(entendido|entiendo).?$/s,
    "aceptar seleccionadas",
    "continuar",
    "guardar configuraci\xF3n",
    "guardar selecci\xF3n",
    "guardar y cerrar",
    "ir al contenido principal",
    "seguir",
    "vale",
    "\xA1vamos!",
    // Catalan (CA)
    /^(ho )?(entenc|entès|entesos)[ !.]*$/s,
    // Polish (PL)
    "kontynuuj",
    "ok, zrozumia\u0142em",
    /^ok.? rozumiem.?$/s,
    "rozumiem!",
    "rozumiem",
    "rozumiem, nie pokazuj wi\u0119cej",
    "w porz\u0105dku!",
    "w porz\u0105dku",
    /^zamknij informację o( plikach)? cookies$/,
    "zapisz i zamknij",
    // Russian (RU)
    // e.g. "понятно", "всё понятно", "хорошо", "ясно"; \w does not match Cyrillic
    /^\s*(хорошо|ясно|(вс[её]\s+)?(понятно|понял[аи]?))[!.]*\s*$/is,
    // e.g. "закрыть", "закрыть уведомление о cookie"
    /^\s*закрыть([\s-]+(это|эту|баннер|уведомлени[а-яё]*|окно|сообщени[а-яё]*|плашк[а-яё]*|информаци[а-яё]*)){0,2}([\s-]+(о|об)[\s-]+(cookie|куки[а-яё]*|файл[а-яё]*[\s-]+cookie))?\s*$/is,
    // e.g. "больше не показывать", "не показывать снова"
    /^\s*(больше\s+не\s+показывать|не\s+показывать(\s+(снова|больше|это\s+сообщение))?)\s*$/is,
    // e.g. "подтвердить", "подтверждаю выбор", "сохранить настройки", "сохранить и закрыть"
    /^\s*(подтвер(дить|ждаю|ждени[а-яё]*)|сохран(ить|яю|ение))([\s-]+(мой|мои|моё|свой|свои|своё)?[\s-]*(выбор[а-яё]*|настройк[а-яё]*|парамет[а-яё]*|предпочтени[а-яё]*|согласи[а-яё]*))?([\s-]+и[\s-]+(закрыть|продолжить))?\s*$/is,
    "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C"
  ];

  // lib/heuristic-classify.ts
  var TEXT_LIMIT = 1e5;
  function checkHeuristicPatterns(allText, detectPatterns = DETECT_PATTERNS) {
    allText = allText.slice(0, TEXT_LIMIT);
    const patterns = [];
    const snippets2 = [];
    for (const p of detectPatterns) {
      const matches = allText?.match(p);
      if (matches) {
        patterns.push(p.toString());
        for (const m of matches) {
          if (typeof m === "string") {
            snippets2.push(m.substring(0, 200));
          }
        }
      }
    }
    return { patterns, snippets: snippets2 };
  }
  function hasHeuristicPatterns(allText, detectPatterns = DETECT_PATTERNS) {
    const text = allText.slice(0, TEXT_LIMIT);
    return detectPatterns.some((p) => text.search(p) !== -1);
  }
  function classifyButtons(buttons) {
    for (const button of buttons) {
      button.regexClassification = classifyButtonTextRegex(button.text);
    }
  }
  function isExcludedPopup(popupText, excludePatterns = DETECT_NEVER_MATCH_PATTERNS) {
    if (!popupText) {
      return false;
    }
    const truncated = popupText.slice(0, TEXT_LIMIT);
    return excludePatterns.some((p) => p.test(truncated));
  }
  function classifyPopup(buttons) {
    const { reject, settings, accept, acknowledge } = buttons.reduce(
      (acc, button) => {
        if (button.regexClassification && button.regexClassification !== "other") {
          acc[button.regexClassification]++;
        }
        return acc;
      },
      { reject: 0, settings: 0, accept: 0, acknowledge: 0 }
    );
    if (reject > 0) {
      return "reject";
    }
    if (settings > 0) {
      return "none";
    }
    if (acknowledge > 0) {
      return "tier1";
    }
    if (accept > 0) {
      return accept === 1 ? "tier2" : "none";
    }
    return "none";
  }
  function testButtonMatches(buttonText, matchPatterns, neverMatchPatterns) {
    if (!buttonText) {
      return false;
    }
    const cleanedButtonText = cleanButtonText(buttonText);
    return !neverMatchPatterns.some((p) => p instanceof RegExp && p.test(cleanedButtonText) || p === cleanedButtonText) && matchPatterns.some((p) => p instanceof RegExp && p.test(cleanedButtonText) || p === cleanedButtonText);
  }
  function cleanButtonText(buttonText) {
    let result = buttonText.toLowerCase();
    result = result.replace(/[“”"'/#&[\]→✕×⟩❯><✗×‘’›«»]+/g, "");
    result = result.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u2600-\u26FF\u2700-\u27BF\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    );
    result = result.replace(/\n+/g, " ");
    result = result.replace(/\s+/g, " ");
    result = result.trim();
    return result;
  }
  function classifyButtonTextRegex(buttonText) {
    if (testButtonMatches(buttonText, REJECT_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "reject";
    }
    if (testButtonMatches(buttonText, SETTINGS_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "settings";
    }
    if (testButtonMatches(buttonText, ACCEPT_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "accept";
    }
    if (testButtonMatches(buttonText, ACKNOWLEDGE_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "acknowledge";
    }
    return "other";
  }

  // lib/heuristics.ts
  var BUTTON_LIKE_ELEMENT_SELECTOR = 'button, input[type="button"], input[type="submit"], a, [role="button"], [class*="button"]';
  var POPUP_SEARCH_MAX_TIME = 100;
  var ACCEPTED_LEVELS = {
    off: [],
    reject: ["reject"],
    tier1: ["reject", "tier1"],
    tier2: ["reject", "tier1", "tier2"]
  };
  function getActionablePopups(mode = "reject", timeout = POPUP_SEARCH_MAX_TIME, hitTest = false) {
    const acceptedLevels = ACCEPTED_LEVELS[mode];
    const isActionable = (popup) => acceptedLevels.includes(popup.regexClassification) && isConsentPopup(popup);
    const popups = searchPopups(timeout, hitTest, DEFAULT_HIT_TEST_GRID, true).filter(isActionable);
    return popups.sort((a, b) => classificationRank(a) - classificationRank(b));
  }
  function getPotentialPopups(timeout = POPUP_SEARCH_MAX_TIME, hitTest = false, hitTestGrid = DEFAULT_HIT_TEST_GRID) {
    return searchPopups(timeout, hitTest, hitTestGrid);
  }
  function searchPopups(timeout, hitTest, hitTestGrid, stopOnReject = false) {
    if (!isTopFrame()) {
      return getFramePopups();
    }
    const deadline = performance.now() + timeout;
    const hitTestPopups = hitTest ? findPopupsByHitTest(deadline, hitTestGrid) : [];
    if (stopOnReject && hitTestPopups.some((p) => p.regexClassification === "reject" && isConsentPopup(p))) {
      return hitTestPopups;
    }
    const walkPopups = collectPositionedPopups(deadline);
    return [...walkPopups, ...mergeWalkOverlaps(hitTestPopups, walkPopups)];
  }
  var consentPopups = /* @__PURE__ */ new WeakMap();
  function classificationRank(popup) {
    return ACCEPTED_LEVELS.tier2.indexOf(popup.regexClassification);
  }
  function isConsentPopup(popup) {
    if (!ACCEPTED_LEVELS.tier2.includes(popup.regexClassification)) {
      return false;
    }
    let result = consentPopups.get(popup);
    if (result === void 0) {
      const popupText = popup.text.trim();
      result = !!popupText && !isExcludedPopup(popupText) && hasHeuristicPatterns(popupText);
      consentPopups.set(popup, result);
    }
    return result;
  }
  function mergeWalkOverlaps(hitTestPopups, walkPopups) {
    return hitTestPopups.filter((h) => {
      const hitIsConsent = isConsentPopup(h);
      const absorbs = (p) => !hitIsConsent || isConsentPopup(p) && classificationRank(p) <= classificationRank(h);
      const walkPopup = walkPopups.find((p) => composedOverlaps(p.element, h.element) && absorbs(p));
      if (walkPopup) {
        (walkPopup.hitPoints ??= []).push(...h.hitPoints ?? []);
      }
      return !walkPopup;
    });
  }
  function getFramePopups() {
    if (window.parent && window.parent !== window.top) {
      return [];
    }
    const frameElement = getFramePopupElement(document);
    const popup = frameElement && toPopupData(frameElement);
    if (!popup) {
      return [];
    }
    popup.source = "frame";
    return [popup];
  }
  function collectPositionedPopups(deadline) {
    const { elements, shadowHosts } = getPopupLikeElements(deadline);
    const potentialPopups = [];
    const expanded = [];
    for (const el of elements) {
      const popup = toPopupData(el, shadowHosts);
      if (!popup) {
        continue;
      }
      const root = performance.now() > deadline ? popup : expandPopupFragment(popup, shadowHosts);
      if (potentialPopups.some((p) => p.element === root.element)) {
        continue;
      }
      if (root !== popup) {
        expanded.push(root.element);
      }
      root.source = "walk";
      potentialPopups.push(root);
    }
    return potentialPopups.filter((p) => !expanded.some((root) => root !== p.element && composedContains(root, p.element)));
  }
  var DEFAULT_HIT_TEST_GRID = {
    columns: [0.1, 0.5, 0.9],
    // banners sit along the top and bottom edges and modals in the middle; rows 150px in added almost nothing in crawls
    edgeRows: [30, 90]
  };
  function findPopupsByHitTest(deadline, grid) {
    const climbed = /* @__PURE__ */ new Map();
    const found = [];
    const toPopup = (el) => el.querySelector(TEXT_ENTRY_SELECTOR) ? null : toPopupRoot(el);
    for (const [x, y] of getHitTestPoints(grid)) {
      if (performance.now() > deadline) {
        return found;
      }
      const path = [];
      let reached = null;
      const shouldStop = (el) => {
        if (climbed.has(el)) {
          reached = climbed.get(el) ?? null;
          return true;
        }
        const overlapped = found.find((p) => composedOverlaps(p.element, el));
        if (overlapped) {
          reached = composedContains(overlapped.element, el) ? overlapped : null;
          return true;
        }
        path.push(el);
        return false;
      };
      const hit = closestHTMLElement(deepElementFromPoint(x, y));
      const popup = climbToPopup(hit, MAX_HIT_TEST_CLIMB_DEPTH, toPopup, shouldStop);
      if (popup) {
        popup.source = "hitTest";
        found.push(popup);
        reached = popup;
      }
      for (const el of path) {
        climbed.set(el, reached);
      }
      if (reached) {
        (reached.hitPoints ??= []).push([x, y]);
      }
    }
    return found;
  }
  function getHitTestPoints(grid) {
    const { innerWidth: width, innerHeight: height } = window;
    const rows = [...grid.edgeRows, height / 2, ...grid.edgeRows.map((y) => height - y)].map((y) => Math.round(y));
    const ys = [...new Set(rows)].filter((y) => y >= 0 && y < height);
    return ys.flatMap((y) => grid.columns.map((column) => [Math.round(column * width), y]));
  }
  var TEXT_ENTRY_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="number"], input[type="url"]';
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) {
        break;
      }
      el = inner;
    }
    return el;
  }
  function closestHTMLElement(el) {
    while (el && !(el instanceof HTMLElement)) {
      el = el.parentElement;
    }
    return el;
  }
  function toPopupData(el, shadowHosts, text = getElementText(el)) {
    if (!text) {
      return null;
    }
    const buttons = getButtonData(el, shadowHosts);
    classifyButtons(buttons);
    return { text, element: el, buttons, regexClassification: classifyPopup(buttons) };
  }
  function hasPopupButtons(text, buttons) {
    return !isOnlyButtonText(text, buttons) && buttons.some((b) => b.regexClassification !== "other");
  }
  function isOnlyButtonText(text, buttons) {
    let rest = text;
    for (const button of buttons) {
      rest = rest.replace(button.text, "");
    }
    return rest.replace(/\s+/g, "").length < 10;
  }
  function toPopupRoot(el, shadowHosts) {
    const text = getElementText(el);
    if (!text || !hasHeuristicPatterns(text)) {
      return null;
    }
    const popup = toPopupData(el, shadowHosts, text);
    return popup && hasPopupButtons(text, popup.buttons) ? popup : null;
  }
  var MAX_FRAGMENT_EXPANSION_DEPTH = 6;
  var MAX_HIT_TEST_CLIMB_DEPTH = 8;
  function climbToPopup(el, maxDepth, toPopup, shouldStop) {
    for (let depth = 0; el && depth < maxDepth; depth++, el = getComposedParent(el)) {
      if (shouldStop?.(el) || el === document.body || el === document.documentElement || el.getBoundingClientRect().height > window.innerHeight) {
        return null;
      }
      const popup = toPopup(el);
      if (popup) {
        return popup;
      }
    }
    return null;
  }
  function expandPopupFragment(popup, shadowHosts) {
    if (hasHeuristicPatterns(popup.text) && hasPopupButtons(popup.text, popup.buttons)) {
      return popup;
    }
    const parent = getComposedParent(popup.element);
    return climbToPopup(parent, MAX_FRAGMENT_EXPANSION_DEPTH, (el) => toPopupRoot(el, shadowHosts)) ?? popup;
  }
  function getComposedParent(el) {
    if (el.parentElement) {
      return el.parentElement;
    }
    const parent = el.parentNode;
    return parent instanceof ShadowRoot && parent.host instanceof HTMLElement ? parent.host : null;
  }
  function getFramePopupElement(doc) {
    const el = doc.body || doc.documentElement;
    const win = doc.defaultView;
    if (!el || !win || win.innerWidth === 0 || win.innerHeight === 0 || !isStyleVisible(el)) {
      return null;
    }
    return getElementText(el).trim() ? el : null;
  }
  function isStyleVisible(el) {
    return typeof el.checkVisibility !== "function" || el.checkVisibility({ checkVisibilityCSS: true });
  }
  function getElementText(el) {
    const text = el.innerText || "";
    if (!el.shadowRoot) {
      return text;
    }
    const shadowTexts = Array.from(el.shadowRoot.children, (child) => isRenderedTextElement(child) ? getElementText(child) : "");
    return [text, ...shadowTexts].filter((t) => t.trim()).join("\n");
  }
  function isRenderedTextElement(el) {
    return el instanceof HTMLElement && !["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT", "LINK", "SLOT"].includes(el.tagName) && window.getComputedStyle(el).display !== "none";
  }
  function composedOverlaps(a, b) {
    return composedContains(a, b) || composedContains(b, a);
  }
  function composedContains(container, node) {
    if (container.contains(node)) {
      return true;
    }
    let root = node.getRootNode();
    while (root instanceof ShadowRoot) {
      if (container.contains(root.host)) {
        return true;
      }
      root = root.host.getRootNode();
    }
    return false;
  }
  function isPopupCandidateVisible(el) {
    return isElementVisible(el) && isStyleVisible(el) && isOnScreen(el);
  }
  function isOnScreen(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return window.getComputedStyle(el).overflow === "visible" && Array.from(el.children).some((child) => isOnScreen(child));
    }
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }
  function isDialogLikeElement(node) {
    if (node.tagName === "DIALOG" && node.hasAttribute("open")) {
      return true;
    }
    if (node.getAttribute("role") === "dialog" || node.getAttribute("aria-modal") === "true") {
      return true;
    }
    return false;
  }
  function getPopupLikeElements(deadline) {
    const found = [];
    const shadowHosts = [];
    const roots = [document.documentElement];
    for (let i = 0; i < roots.length; i++) {
      if (i > 0 && performance.now() > deadline) {
        break;
      }
      const walker = document.createTreeWalker(
        roots[i],
        NodeFilter.SHOW_ELEMENT,
        // visit only element nodes
        {
          acceptNode(node) {
            if (node.shadowRoot) {
              shadowHosts.push(node);
              roots.push(node.shadowRoot);
            }
            if (node.tagName === "BODY") {
              return NodeFilter.FILTER_SKIP;
            }
            const style = window.getComputedStyle(node);
            if (style.display === "none") {
              return NodeFilter.FILTER_REJECT;
            }
            const cssPosition = style.position;
            if ((cssPosition === "fixed" || cssPosition === "sticky" || isDialogLikeElement(node)) && isPopupCandidateVisible(node)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            if (performance.now() > deadline) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        found.push(node);
      }
    }
    return { elements: excludeContainers(found.filter((element) => getElementText(element).trim())), shadowHosts };
  }
  function getButtonData(el, shadowHosts) {
    const buttons = [];
    for (const b of excludeContainers(getButtonLikeElements(el, shadowHosts))) {
      if (!isElementVisible(b) || isDisabled(b)) {
        continue;
      }
      const text = getElementText(b).trim() || // <input> values do not appear in innerText
      (b instanceof HTMLInputElement && ["submit", "button"].includes(b.type) ? b.value?.trim() : "");
      if (text) {
        buttons.push({ text, element: b });
      }
    }
    return buttons;
  }
  function getButtonLikeElements(el, shadowHosts = findShadowHosts(el)) {
    const buttons = Array.from(el.querySelectorAll(BUTTON_LIKE_ELEMENT_SELECTOR));
    for (const host of shadowHosts) {
      if (composedContains(el, host)) {
        buttons.push(...host.shadowRoot.querySelectorAll(BUTTON_LIKE_ELEMENT_SELECTOR));
      }
    }
    return buttons;
  }
  function findShadowHosts(root) {
    const hosts = [];
    const candidates = root instanceof HTMLElement ? [root, ...root.querySelectorAll("*")] : root.querySelectorAll("*");
    for (const el of candidates) {
      if (el.shadowRoot) {
        hosts.push(el, ...findShadowHosts(el.shadowRoot));
      }
    }
    return hosts;
  }
  function isDisabled(el) {
    return "disabled" in el && Boolean(el.disabled) || el.hasAttribute("disabled");
  }
  function excludeContainers(elements) {
    const candidates = new Set(elements);
    const containers = /* @__PURE__ */ new Set();
    for (const el of elements) {
      for (let node = el.parentNode; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
        if (candidates.has(node)) {
          containers.add(node);
        }
      }
    }
    return elements.filter((el) => !containers.has(el)).reverse();
  }

  // lib/cmps/base.ts
  var defaultRunContext = {
    main: true,
    frame: false,
    urlPattern: ""
  };
  var AutoConsentCMPBase = class {
    constructor(autoconsentInstance) {
      this.name = "BASERULE";
      this.runContext = defaultRunContext;
      this.autoconsent = autoconsentInstance;
    }
    get hasSelfTest() {
      throw new Error("Not Implemented");
    }
    get isIntermediate() {
      throw new Error("Not Implemented");
    }
    get isCosmetic() {
      throw new Error("Not Implemented");
    }
    mainWorldEval(snippetId) {
      const snippet = snippets[snippetId];
      if (!snippet) {
        this.autoconsent.config.logs.errors && console.warn("Snippet not found", snippetId);
        return Promise.resolve(false);
      }
      const logsConfig = this.autoconsent.config.logs;
      if (this.autoconsent.config.isMainWorld) {
        logsConfig.evals && console.log("inline eval:", snippetId, snippet);
        let result = false;
        try {
          result = !!snippet.call(globalThis);
        } catch (e) {
          logsConfig.evals && console.error("error evaluating rule", snippetId, e);
        }
        return Promise.resolve(result);
      }
      const snippetSrc = getFunctionBody(snippet);
      logsConfig.evals && console.log("async eval:", snippetId, snippetSrc);
      return requestEval(snippetSrc, snippetId).catch((e) => {
        logsConfig.evals && console.error("error evaluating rule", snippetId, e);
        return false;
      });
    }
    checkRunContext() {
      if (!this.checkFrameContext(isTopFrame())) {
        return false;
      }
      if (this.runContext.urlPattern && !this.hasMatchingUrlPattern()) {
        return false;
      }
      return true;
    }
    checkFrameContext(isTop) {
      const runCtx = {
        ...defaultRunContext,
        ...this.runContext
      };
      if (isTop && !runCtx.main) {
        return false;
      }
      if (!isTop && !runCtx.frame) {
        return false;
      }
      return true;
    }
    hasMatchingUrlPattern() {
      return Boolean(this.runContext?.urlPattern && window.location.href.match(this.runContext.urlPattern));
    }
    detectCmp() {
      throw new Error("Not Implemented");
    }
    async detectPopup() {
      return false;
    }
    optOut() {
      throw new Error("Not Implemented");
    }
    optIn() {
      throw new Error("Not Implemented");
    }
    openCmp() {
      throw new Error("Not Implemented");
    }
    async test() {
      return Promise.resolve(true);
    }
    async highlightElements(elements, all = false, delayTimeout = 2e3) {
      if (elements.length === 0) {
        return;
      }
      if (!all) {
        elements = [elements[0]];
      }
      this.autoconsent.sendContentMessage({
        type: "visualDelay",
        timeout: delayTimeout
      });
      for (const el of elements) {
        this.autoconsent.config.logs.rulesteps && console.log("highlighting", el);
        highlightNode(el);
      }
      await this.wait(delayTimeout);
      for (const el of elements) {
        unhighlightNode(el);
      }
    }
    // Implementing DomActionsProvider below:
    async clickElement(element) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements([element]);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.clickElement(element);
    }
    async click(selector, all = false) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements(this.elementSelector(selector), all);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.click(selector, all);
    }
    elementExists(selector) {
      return this.autoconsent.domActions.elementExists(selector);
    }
    elementVisible(selector, check) {
      return this.autoconsent.domActions.elementVisible(selector, check);
    }
    waitForElement(selector, timeout) {
      return this.autoconsent.domActions.waitForElement(selector, timeout);
    }
    waitForVisible(selector, timeout, check) {
      return this.autoconsent.domActions.waitForVisible(selector, timeout, check);
    }
    async waitForThenClick(selector, timeout, all, retries, retryInterval) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements(this.elementSelector(selector), all);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.waitForThenClick(selector, timeout, all, retries, retryInterval);
    }
    wait(ms) {
      return this.autoconsent.domActions.wait(ms);
    }
    hide(selector, method) {
      return this.autoconsent.domActions.hide(selector, method);
    }
    stylesheet(cssRule, stylesheetId) {
      return this.autoconsent.domActions.stylesheet(cssRule, stylesheetId);
    }
    removeClass(selector, className) {
      return this.autoconsent.domActions.removeClass(selector, className);
    }
    setStyle(selector, css) {
      return this.autoconsent.domActions.setStyle(selector, css);
    }
    addStyle(selector, css) {
      return this.autoconsent.domActions.addStyle(selector, css);
    }
    cookieContains(substring) {
      return this.autoconsent.domActions.cookieContains(substring);
    }
    prehide(selector) {
      return this.autoconsent.domActions.prehide(selector);
    }
    undoPrehide() {
      return this.autoconsent.domActions.undoPrehide();
    }
    querySingleReplySelector(selector, parent) {
      return this.autoconsent.domActions.querySingleReplySelector(selector, parent);
    }
    querySelectorChain(selectors) {
      return this.autoconsent.domActions.querySelectorChain(selectors);
    }
    elementSelector(selector) {
      return this.autoconsent.domActions.elementSelector(selector);
    }
    waitForMutation(selector) {
      return this.autoconsent.domActions.waitForMutation(selector);
    }
  };
  var AutoConsentCMP = class extends AutoConsentCMPBase {
    constructor(rule, autoconsentInstance) {
      super(autoconsentInstance);
      this.rule = rule;
      this.name = rule.name;
      this.runContext = rule.runContext || defaultRunContext;
    }
    get hasSelfTest() {
      return !!this.rule.test && this.rule.test.length > 0;
    }
    get isIntermediate() {
      return !!this.rule.intermediate;
    }
    get isCosmetic() {
      return !!this.rule.cosmetic;
    }
    get prehideSelectors() {
      return this.rule.prehideSelectors || [];
    }
    async detectCmp() {
      if (this.rule.detectCmp) {
        return this._runRulesSequentially(this.rule.detectCmp, this.autoconsent.config.logs.detectionsteps);
      }
      return false;
    }
    async detectPopup() {
      if (this.rule.detectPopup) {
        return this._runRulesSequentially(this.rule.detectPopup, this.autoconsent.config.logs.detectionsteps);
      }
      return false;
    }
    async optOut() {
      const logsConfig = this.autoconsent.config.logs;
      if (this.rule.optOut) {
        logsConfig.lifecycle && console.log("Initiated optOut()", this.rule.optOut);
        return this._runRulesSequentially(this.rule.optOut, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async optIn() {
      const logsConfig = this.autoconsent.config.logs;
      if (this.rule.optIn) {
        logsConfig.lifecycle && console.log("Initiated optIn()", this.rule.optIn);
        return this._runRulesSequentially(this.rule.optIn, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async openCmp() {
      if (this.rule.openCmp) {
        return this._runRulesSequentially(this.rule.openCmp, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async test() {
      if (this.hasSelfTest && this.rule.test) {
        return this._runRulesSequentially(this.rule.test, this.autoconsent.config.logs.rulesteps);
      }
      return super.test();
    }
    async evaluateRuleStep(rule) {
      const results = [];
      const logsConfig = this.autoconsent.config.logs;
      if (rule.exists) {
        results.push(this.elementExists(rule.exists));
      }
      if (rule.visible) {
        results.push(this.elementVisible(rule.visible, rule.check));
      }
      if (rule.eval) {
        const res = this.mainWorldEval(rule.eval);
        results.push(res);
      }
      if (rule.waitFor) {
        results.push(this.waitForElement(rule.waitFor, rule.timeout));
      }
      if (rule.waitForVisible) {
        results.push(this.waitForVisible(rule.waitForVisible, rule.timeout, rule.check));
      }
      if (rule.click) {
        results.push(this.click(rule.click, rule.all));
      }
      if (rule.waitForThenClick) {
        results.push(this.waitForThenClick(rule.waitForThenClick, rule.timeout, rule.all, rule.retry, rule.retryInterval));
      }
      if (rule.wait) {
        results.push(this.wait(rule.wait));
      }
      if (rule.hide) {
        results.push(this.hide(rule.hide, rule.method));
      }
      if (rule.stylesheet !== void 0) {
        results.push(this.stylesheet(rule.stylesheet, rule.stylesheetId));
      }
      if (rule.removeClass !== void 0) {
        results.push(rule.selector ? this.removeClass(rule.selector, rule.removeClass) : false);
      }
      if (rule.setStyle !== void 0) {
        results.push(rule.selector ? this.setStyle(rule.selector, rule.setStyle) : false);
      }
      if (rule.addStyle !== void 0) {
        results.push(rule.selector ? this.addStyle(rule.selector, rule.addStyle) : false);
      }
      if (rule.cookieContains) {
        results.push(this.cookieContains(rule.cookieContains));
      }
      if (rule.if) {
        if (!rule.if.exists && !rule.if.visible) {
          console.error("invalid conditional rule", rule.if);
          return false;
        }
        if (!rule.then) {
          console.error('invalid conditional rule, missing "then" step', rule.if);
          return false;
        }
        const condition = await this.evaluateRuleStep(rule.if);
        logsConfig.rulesteps && console.log("Condition is", condition);
        if (condition) {
          results.push(this._runRulesSequentially(rule.then, logsConfig.rulesteps));
        } else if (rule.else) {
          results.push(this._runRulesSequentially(rule.else, logsConfig.rulesteps));
        } else {
          results.push(true);
        }
      }
      if (rule.any) {
        let resultOfAny = false;
        for (const step of rule.any) {
          if (await this.evaluateRuleStep(step)) {
            resultOfAny = true;
            break;
          }
        }
        results.push(resultOfAny);
      }
      if (results.length === 0) {
        logsConfig.errors && console.warn("Unrecognized rule", rule);
        return false;
      }
      const all = await Promise.all(results);
      const result = all.reduce((a, b) => a && b, true);
      if (rule.negated) {
        return !result;
      }
      return result;
    }
    async _runRulesParallel(rules) {
      const results = rules.map((rule) => this.evaluateRuleStep(rule));
      const detections = await Promise.all(results);
      return detections.every((r) => !!r);
    }
    async _runRulesSequentially(rules, logSteps = true) {
      for (const rule of rules) {
        logSteps && console.log("Running rule...", rule);
        const result = await this.evaluateRuleStep(rule);
        logSteps && console.log("...rule result", result);
        if (!result && !rule.optional) {
          return false;
        }
      }
      return true;
    }
  };
  var AutoConsentHeuristicCMP = class extends AutoConsentCMPBase {
    constructor(autoconsentInstance, mode = "reject") {
      super(autoconsentInstance);
      this.popups = [];
      this.name = "HEURISTIC";
      this.runContext = {
        main: true,
        frame: false
        // do not run in iframes for security reasons
      };
      this.mode = mode;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.autoconsent.config.performanceLoggingEnabled && performance.mark("heuristicDetectorStart");
      this.popups = getActionablePopups(
        this.mode,
        this.autoconsent.config.heuristicPopupSearchTimeout,
        this.autoconsent.config.enableHeuristicHitTest
      );
      this.autoconsent.config.performanceLoggingEnabled && performance.mark("heuristicDetectorEnd");
      this.autoconsent.config.performanceLoggingEnabled && performance.measure("heuristicDetector", "heuristicDetectorStart", "heuristicDetectorEnd");
      if (this.popups.length > 0) {
        this.name = `HEURISTIC-${this.popups[0].regexClassification?.toUpperCase()}`;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    async detectPopup() {
      if (this.popups.length > 0) {
        if (this.popups.length > 1) {
          this.autoconsent.config.logs.errors && console.warn("Heuristic found multiple popups");
        }
        return true;
      }
      return false;
    }
    getTargetButton() {
      const popup = this.popups[0];
      const level = popup.regexClassification;
      const buttons = popup.buttons;
      const targetButtonType = level === "reject" ? "reject" : level === "tier1" ? "acknowledge" : "accept";
      return buttons.find((button) => button.regexClassification === targetButtonType);
    }
    optOut() {
      const button = this.getTargetButton();
      if (button) {
        return this.clickElement(button.element);
      }
      return Promise.resolve(false);
    }
    optIn() {
      throw new Error("Not Implemented");
    }
    openCmp() {
      throw new Error("Not Implemented");
    }
    async test() {
      const button = this.getTargetButton();
      if (button) {
        await this.wait(500);
        return !isElementVisible(button.element);
      }
      return false;
    }
  };

  // lib/cmps/trustarc-top.ts
  var cookieSettingsButton = "#truste-show-consent";
  var shortcutOptOut = "#truste-consent-required";
  var shortcutOptIn = "#truste-consent-button";
  var popupContent = "#truste-consent-content";
  var bannerOverlay = "#trustarc-banner-overlay";
  var bannerContainer = "#truste-consent-track";
  var TrustArcTop = class extends AutoConsentCMPBase {
    constructor(autoconsentInstance) {
      super(autoconsentInstance);
      this.name = "TrustArc-top";
      this.prehideSelectors = [".trustarc-banner-container", `.truste_popframe,.truste_overlay,.truste_box_overlay,${bannerContainer}`];
      this.runContext = {
        main: true,
        frame: false
      };
      this._shortcutButton = null;
      this._optInDone = false;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      if (this._optInDone) {
        return false;
      }
      return !this._shortcutButton;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      const result = this.elementExists(`${cookieSettingsButton},${bannerContainer}`);
      if (result) {
        this._shortcutButton = document.querySelector(shortcutOptOut);
      }
      return result;
    }
    async detectPopup() {
      return this.elementVisible(`${popupContent},${bannerOverlay},${bannerContainer}`, "any");
    }
    async optOut() {
      if (this.elementExists(shortcutOptOut)) {
        this.click(shortcutOptOut);
        return true;
      }
      hideElements(getStyleElement(), `.truste_popframe, .truste_overlay, .truste_box_overlay, ${bannerContainer}`);
      await this.click(cookieSettingsButton);
      setTimeout(() => {
        getStyleElement().remove();
      }, 1e4);
      return true;
    }
    async optIn() {
      this._optInDone = true;
      return await this.click(shortcutOptIn);
    }
    async openCmp() {
      return true;
    }
    async test() {
      await this.wait(500);
      return await this.mainWorldEval("EVAL_TRUSTARC_TOP");
    }
  };

  // lib/cmps/cookiebot.ts
  var Cookiebot = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Cybotcookiebot";
      this.prehideSelectors = [
        "#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#dtcookie-container,#cookiebanner,#cb-cookieoverlay,.modal--cookie-banner,#cookiebanner_outer,#CookieBanner"
      ];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return await this.mainWorldEval("EVAL_COOKIEBOT_1");
    }
    async detectPopup() {
      return this.mainWorldEval("EVAL_COOKIEBOT_2");
    }
    async optOut() {
      if (this.elementVisible("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll")) {
        return await this.click("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll");
      }
      await this.wait(500);
      let res = await this.mainWorldEval("EVAL_COOKIEBOT_3");
      await this.wait(1e3);
      res = res && await this.mainWorldEval("EVAL_COOKIEBOT_4");
      if (this.elementVisible("#CybotCookiebotDialogBodyButtonDecline")) {
        return await this.click("#CybotCookiebotDialogBodyButtonDecline");
      }
      return res;
    }
    async optIn() {
      if (this.elementExists("#dtcookie-container")) {
        return await this.click(".h-dtcookie-accept");
      }
      await this.click(".CybotCookiebotDialogBodyLevelButton:not(:checked):enabled", true);
      await this.click("#CybotCookiebotDialogBodyLevelButtonAccept");
      await this.click("#CybotCookiebotDialogBodyButtonAccept");
      return true;
    }
    async test() {
      await this.wait(500);
      return await this.mainWorldEval("EVAL_COOKIEBOT_5");
    }
  };

  // lib/cmps/sourcepoint-frame.ts
  var SourcePoint = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Sourcepoint-frame";
      this.prehideSelectors = ["div[id^='sp_message_container_'],.message-overlay", "#sp_privacy_manager_container"];
      this.ccpaNotice = false;
      this.ccpaPopup = false;
      this.runContext = {
        main: true,
        frame: true
      };
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      const url = new URL(location.href);
      if (url.searchParams.has("message_id") && url.hostname === "ccpa-notice.sp-prod.net") {
        this.ccpaNotice = true;
        return true;
      }
      if (url.hostname === "ccpa-pm.sp-prod.net") {
        this.ccpaPopup = true;
        return true;
      }
      return (url.pathname === "/index.html" || url.pathname === "/privacy-manager/index.html" || url.pathname === "/ccpa_pm/index.html" || url.pathname === "/us_pm/index.html") && (url.searchParams.has("message_id") || url.searchParams.has("requestUUID") || url.searchParams.has("consentUUID"));
    }
    async detectPopup() {
      if (this.ccpaNotice) {
        return true;
      }
      if (this.ccpaPopup) {
        return await this.waitForElement(".priv-save-btn", 2e3);
      }
      await this.waitForElement(
        ".sp_choice_type_11,.sp_choice_type_12,.sp_choice_type_13,.sp_choice_type_ACCEPT_ALL,.sp_choice_type_SAVE_AND_EXIT",
        2e3
      );
      return !this.elementExists(".sp_choice_type_9");
    }
    async optIn() {
      await this.waitForElement(".sp_choice_type_11,.sp_choice_type_ACCEPT_ALL", 2e3);
      if (await this.click(".sp_choice_type_11")) {
        return true;
      }
      if (await this.click(".sp_choice_type_ACCEPT_ALL")) {
        return true;
      }
      return false;
    }
    isManagerOpen() {
      if (location.pathname === "/privacy-manager/index.html" || location.pathname === "/ccpa_pm/index.html") {
        return true;
      }
      if (location.pathname === "/us_pm/index.html" && !document.querySelector(".sp_choice_type_11,.sp_choice_type_ACCEPT_ALL")) {
        return true;
      }
      return false;
    }
    async optOut() {
      await this.wait(500);
      const logsConfig = this.autoconsent.config.logs;
      if (this.ccpaPopup) {
        const toggles = document.querySelectorAll(
          ".priv-purpose-container .sp-switch-arrow-block a.neutral.on .right"
        );
        for (const t of toggles) {
          t.click();
        }
        const switches = document.querySelectorAll(
          ".priv-purpose-container .sp-switch-arrow-block a.switch-bg.on"
        );
        for (const t of switches) {
          t.click();
        }
        return await this.click(".priv-save-btn");
      }
      if (this.elementVisible(".sp_choice_type_SE", "any")) {
        await this.click(
          [
            "xpath///div[contains(., 'Do not share my personal information') and contains(@class, 'switch-container')]",
            ".pm-switch[aria-checked=false] .slider"
          ],
          false
        );
        return await this.click(".sp_choice_type_SE");
      }
      if (!this.isManagerOpen()) {
        const manageSelector = '.sp_choice_type_12,[data-choice]:not([class*="sp_choice_type_"])';
        const actionable = await this.waitForVisible(`${manageSelector},.sp_choice_type_13`);
        if (!actionable) {
          return false;
        }
        if (this.elementVisible(".sp_choice_type_13", "any")) {
          return await this.click(".sp_choice_type_13");
        }
        await this.click(manageSelector);
        await waitFor(() => this.isManagerOpen(), 200, 100);
      }
      await this.waitForElement(".type-modal", 2e4);
      if (this.elementExists("[role=tablist]")) {
        await this.waitForElement("[role=tablist] [role=tab]", 1e4);
      }
      this.waitForThenClick(".ccpa-stack .pm-switch[aria-checked=true] .slider", 500, true);
      try {
        const rejectSelector1 = ".sp_choice_type_REJECT_ALL";
        const rejectSelector2 = ".reject-toggle";
        const path = await Promise.race([
          this.waitForElement(rejectSelector1, 2e3).then((success) => success ? 0 : -1),
          this.waitForElement(rejectSelector2, 2e3).then((success) => success ? 1 : -1),
          this.waitForElement(".pm-features", 2e3).then((success) => success ? 2 : -1)
        ]);
        if (path === 0) {
          await this.waitForVisible(rejectSelector1);
          return await this.click(rejectSelector1);
        } else if (path === 1) {
          await this.click(rejectSelector2);
        } else if (path === 2) {
          await this.waitForElement(".pm-features", 1e4);
          await this.click(".checked > span", true);
          await this.click(".chevron");
        }
      } catch (e) {
        logsConfig.errors && console.warn(e);
      }
      return await this.click(".sp_choice_type_SAVE_AND_EXIT");
    }
  };

  // lib/cmps/consentmanager.ts
  var ConsentManager = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "consentmanager.net";
      this.prehideSelectors = ["#cmpbox,#cmpbox2"];
      this.apiAvailable = false;
    }
    get hasSelfTest() {
      return this.apiAvailable;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      this.apiAvailable = await this.mainWorldEval("EVAL_CONSENTMANAGER_1");
      if (!this.apiAvailable) {
        return this.elementExists("#cmpbox");
      } else {
        return true;
      }
    }
    async detectPopup() {
      if (this.elementVisible("#cmpbox .cmpmore", "any")) {
        return true;
      } else if (this.apiAvailable) {
        await this.wait(500);
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_2");
      }
      return false;
    }
    async optOut() {
      await this.wait(500);
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_3");
      }
      if (await this.click(".cmpboxbtnno")) {
        return true;
      }
      if (this.elementExists(".cmpwelcomeprpsbtn")) {
        await this.click(".cmpwelcomeprpsbtn > a[aria-checked=true]", true);
        await this.click(".cmpboxbtnsave");
        return true;
      }
      await this.click(".cmpboxbtncustom");
      await this.waitForElement(".cmptblbox", 2e3);
      await this.click(".cmptdchoice > a[aria-checked=true]", true);
      await this.click(".cmpboxbtnyescustomchoices");
      this.hide("#cmpwrapper,#cmpbox", "display");
      return true;
    }
    async optIn() {
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_4");
      }
      return await this.click(".cmpboxbtnyes");
    }
    async test() {
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_5");
      }
      return false;
    }
  };

  // lib/cmps/evidon.ts
  var Evidon = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Evidon";
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return this.elementExists("#_evidon_banner");
    }
    async detectPopup() {
      return this.elementVisible("#_evidon_banner", "any");
    }
    async optOut() {
      if (await this.click("#_evidon-decline-button")) {
        return true;
      }
      hideElements(getStyleElement(), "#evidon-prefdiag-overlay,#evidon-prefdiag-background,#_evidon-background");
      await this.waitForThenClick("#_evidon-option-button");
      await this.waitForElement("#evidon-prefdiag-overlay", 5e3);
      await this.wait(500);
      await this.waitForThenClick("#evidon-prefdiag-decline");
      return true;
    }
    async optIn() {
      return await this.click("#_evidon-accept-button");
    }
  };

  // lib/cmps/onetrust.ts
  var Onetrust = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Onetrust";
      this.prehideSelectors = ["#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,.js-consent-banner"];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    // Some sites pre-render the banner before the SDK loads, and clicks before then may be lost.
    // Sites that copy the markup without the SDK never get #onetrust-style, so only wait when the page loads the SDK.
    async waitForSdk() {
      if (this.elementExists("#onetrust-style")) {
        return;
      }
      const sdkRef = /cookielaw\.org|otSDKStub|otBannerSdk/;
      const sdkExpected = Array.from(document.scripts).some((s) => sdkRef.test(s.src) || !s.src && sdkRef.test(s.textContent || ""));
      if (sdkExpected) {
        await this.waitForElement("#onetrust-style", 1e4);
      }
    }
    async detectCmp() {
      return this.elementExists("#onetrust-banner-sdk") || this.elementVisible("#onetrust-pc-sdk", "any");
    }
    async detectPopup() {
      return this.elementVisible("#onetrust-banner-sdk,#onetrust-pc-sdk", "any");
    }
    async optOut() {
      await this.wait(500);
      await this.waitForSdk();
      if (this.elementVisible("#onetrust-reject-all-handler", "any")) {
        return await this.click("#onetrust-reject-all-handler");
      }
      if (this.elementVisible(".ot-pc-refuse-all-handler", "any")) {
        return await this.click(".ot-pc-refuse-all-handler");
      }
      if (this.elementVisible(".js-reject-cookies", "any")) {
        return await this.click(".js-reject-cookies");
      }
      if (this.elementVisible(".onetrust-close-btn-handler", "any")) {
        const closeBtn = document.querySelector(".onetrust-close-btn-handler");
        const btnText = closeBtn?.textContent?.toLowerCase() || "";
        const rejectPatterns = ["without", "ohne", "sans", "sin ", "zonder", "senza", "refuse", "decline", "reject", "ablehnen"];
        if (rejectPatterns.some((pattern) => btnText.includes(pattern))) {
          return await this.click(".onetrust-close-btn-handler");
        }
        const banner = document.getElementById("onetrust-banner-sdk");
        const isCloseOnlyNotice = banner?.classList.contains("ot-close-btn-link") && !this.elementExists(
          "#onetrust-accept-btn-handler,#onetrust-reject-all-handler,#onetrust-pc-btn-handler,.ot-sdk-show-settings,button.js-cookie-settings"
        );
        if (isCloseOnlyNotice) {
          return await this.click(".onetrust-close-btn-handler");
        }
      }
      if (this.elementExists("#onetrust-pc-btn-handler")) {
        await this.click("#onetrust-pc-btn-handler");
      } else {
        await this.click(".ot-sdk-show-settings,button.js-cookie-settings");
      }
      await this.waitForElement("#onetrust-consent-sdk", 2e3);
      await this.wait(1e3);
      await this.click("#onetrust-consent-sdk input.category-switch-handler:checked,.js-editor-toggle-state:checked", true);
      await this.wait(1e3);
      await this.waitForElement(".save-preference-btn-handler,.js-consent-save", 2e3);
      await this.click(".save-preference-btn-handler,.js-consent-save");
      await this.waitForVisible("#onetrust-banner-sdk", 5e3, "none");
      return true;
    }
    async optIn() {
      await this.waitForSdk();
      return await this.click("#onetrust-accept-btn-handler,#accept-recommended-btn-handler,.js-accept-cookies");
    }
    async test() {
      return await waitFor(() => this.mainWorldEval("EVAL_ONETRUST_1"), 10, 500);
    }
  };

  // lib/cmps/klaro.ts
  var Klaro = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Klaro";
      this.prehideSelectors = [".klaro"];
      this.settingsOpen = false;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      if (this.elementExists(".klaro > .cookie-modal")) {
        this.settingsOpen = true;
        return true;
      }
      return this.elementExists(".klaro > .cookie-notice");
    }
    async detectPopup() {
      return this.elementVisible(".klaro > .cookie-notice,.klaro > .cookie-modal", "any");
    }
    async optOut() {
      const apiOptOutSuccess = await this.mainWorldEval("EVAL_KLARO_TRY_API_OPT_OUT");
      if (apiOptOutSuccess) {
        return true;
      }
      if (await this.click(".klaro .cn-decline")) {
        return true;
      }
      await this.mainWorldEval("EVAL_KLARO_OPEN_POPUP");
      if (await this.click(".klaro .cn-decline")) {
        return true;
      }
      await this.click(
        ".cm-purpose:not(.cm-toggle-all) > input:not(.half-checked,.required,.only-required),.cm-purpose:not(.cm-toggle-all) > div > input:not(.half-checked,.required,.only-required)",
        true
      );
      return await this.click(".cm-btn-accept,.cm-button");
    }
    async optIn() {
      if (await this.click(".klaro .cm-btn-accept-all")) {
        return true;
      }
      if (this.settingsOpen) {
        await this.click(".cm-purpose:not(.cm-toggle-all) > input.half-checked", true);
        return await this.click(".cm-btn-accept");
      }
      return await this.click(".klaro .cookie-notice .cm-btn-success");
    }
    async test() {
      return await this.mainWorldEval("EVAL_KLARO_1");
    }
  };

  // lib/cmps/uniconsent.ts
  var Uniconsent = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Uniconsent";
    }
    get prehideSelectors() {
      return [".unic", ".modal:has(.unic)"];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return this.elementExists(".unic .unic-box,.unic .unic-bar,.unic .unic-modal");
    }
    async detectPopup() {
      return this.elementVisible(".unic .unic-box,.unic .unic-bar,.unic .unic-modal", "any");
    }
    async optOut() {
      await this.waitForElement(".unic button", 1e3);
      document.querySelectorAll(".unic button").forEach((button) => {
        const text = button.textContent || "";
        if (text.includes("Manage Options") || text.includes("Optionen verwalten")) {
          button.click();
        }
      });
      if (await this.waitForElement(".unic input[type=checkbox]", 1e3)) {
        await this.waitForElement(".unic button", 1e3);
        document.querySelectorAll(".unic input[type=checkbox]").forEach((c) => {
          if (c.checked) {
            c.click();
          }
        });
        for (const b of document.querySelectorAll(".unic button")) {
          const text = b.textContent || "";
          for (const pattern of ["Confirm Choices", "Save Choices", "Auswahl speichern"]) {
            if (text.includes(pattern)) {
              b.click();
              await this.wait(500);
              return true;
            }
          }
        }
      }
      return false;
    }
    async optIn() {
      return this.waitForThenClick(".unic #unic-agree");
    }
    async test() {
      await this.wait(1e3);
      const res = this.elementExists(".unic .unic-box,.unic .unic-bar");
      return !res;
    }
  };

  // lib/cmps/conversant.ts
  var Conversant = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.prehideSelectors = [".cmp-root"];
      this.name = "Conversant";
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return this.elementExists(".cmp-root .cmp-receptacle");
    }
    async detectPopup() {
      return this.elementVisible(".cmp-root .cmp-receptacle", "any");
    }
    async optOut() {
      if (!await this.waitForThenClick(".cmp-main-button:not(.cmp-main-button--primary)")) {
        return false;
      }
      if (!await this.waitForElement(".cmp-view-tab-tabs")) {
        return false;
      }
      await this.waitForThenClick(".cmp-view-tab-tabs > :first-child");
      await this.waitForThenClick(".cmp-view-tab-tabs > .cmp-view-tab--active:first-child");
      for (const item of Array.from(document.querySelectorAll(".cmp-accordion-item"))) {
        item.querySelector(".cmp-accordion-item-title").click();
        await waitFor(() => !!item.querySelector(".cmp-accordion-item-content.cmp-active"), 10, 50);
        const content = item.querySelector(".cmp-accordion-item-content.cmp-active");
        if (!content) {
          return false;
        }
        content.querySelectorAll(".cmp-toggle-actions .cmp-toggle-deny:not(.cmp-toggle-deny--active)").forEach((e) => e.click());
        content.querySelectorAll(".cmp-toggle-actions .cmp-toggle-checkbox:not(.cmp-toggle-checkbox--active)").forEach((e) => e.click());
      }
      await this.click(".cmp-main-button:not(.cmp-main-button--primary)");
      return true;
    }
    async optIn() {
      return this.waitForThenClick(".cmp-main-button.cmp-main-button--primary");
    }
    async test() {
      return document.cookie.includes("cmp-data=0");
    }
  };

  // lib/cmps/tiktok.ts
  var Tiktok = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "tiktok.com";
      this.runContext = {
        urlPattern: "tiktok"
      };
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    getShadowRoot() {
      const container = document.querySelector("tiktok-cookie-banner");
      if (!container) {
        return null;
      }
      return container.shadowRoot;
    }
    async detectCmp() {
      return this.elementExists("tiktok-cookie-banner");
    }
    async detectPopup() {
      const banner = this.getShadowRoot()?.querySelector(".tiktok-cookie-banner");
      return isElementVisible(banner);
    }
    async optOut() {
      const logsConfig = this.autoconsent.config.logs;
      const declineButton = this.getShadowRoot()?.querySelector(".button-wrapper button:first-child");
      if (declineButton) {
        logsConfig.rulesteps && console.log("[clicking]", declineButton);
        declineButton.click();
        return true;
      } else {
        logsConfig.errors && console.log("no decline button found");
        return false;
      }
    }
    async optIn() {
      const logsConfig = this.autoconsent.config.logs;
      const acceptButton = this.getShadowRoot()?.querySelector(".button-wrapper button:last-child");
      if (acceptButton) {
        logsConfig.rulesteps && console.log("[clicking]", acceptButton);
        acceptButton.click();
        return true;
      } else {
        logsConfig.errors && console.log("no accept button found");
        return false;
      }
    }
    async test() {
      const match = document.cookie.match(/cookie-consent=([^;]+)/);
      if (!match) {
        return false;
      }
      const value = JSON.parse(decodeURIComponent(match[1]));
      return Object.values(value).every((x) => typeof x !== "boolean" || x === false);
    }
  };

  // lib/cmps/admiral.ts
  var Admiral = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Admiral";
      this.consentCardSelector = "div > div[class*=Card] > div[class*=Frame] > div[class*=Pills] > button[class*=Pills__StyledPill]";
    }
    getVrmNotice() {
      return Array.from(document.querySelectorAll("body > div")).find((element) => {
        const text = element.innerText || "";
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.position === "fixed" && rect.width > 0 && rect.height > 0 && text.includes("Your Privacy") && text.includes("VRM") && text.includes("Admiral");
      });
    }
    isVisibleElement(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    getVrmCloseButton() {
      const notice = this.getVrmNotice();
      const closeButton = notice?.querySelector('button[aria-label="Close"]');
      return closeButton && this.isVisibleElement(closeButton) ? closeButton : null;
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return await this.elementExists(this.consentCardSelector) || Boolean(this.getVrmNotice());
    }
    async detectPopup() {
      return await this.elementVisible(this.consentCardSelector, "any") || Boolean(this.getVrmNotice());
    }
    async optOut() {
      const rejectAllSelector = "xpath///button[contains(., 'Afvis alle') or contains(., 'Reject all') or contains(., 'Odbaci sve') or contains(., 'Rechazar todo') or contains(., 'Atmesti visus') or contains(., 'Odm\xEDtnout v\u0161e') or contains(., '\u0391\u03C0\u03CC\u03C1\u03C1\u03B9\u03C8\u03B7 \u03CC\u03BB\u03C9\u03BD') or contains(., 'Rejeitar tudo') or contains(., 'T\xFCm\xFCn\xFC reddet') or contains(., '\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C \u0432\u0441\u0435') or contains(., 'Noraid\u012Bt visu') or contains(., 'Avvisa alla') or contains(., 'Odrzu\u0107 wszystkie') or contains(., 'Alles afwijzen') or contains(., '\u041E\u0442\u0445\u0432\u044A\u0440\u043B\u044F\u043D\u0435 \u043D\u0430 \u0432\u0441\u0438\u0447\u043A\u0438') or contains(., 'Rifiuta tutto') or contains(., 'Zavrni vse') or contains(., 'Az \xF6sszes elutas\xEDt\xE1sa') or contains(., 'Respinge\u021Bi tot') or contains(., 'Alles ablehnen') or contains(., 'Tout rejeter') or contains(., 'Odmietnu\u0165 v\u0161etko') or contains(., 'L\xFCkka k\xF5ik tagasi') or contains(., 'Hylk\xE4\xE4 kaikki')]";
      if (await this.waitForElement(rejectAllSelector, 500)) {
        return await this.click(rejectAllSelector);
      }
      const vrmCloseButton = this.getVrmCloseButton();
      if (vrmCloseButton) {
        return await this.clickElement(vrmCloseButton);
      }
      const purposesButtonSelector = "xpath///button[contains(., 'Zwecke') or contains(., '\u03A3\u03BA\u03BF\u03C0\u03BF\u03AF') or contains(., 'Purposes') or contains(., '\u0426\u0435\u043B\u0438') or contains(., 'Eesm\xE4rgid') or contains(., 'Tikslai') or contains(., 'Svrhe') or contains(., 'Cele') or contains(., '\xDA\u010Dely') or contains(., 'Finalidades') or contains(., 'M\u0113r\u0137i') or contains(., 'Scopuri') or contains(., 'Fines') or contains(., '\xC4ndam\xE5l') or contains(., 'Finalit\xE9s') or contains(., 'Doeleinden') or contains(., 'Tarkoitukset') or contains(., 'Scopi') or contains(., 'Ama\xE7lar') or contains(., 'Nameni') or contains(., 'C\xE9lok') or contains(., 'Form\xE5l')]";
      const saveAndExitSelector = "xpath///button[contains(., 'Spara & avsluta') or contains(., 'Save & exit') or contains(., 'Ulo\u017Eit a ukon\u010Dit') or contains(., 'Enregistrer et quitter') or contains(., 'Speichern & Verlassen') or contains(., 'Tallenna ja poistu') or contains(., 'I\u0161saugoti ir i\u0161eiti') or contains(., 'Opslaan & afsluiten') or contains(., 'Guardar y salir') or contains(., 'Shrani in zapri') or contains(., 'Ulo\u017Ei\u0165 a ukon\u010Di\u0165') or contains(., 'Kaydet ve \xE7\u0131k\u0131\u015F yap') or contains(., '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438 \u0432\u044B\u0439\u0442\u0438') or contains(., 'Salvesta ja v\xE4lju') or contains(., 'Salva ed esci') or contains(., 'Gem & afslut') or contains(., '\u0391\u03C0\u03BF\u03B8\u03AE\u03BA\u03B5\u03C5\u03C3\u03B7 \u03BA\u03B1\u03B9 \u03AD\u03BE\u03BF\u03B4\u03BF\u03C2') or contains(., 'Saglab\u0101t un iziet') or contains(., 'Ment\xE9s \xE9s kil\xE9p\xE9s') or contains(., 'Guardar e sair') or contains(., 'Zapisz & zako\u0144cz') or contains(., 'Salvare \u0219i ie\u0219ire') or contains(., 'Spremi i iza\u0111i') or contains(., '\u0417\u0430\u043F\u0430\u0437\u0432\u0430\u043D\u0435 \u0438 \u0438\u0437\u0445\u043E\u0434')]";
      if (await this.waitForThenClick(purposesButtonSelector) && await this.waitForVisible(saveAndExitSelector)) {
        const popupBody = this.elementSelector(saveAndExitSelector)[0].parentElement?.parentElement;
        const checkboxes = popupBody?.querySelectorAll("input[type=checkbox]:checked");
        checkboxes?.forEach((checkbox) => checkbox.click());
        return await this.click(saveAndExitSelector);
      }
      return false;
    }
    async optIn() {
      return await this.click(
        "xpath///button[contains(., 'Sprejmi vse') or contains(., 'Prihvati sve') or contains(., 'Godk\xE4nn alla') or contains(., 'Prija\u0165 v\u0161etko') or contains(., '\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0432\u0441\u0435') or contains(., 'Aceptar todo') or contains(., '\u0391\u03C0\u03BF\u03B4\u03BF\u03C7\u03AE \u03CC\u03BB\u03C9\u03BD') or contains(., 'Zaakceptuj wszystkie') or contains(., 'Accetta tutto') or contains(., 'Priimti visus') or contains(., 'Pie\u0146emt visu') or contains(., 'T\xFCm\xFCn\xFC kabul et') or contains(., 'Az \xF6sszes elfogad\xE1sa') or contains(., 'Accept all') or contains(., '\u041F\u0440\u0438\u0435\u043C\u0430\u043D\u0435 \u043D\u0430 \u0432\u0441\u0438\u0447\u043A\u0438') or contains(., 'Accepter alle') or contains(., 'Hyv\xE4ksy kaikki') or contains(., 'Tout accepter') or contains(., 'Alles accepteren') or contains(., 'Aktsepteeri k\xF5ik') or contains(., 'P\u0159ijmout v\u0161e') or contains(., 'Alles akzeptieren') or contains(., 'Aceitar tudo') or contains(., 'Accepta\u021Bi tot')]"
      );
    }
  };

  // lib/cmps/all.ts
  var dynamicCMPs = [
    TrustArcTop,
    Cookiebot,
    SourcePoint,
    ConsentManager,
    Evidon,
    Onetrust,
    Klaro,
    Uniconsent,
    Conversant,
    Tiktok,
    Admiral
  ];

  // lib/dom-actions.ts
  var DEFAULT_CLICK_RETRY_INTERVAL = 300;
  var CLICK_RETRY_POLL_INTERVAL = 50;
  var DomActions = class {
    constructor(autoconsentInstance) {
      this.autoconsentInstance = autoconsentInstance;
    }
    async clickElement(element) {
      if (!element || !(element instanceof HTMLElement)) {
        return false;
      }
      this.autoconsentInstance.config.logs.rulesteps && console.log("[clickElement]", element);
      element.click();
      return true;
    }
    async click(selector, all = false) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[click]", selector, all, elements);
      if (elements.length > 0) {
        if (all) {
          for (const e of elements) {
            e.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else {
          elements[0].click();
        }
      }
      return elements.length > 0;
    }
    elementExists(selector) {
      const exists = this.elementSelector(selector).length > 0;
      return exists;
    }
    elementVisible(selector, check = "all") {
      const elem = this.elementSelector(selector);
      const results = new Array(elem.length);
      elem.forEach((e, i) => {
        results[i] = isElementVisible(e);
      });
      if (check === "none") {
        return results.every((r) => !r);
      } else if (results.length === 0) {
        return false;
      } else if (check === "any") {
        return results.some((r) => r);
      }
      return results.every((r) => r);
    }
    waitForElement(selector, timeout = 1e4) {
      const interval = 200;
      const times = Math.ceil(timeout / interval);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForElement]", selector);
      return waitFor(() => this.elementSelector(selector).length > 0, times, interval);
    }
    waitForVisible(selector, timeout = 1e4, check = "any") {
      const interval = 200;
      const times = Math.ceil(timeout / interval);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForVisible]", selector);
      return waitFor(() => this.elementVisible(selector, check), times, interval);
    }
    async waitForThenClick(selector, timeout = 1e4, all = false, retries = 0, retryInterval = DEFAULT_CLICK_RETRY_INTERVAL) {
      await this.waitForElement(selector, timeout);
      let clicked = await this.click(selector, all);
      for (let attempt = 0; clicked && attempt < retries; attempt++) {
        const pollTimes = Math.ceil(retryInterval / CLICK_RETRY_POLL_INTERVAL);
        const isGone = await waitFor(() => !this.elementVisible(selector, "any"), pollTimes, CLICK_RETRY_POLL_INTERVAL);
        if (isGone) {
          break;
        }
        this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForThenClick] retrying click", selector);
        clicked = await this.click(selector, all);
      }
      return clicked;
    }
    wait(ms) {
      this.autoconsentInstance.config.logs.rulesteps && this.autoconsentInstance.config.logs.waits && console.log("[wait]", ms);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(true);
        }, ms);
      });
    }
    cookieContains(substring) {
      return document.cookie.includes(substring);
    }
    hide(selector, method) {
      this.autoconsentInstance.config.logs.rulesteps && console.log("[hide]", selector);
      const styleEl = getStyleElement();
      return hideElements(styleEl, selector, method);
    }
    stylesheet(cssRule, stylesheetId) {
      this.autoconsentInstance.config.logs.rulesteps && console.log("[stylesheet]", cssRule, stylesheetId);
      const styleEl = getStyleElement();
      return appendStylesheetRule(styleEl, cssRule, stylesheetId);
    }
    removeClass(selector, className) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[removeClass]", selector, className, elements);
      elements.forEach((el) => el.classList.remove(className));
      return elements.length > 0;
    }
    setStyle(selector, css) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[setStyle]", selector, css, elements);
      elements.forEach((el) => el.style.cssText = css);
      return elements.length > 0;
    }
    addStyle(selector, css) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[addStyle]", selector, css, elements);
      elements.forEach((el) => el.style.cssText += "; " + css);
      return elements.length > 0;
    }
    prehide(selector) {
      const styleEl = getStyleElement("autoconsent-prehide");
      this.autoconsentInstance.config.logs.lifecycle && console.log("[prehide]", styleEl, location.href);
      return hideElements(styleEl, selector, "opacity");
    }
    undoPrehide() {
      const existingElement = getStyleElement("autoconsent-prehide");
      this.autoconsentInstance.config.logs.lifecycle && console.log("[undoprehide]", existingElement, location.href);
      existingElement.remove();
    }
    async createOrUpdateStyleSheet(cssText, styleSheet) {
      if (!styleSheet) {
        styleSheet = new CSSStyleSheet();
      }
      styleSheet = await styleSheet.replace(cssText);
      return styleSheet;
    }
    removeStyleSheet(styleSheet) {
      if (styleSheet) {
        styleSheet.replace("");
        return true;
      }
      return false;
    }
    querySingleReplySelector(selector, parent = document) {
      if (selector.startsWith("aria/")) {
        return [];
      }
      if (selector.startsWith("xpath/")) {
        const xpath = selector.slice(6);
        const result = document.evaluate(xpath, parent, null, XPathResult.ANY_TYPE, null);
        let node;
        const elements = [];
        while (node = result.iterateNext()) {
          elements.push(node);
        }
        return elements;
      }
      if (selector.startsWith("text/")) {
        return [];
      }
      if (selector.startsWith("pierce/")) {
        return [];
      }
      if (parent.shadowRoot) {
        return Array.from(parent.shadowRoot.querySelectorAll(selector));
      }
      if (parent.contentDocument?.querySelectorAll) {
        return Array.from(parent.contentDocument.querySelectorAll(selector));
      }
      return Array.from(parent.querySelectorAll(selector));
    }
    querySelectorChain(selectors) {
      let parent = document;
      let matches = [];
      for (const selector of selectors) {
        matches = this.querySingleReplySelector(selector, parent);
        if (matches.length === 0) {
          return [];
        }
        parent = matches[0];
      }
      return matches;
    }
    elementSelector(selector) {
      if (typeof selector === "string") {
        return this.querySingleReplySelector(selector);
      }
      return this.querySelectorChain(selector);
    }
    waitForMutation(selector, timeout = 6e4) {
      const node = this.elementSelector(selector);
      if (node.length === 0) {
        throw new Error(`${selector} did not match any elements`);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Timed out waiting for mutation"));
          observer.disconnect();
        }, timeout);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          observer.disconnect();
          resolve(true);
        });
        observer.observe(node[0], {
          subtree: true,
          childList: true,
          attributes: true
        });
      });
    }
  };

  // lib/encoding.ts
  var compactedRuleSteps = [
    ["exists", "e"],
    ["visible", "v"],
    ["waitForThenClick", "c"],
    ["click", "k"],
    ["waitFor", "w"],
    ["waitForVisible", "wv"],
    ["hide", "h"],
    ["cookieContains", "cc"]
  ];
  function decodeNullableBoolean(value) {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return void 0;
  }
  function decodeRules(encoded) {
    if (encoded.v > 1) {
      throw new Error("Unsupported rule format.");
    }
    return encoded.r.filter((r) => r[0] <= SUPPORTED_RULE_STEP_VERSION).map((rule) => new CompactedCMPRule(rule, encoded.s));
  }
  var CompactedCMPRule = class {
    constructor(rule, strings) {
      this.intermediate = false;
      this.optIn = [];
      this.r = rule;
      this.s = strings;
      if (this.r[10] && this.r[10].intermediate) {
        this.intermediate = this.r[10].intermediate;
      }
    }
    _decodeRuleStep(step) {
      const clonedStep = { ...step };
      const decodeRuleStep = this._decodeRuleStep.bind(this);
      for (const [longKey, shortKey] of compactedRuleSteps) {
        if (clonedStep[shortKey] !== void 0) {
          clonedStep[longKey] = this.s[clonedStep[shortKey]];
          delete clonedStep[shortKey];
        }
      }
      if (step.if) {
        clonedStep.if = decodeRuleStep(step.if);
        clonedStep.then = step.then && step.then.map(decodeRuleStep);
        if (step.else) {
          clonedStep.else = step.else.map(decodeRuleStep);
        }
      }
      if (step.any) {
        clonedStep.any = step.any.map(decodeRuleStep);
      }
      return { ...clonedStep };
    }
    get minimumRuleStepVersion() {
      return this.r[0];
    }
    get name() {
      return this.r[1];
    }
    get cosmetic() {
      return decodeNullableBoolean(this.r[2]);
    }
    get runContext() {
      const runContext = {};
      const urlPattern = this.r[3];
      const mainFrame = this.r[4];
      const runInMainFrame = decodeNullableBoolean(Math.floor(mainFrame / 10) % 10);
      const runInSubFrame = decodeNullableBoolean(mainFrame % 10);
      if (runInMainFrame !== void 0) {
        runContext.main = runInMainFrame;
      }
      if (runInSubFrame !== void 0) {
        runContext.frame = runInSubFrame;
      }
      if (urlPattern !== "") {
        runContext.urlPattern = urlPattern;
      }
      return runContext;
    }
    get prehideSelectors() {
      return this.r[5].map((i) => this.s[i].toString());
    }
    get detectCmp() {
      return this.r[6].map(this._decodeRuleStep.bind(this));
    }
    get detectPopup() {
      return this.r[7].map(this._decodeRuleStep.bind(this));
    }
    get optOut() {
      return this.r[8].map(this._decodeRuleStep.bind(this));
    }
    get test() {
      return this.r[9].map(this._decodeRuleStep.bind(this));
    }
  };

  // lib/web.ts
  function filterCMPs(rules, config) {
    return rules.filter((cmp) => {
      return (!config.disabledCmps || !config.disabledCmps.includes(cmp.name)) && // CMP is not disabled
      (config.enableCosmeticRules || !cmp.isCosmetic) && // CMP is not cosmetic or cosmetic rules are enabled
      (config.enableGeneratedRules || !cmp.name.startsWith("auto_"));
    });
  }
  var _config;
  var AutoConsent = class {
    constructor(sendContentMessage, config = null, declarativeRules = null) {
      this.id = getRandomID();
      this.rules = [];
      __privateAdd(this, _config);
      this.state = {
        lifecycle: "loading",
        prehideOn: false,
        findCmpAttempts: 0,
        detectedCmps: [],
        detectedPopups: [],
        heuristicPatterns: [],
        heuristicSnippets: [],
        selfTest: null,
        clicks: 0,
        startTime: 0,
        endTime: 0
      };
      evalState.sendContentMessage = sendContentMessage;
      this.sendContentMessage = sendContentMessage;
      this.rules = [];
      this.updateState({ lifecycle: "loading" });
      this.addDynamicRules();
      if (config) {
        this.initialize(config, declarativeRules);
      } else {
        if (declarativeRules) {
          this.parseDeclarativeRules(declarativeRules);
        }
        const initMsg = {
          type: "init",
          url: window.location.href
        };
        sendContentMessage(initMsg);
        this.updateState({ lifecycle: "waitingForInitResponse" });
      }
      this.domActions = new DomActions(this);
    }
    get config() {
      if (!__privateGet(this, _config)) {
        throw new Error("AutoConsent is not initialized yet");
      }
      return __privateGet(this, _config);
    }
    initialize(config, declarativeRules) {
      const normalizedConfig = normalizeConfig(config);
      normalizedConfig.logs.lifecycle && console.log("autoconsent init", window.location.href);
      __privateSet(this, _config, normalizedConfig);
      if (!normalizedConfig.enabled) {
        normalizedConfig.logs.lifecycle && console.log("autoconsent is disabled");
        return;
      }
      if (declarativeRules) {
        this.parseDeclarativeRules(declarativeRules);
      }
      this.rules = filterCMPs(this.rules, normalizedConfig);
      if (this.shouldPrehide) {
        if (document.documentElement) {
          this.prehideElements();
        } else {
          const delayedPrehide = () => {
            window.removeEventListener("DOMContentLoaded", delayedPrehide);
            this.prehideElements();
          };
          window.addEventListener("DOMContentLoaded", delayedPrehide);
        }
      }
      if (document.readyState === "loading") {
        const onReady = () => {
          window.removeEventListener("DOMContentLoaded", onReady);
          this.start();
        };
        window.addEventListener("DOMContentLoaded", onReady);
      } else {
        this.start();
      }
      this.updateState({ lifecycle: "initialized" });
    }
    get shouldPrehide() {
      return this.config.enablePrehide && !this.config.visualTest;
    }
    saveFocus() {
      this.focusedElement = document.activeElement;
      if (this.focusedElement) {
        this.config.logs.lifecycle && console.log("saving focus", this.focusedElement, location.href);
      }
    }
    restoreFocus() {
      if (this.focusedElement) {
        this.config.logs.lifecycle && console.log("restoring focus", this.focusedElement, location.href);
        try {
          this.focusedElement.focus({ preventScroll: true });
        } catch (e) {
          this.config.logs.errors && console.warn("error restoring focus", e);
        }
        this.focusedElement = void 0;
      }
    }
    addDynamicRules() {
      dynamicCMPs.forEach((Cmp) => {
        this.rules.push(new Cmp(this));
      });
    }
    parseDeclarativeRules(declarativeRules) {
      const perfEnabled = __privateGet(this, _config)?.performanceLoggingEnabled;
      perfEnabled && performance.mark("parseDeclarativeRulesStart");
      if (declarativeRules.autoconsent) {
        declarativeRules.autoconsent.forEach((ruleset) => {
          this.addDeclarativeCMP(ruleset);
        });
      }
      if (declarativeRules.compact) {
        try {
          const rules = decodeRules(declarativeRules.compact);
          rules.forEach(this.addDeclarativeCMP.bind(this));
        } catch (e) {
          __privateGet(this, _config)?.logs.errors && console.error(e);
        }
      }
      perfEnabled && performance.mark("parseDeclarativeRulesEnd");
      perfEnabled && performance.measure("parseDeclarativeRules", "parseDeclarativeRulesStart", "parseDeclarativeRulesEnd");
    }
    addDeclarativeCMP(ruleset) {
      if ((ruleset.minimumRuleStepVersion || 1) <= SUPPORTED_RULE_STEP_VERSION) {
        this.rules.push(new AutoConsentCMP(ruleset, this));
      }
    }
    // start the detection process, possibly with a delay
    start() {
      scheduleWhenIdle(() => this._start());
    }
    async _start() {
      const logsConfig = this.config.logs;
      logsConfig.lifecycle && console.log(`Detecting CMPs on ${window.location.href}`);
      this.updateState({ lifecycle: "started" });
      const foundCmps = await this.findCmp(this.config.detectRetries);
      this.updateState({ detectedCmps: foundCmps.map((c) => c.name) });
      if (this.config.performanceLoggingEnabled) {
        this.updateState({ performance: this.measurePerformance() });
      }
      if (foundCmps.length === 0) {
        logsConfig.lifecycle && console.log("no CMP found", location.href);
        if (this.shouldPrehide) {
          this.undoPrehide();
        }
        this.updateState({ lifecycle: "nothingDetected" });
        return false;
      }
      this.updateState({ lifecycle: "cmpDetected" });
      const staticCmps = [];
      const cosmeticCmps = [];
      for (const cmp of foundCmps) {
        if (cmp.isCosmetic) {
          cosmeticCmps.push(cmp);
        } else {
          staticCmps.push(cmp);
        }
      }
      let result = false;
      let foundPopups = await this.detectPopups(staticCmps, async (cmp) => {
        result = await this.handlePopup(cmp);
      });
      if (foundPopups.length === 0) {
        foundPopups = await this.detectPopups(cosmeticCmps, async (cmp) => {
          result = await this.handlePopup(cmp);
        });
      }
      if (foundPopups.length === 0) {
        logsConfig.lifecycle && console.log("no popup found");
        if (this.shouldPrehide) {
          this.undoPrehide();
        }
        return false;
      }
      if (foundPopups.length > 1) {
        const errorDetails = {
          msg: `Found multiple CMPs, check the detection rules.`,
          cmps: foundPopups.map((cmp) => cmp.name)
        };
        logsConfig.errors && console.warn(errorDetails.msg, errorDetails.cmps);
        this.sendContentMessage({
          type: "autoconsentError",
          details: errorDetails
        });
      }
      return result;
    }
    async findCmp(retries) {
      const logsConfig = this.config.logs;
      this.updateState({ findCmpAttempts: this.state.findCmpAttempts + 1 });
      const foundCMPs = [];
      const isTop = isTopFrame();
      const siteSpecificRules = [];
      const genericRules = [];
      this.rules.forEach((cmp) => {
        if (cmp.checkFrameContext(isTop)) {
          const isSiteSpecific = !!cmp.runContext.urlPattern;
          if (cmp.hasMatchingUrlPattern()) {
            siteSpecificRules.push(cmp);
          } else if (!isSiteSpecific) {
            genericRules.push(cmp);
          }
        }
      });
      const heuristicEnabled = isTop && this.config.heuristicMode !== "off";
      const heuristicRules = heuristicEnabled && this.state.findCmpAttempts % 2 === 0 ? [new AutoConsentHeuristicCMP(this, this.config.heuristicMode)] : [];
      const rulesPriorityStages = [
        ["site-specific", siteSpecificRules],
        ["generic", genericRules],
        ["heuristic", heuristicRules]
      ];
      const runDetectCmp = async (cmp) => {
        try {
          const result = await cmp.detectCmp();
          if (result) {
            logsConfig.lifecycle && console.log(`Found CMP: ${cmp.name} ${window.location.href}`);
            this.sendContentMessage({
              type: "cmpDetected",
              url: location.href,
              cmp: cmp.name
            });
            foundCMPs.push(cmp);
          }
        } catch (e) {
          logsConfig.errors && console.warn(`error detecting ${cmp.name}`, e);
        }
      };
      const mutationObserver = this.domActions.waitForMutation("html");
      mutationObserver.catch(() => {
      });
      for (const [stageName, ruleGroup] of rulesPriorityStages) {
        logsConfig.lifecycle && ruleGroup.length > 0 && console.log(
          `Trying ${stageName} rules`,
          ruleGroup.map((r) => r.name)
        );
        this.config.performanceLoggingEnabled && performance.mark(`findCmpStage_${stageName}`);
        await Promise.all(ruleGroup.map(runDetectCmp));
        this.config.performanceLoggingEnabled && performance.mark(`findCmpStageEnd_${stageName}`);
        this.config.performanceLoggingEnabled && performance.measure(`findCmp_${stageName}`, `findCmpStage_${stageName}`, `findCmpStageEnd_${stageName}`);
        if (foundCMPs.length > 0) {
          break;
        }
      }
      this.detectHeuristics();
      if (foundCMPs.length === 0 && retries > 0) {
        const waitFor2 = [this.domActions.wait(500)];
        const heuristicSkipped = heuristicEnabled && heuristicRules.length === 0;
        if (this.state.findCmpAttempts > 1 && !heuristicSkipped) {
          waitFor2.push(mutationObserver);
        }
        try {
          await Promise.all(waitFor2);
        } catch (e) {
          return [];
        }
        return this.findCmp(retries - 1);
      }
      return foundCMPs;
    }
    detectHeuristics() {
      if (this.config.enableHeuristicDetection) {
        this.config.performanceLoggingEnabled && performance.mark("detectHeuristicsStart");
        const { patterns, snippets: snippets2 } = checkHeuristicPatterns(document.documentElement?.innerText || "");
        if (patterns.length > 0 && (patterns.length !== this.state.heuristicPatterns.length || this.state.heuristicPatterns.some((p, i) => p !== patterns[i]))) {
          this.config.logs.lifecycle && console.log("Heuristic patterns found", patterns, snippets2);
          this.updateState({ heuristicPatterns: patterns, heuristicSnippets: snippets2 });
        }
        this.config.performanceLoggingEnabled && performance.mark("detectHeuristicsEnd");
        this.config.performanceLoggingEnabled && performance.measure("detectHeuristics", "detectHeuristicsStart", "detectHeuristicsEnd");
      }
    }
    /**
     * Detect if a CMP has a popup open. Fullfils with the CMP if a popup is open, otherwise rejects.
     */
    async detectPopup(cmp) {
      const isOpen = await this.waitForPopup(cmp).catch((error) => {
        this.config.logs.errors && console.warn(`error waiting for a popup for ${cmp.name}`, error);
        return false;
      });
      if (isOpen) {
        this.updateState({ detectedPopups: this.state.detectedPopups.concat([cmp.name]) });
        this.sendContentMessage({
          type: "popupFound",
          cmp: cmp.name,
          url: location.href
        });
        return cmp;
      }
      throw new Error("Popup is not shown");
    }
    /**
     * Detect if any of the CMPs has a popup open. Returns a list of CMPs with open popups.
     */
    async detectPopups(cmps, onFirstPopupAppears) {
      const tasks = cmps.map((cmp) => this.detectPopup(cmp));
      await Promise.any(tasks).then((cmp) => {
        this.detectHeuristics();
        onFirstPopupAppears(cmp);
      }).catch(() => {
      });
      const results = await Promise.allSettled(tasks);
      const popups = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          popups.push(result.value);
        }
      }
      return popups;
    }
    async handlePopup(cmp) {
      this.updateState({ lifecycle: "openPopupDetected", startTime: Date.now() });
      if (this.shouldPrehide && !this.state.prehideOn) {
        this.prehideElements();
      }
      this.foundCmp = cmp;
      if (this.config.autoAction === "optOut") {
        return await this.doOptOut();
      } else if (this.config.autoAction === "optIn") {
        return await this.doOptIn();
      } else {
        this.config.logs.lifecycle && console.log("waiting for opt-out signal...", location.href);
        return true;
      }
    }
    async doOptOut() {
      const logsConfig = this.config.logs;
      this.updateState({ lifecycle: "runningOptOut" });
      this.saveFocus();
      let optOutResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to opt out");
        optOutResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: opt out on ${window.location.href}`);
        optOutResult = await this.foundCmp.optOut();
        logsConfig.lifecycle && console.log(`${this.foundCmp.name}: opt out result ${optOutResult}`);
      }
      if (this.shouldPrehide) {
        this.undoPrehide();
      }
      this.sendContentMessage({
        type: "optOutResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: optOutResult,
        scheduleSelfTest: Boolean(this.foundCmp && this.foundCmp.hasSelfTest),
        url: location.href
      });
      if (optOutResult && this.foundCmp && !this.foundCmp.isIntermediate) {
        this.state.endTime = Date.now();
        logsConfig.lifecycle && console.log(
          `${this.foundCmp.name}: done in ${this.state.endTime - this.state.startTime}ms with ${this.state.clicks} clicks`
        );
        this.sendContentMessage({
          type: "autoconsentDone",
          cmp: this.foundCmp?.name,
          isCosmetic: this.foundCmp?.isCosmetic,
          url: location.href,
          duration: this.state.endTime - this.state.startTime,
          totalClicks: this.state.clicks
        });
        this.updateState({ lifecycle: "done" });
      } else {
        this.updateState({ lifecycle: optOutResult ? "optOutSucceeded" : "optOutFailed" });
      }
      this.restoreFocus();
      return optOutResult;
    }
    async doOptIn() {
      const logsConfig = this.config.logs;
      this.updateState({ lifecycle: "runningOptIn" });
      this.saveFocus();
      let optInResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to opt in");
        optInResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: opt in on ${window.location.href}`);
        optInResult = await this.foundCmp.optIn();
        logsConfig.lifecycle && console.log(`${this.foundCmp.name}: opt in result ${optInResult}`);
      }
      if (this.shouldPrehide) {
        this.undoPrehide();
      }
      this.sendContentMessage({
        type: "optInResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: optInResult,
        scheduleSelfTest: false,
        // self-tests are only for opt-out at the moment
        url: location.href
      });
      if (optInResult && this.foundCmp && !this.foundCmp.isIntermediate) {
        this.state.endTime = Date.now();
        logsConfig.lifecycle && console.log(
          `${this.foundCmp.name}: done in ${this.state.endTime - this.state.startTime}ms with ${this.state.clicks} clicks`
        );
        this.sendContentMessage({
          type: "autoconsentDone",
          cmp: this.foundCmp.name,
          isCosmetic: this.foundCmp.isCosmetic,
          url: location.href,
          duration: this.state.endTime - this.state.startTime,
          totalClicks: this.state.clicks
        });
        this.updateState({ lifecycle: "done" });
      } else {
        this.updateState({ lifecycle: optInResult ? "optInSucceeded" : "optInFailed" });
      }
      this.restoreFocus();
      return optInResult;
    }
    async doSelfTest() {
      const logsConfig = this.config.logs;
      let selfTestResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to self test");
        selfTestResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: self-test on ${window.location.href}`);
        selfTestResult = await this.foundCmp.test();
      }
      this.sendContentMessage({
        type: "selfTestResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: selfTestResult,
        url: location.href
      });
      this.updateState({ selfTest: selfTestResult });
      return selfTestResult;
    }
    async waitForPopup(cmp, retries = 10, interval = 500) {
      const logsConfig = this.config.logs;
      logsConfig.lifecycle && console.log("checking if popup is open...", cmp.name);
      let mutationObserver = null;
      if (this.config.enablePopupMutationObserver) {
        mutationObserver = this.domActions.waitForMutation("html", 1e4);
        mutationObserver.catch(() => {
        });
      }
      const isOpen = await cmp.detectPopup().catch((e) => {
        logsConfig.errors && console.warn(`error detecting popup for ${cmp.name}`, e);
        return false;
      });
      if (!isOpen && retries > 0) {
        if (mutationObserver) {
          try {
            await Promise.all([this.domActions.wait(interval), mutationObserver]);
          } catch (e) {
            logsConfig.lifecycle && console.log(cmp.name, "popup detection timed out waiting for DOM mutation");
          }
        } else {
          await this.domActions.wait(interval);
        }
        return this.waitForPopup(cmp, retries - 1, interval);
      }
      logsConfig.lifecycle && console.log(cmp.name, `popup is ${isOpen ? "open" : "not open"}`);
      return isOpen;
    }
    prehideElements() {
      const logsConfig = this.config.logs;
      const globalHidden = [
        "#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium"
      ];
      const selectors = this.rules.filter((rule) => rule.prehideSelectors && rule.checkRunContext()).reduce((selectorList, rule) => [...selectorList || [], ...rule.prehideSelectors || []], globalHidden);
      this.updateState({ prehideOn: true });
      setTimeout(() => {
        if (this.shouldPrehide && this.state.prehideOn && !["runningOptOut", "runningOptIn"].includes(this.state.lifecycle)) {
          logsConfig.lifecycle && console.log("Process is taking too long, unhiding elements");
          this.undoPrehide();
        }
      }, this.config.prehideTimeout || 2e3);
      return this.domActions.prehide(selectors.join(","));
    }
    undoPrehide() {
      this.updateState({ prehideOn: false });
      this.domActions.undoPrehide();
    }
    updateState(change) {
      Object.assign(this.state, change);
      this.sendContentMessage({
        type: "report",
        instanceId: this.id,
        url: window.location.href,
        mainFrame: isTopFrame(),
        state: this.state
      });
    }
    async receiveMessageCallback(message) {
      const logsConfig = __privateGet(this, _config)?.logs;
      if (logsConfig?.messages) {
        console.log("received from background", message, window.location.href);
      }
      switch (message.type) {
        case "initResp":
          this.initialize(message.config, message.rules);
          break;
        case "optIn":
          await this.doOptIn();
          break;
        case "optOut":
          await this.doOptOut();
          break;
        case "selfTest":
          await this.doSelfTest();
          break;
        case "evalResp":
          resolveEval(message.id, message.result);
          break;
        case "measurePerformance":
          this.updateState({ performance: this.measurePerformance() });
          break;
      }
    }
    measurePerformance() {
      const getRoundedPerformanceEntries = (name) => performance.getEntriesByName(name).map((m) => Number(m.duration.toFixed(3)));
      return {
        detectHeuristics: getRoundedPerformanceEntries("detectHeuristics"),
        heuristicDetector: getRoundedPerformanceEntries("heuristicDetector"),
        findCmpSiteSpecific: getRoundedPerformanceEntries("findCmp_site-specific"),
        findCmpGeneric: getRoundedPerformanceEntries("findCmp_generic"),
        findCmpHeuristic: getRoundedPerformanceEntries("findCmp_heuristic"),
        parseDeclarativeRules: getRoundedPerformanceEntries("parseDeclarativeRules")
      };
    }
  };
  _config = new WeakMap();

  // playwright/content.ts
  window.autoconsentHeuristics = { getPotentialPopups, getButtonData };
  if (!window.autoconsentReceiveMessage) {
    const consent = new AutoConsent(window.autoconsentSendMessage, null, { autoconsent: [] });
    window.autoconsentReceiveMessage = (message) => {
      return Promise.resolve(consent.receiveMessageCallback(message));
    };
  } else {
    console.warn("autoconsent already initialized", window.autoconsentReceiveMessage);
  }
})();

}
