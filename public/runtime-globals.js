// Author/creator: nattapat2871 (https://nattapat2871.me)
// Minimal browser compatibility values; no Node.js APIs or secrets are exposed.
window.global = window
window.process = Object.freeze({ env: Object.freeze({}) })
