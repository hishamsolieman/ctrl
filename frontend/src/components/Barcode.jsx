import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// Renders a CODE128 barcode as inline SVG. Used for on-screen previews.
export default function Barcode({ value, height = 48, fontSize = 13, displayValue, className = "" }) {
  const ref = useRef(null);
  const showText = displayValue ?? fontSize > 0;

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format: "CODE128",
        width: 2,
        height,
        displayValue: showText,
        fontSize: showText ? fontSize : 0,
        textMargin: showText ? 2 : 0,
        margin: 2,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      /* invalid value — leave empty */
    }
  }, [value, height, fontSize, showText]);

  return <svg ref={ref} className={className} />;
}
