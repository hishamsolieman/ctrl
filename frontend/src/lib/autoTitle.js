// Automatic "full text on hover" for inputs/selects.
//
// Single-line inputs and <select>s clip long text/placeholders with an ellipsis
// (see index.css). This helper detects, on hover/focus, when the displayed text
// (value OR placeholder OR selected option) is wider than the visible box and, if
// so, sets a `title` attribute equal to the full text so it shows on hover. When
// it no longer overflows, our auto-title is removed again. It never touches a
// `title` that the app set itself. Works for LTR and RTL content alike.

let _ctx = null;
function measure(text, font) {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  _ctx.font = font;
  return _ctx.measureText(text).width;
}

function displayedText(el) {
  if (el.tagName === "SELECT") {
    const opt = el.options?.[el.selectedIndex];
    return opt ? opt.text : "";
  }
  return el.value || el.placeholder || "";
}

function isTextField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const skip = ["checkbox", "radio", "range", "file", "color", "button", "submit", "reset"];
  return !skip.includes((el.getAttribute("type") || "text").toLowerCase());
}

function refresh(el) {
  if (!isTextField(el)) return;
  // Respect an app-provided title: only manage titles we created ourselves.
  if (el.title && el.dataset.autoTitle !== "1") return;

  const text = displayedText(el);
  const cs = getComputedStyle(el);
  const padStart = parseFloat(cs.paddingInlineStart || cs.paddingLeft) || 0;
  const padEnd = parseFloat(cs.paddingInlineEnd || cs.paddingRight) || 0;
  const avail = el.clientWidth - padStart - padEnd;

  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`;
  const needed = text ? measure(text, font) : 0;

  if (text && needed > avail + 1) {
    el.title = text;
    el.dataset.autoTitle = "1";
  } else if (el.dataset.autoTitle === "1") {
    el.removeAttribute("title");
    delete el.dataset.autoTitle;
  }
}

export function initAutoTitles() {
  const handler = (e) => {
    const el = e.target;
    if (isTextField(el)) refresh(el);
  };
  // Recompute lazily on the interactions where a tooltip could appear or the
  // text could have changed. Passive + capture keeps it cheap and reliable.
  document.addEventListener("mouseover", handler, true);
  document.addEventListener("focusin", handler, true);
  document.addEventListener("input", handler, true);
}
