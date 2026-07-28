(function () {
  "use strict";

  var header = document.getElementById("siteHeader");
  var navToggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");
  var signupForm = document.getElementById("signupForm");
  var signupSuccess = document.getElementById("signupSuccess");
  var signupSuccessDemoLink = document.getElementById("signupSuccessDemoLink");

  // backend/signup-form/README.md の手順でデプロイしたGoogle Apps ScriptウェブアプリのURLに置き換える。
  var SIGNUP_ENDPOINT_URL =
    "https://script.google.com/macros/s/AKfycbz7Ov6aP9havC3CSVYPFVEM8pc0kEZ9MD9voJIxHjmJ3wPWtYmOjaRV3JALWY9Lpp90/exec";

  function updateHeaderState() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  function toggleNav() {
    if (!nav || !navToggle) return;
    var isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  }

  if (navToggle) {
    navToggle.addEventListener("click", toggleNav);
  }

  if (nav) {
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
  }

  window.addEventListener("scroll", updateHeaderState, { passive: true });
  updateHeaderState();

  var revealTargets = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && revealTargets.length) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealTargets.forEach(function (target) {
      revealObserver.observe(target);
    });
  } else {
    revealTargets.forEach(function (target) {
      target.classList.add("is-visible");
    });
  }

  if (signupForm && signupSuccess) {
    signupForm.addEventListener("submit", function (event) {
      event.preventDefault();

      if (!signupForm.checkValidity()) {
        signupForm.reportValidity();
        return;
      }

      if (signupSuccessDemoLink) {
        var companyName = (signupForm.elements.company.value || "").trim();
        signupSuccessDemoLink.href = companyName
          ? "company-profile.html?companyName=" + encodeURIComponent(companyName)
          : "company-profile.html";
      }

      if (SIGNUP_ENDPOINT_URL && SIGNUP_ENDPOINT_URL.indexOf("REPLACE_WITH") !== 0) {
        // no-cors + text/plain: Apps ScriptウェブアプリはCORSプリフライトに対応していないため、
        // プリフライトを発生させない送信方法を使う。レスポンス内容は読めないため成否は判定できない。
        fetch(SIGNUP_ENDPOINT_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            company: (signupForm.elements.company.value || "").trim(),
            name: (signupForm.elements.name.value || "").trim(),
            email: (signupForm.elements.email.value || "").trim(),
            interest: (signupForm.elements.interest.value || "").trim(),
          }),
        }).catch(function () {
          // 送信失敗時もユーザー体験は止めない（成功画面はそのまま表示する）。
        });
      }

      signupForm.hidden = true;
      signupSuccess.hidden = false;
      signupSuccess.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
})();
