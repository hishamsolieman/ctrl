import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// Renders a CODE128 barcode as inline SVG. Used for on-screen previews.
export default function Barcode({ value, height = 48, fontSize = 13, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format: "CODE128",
        width: 2,
        height,
        displayValue: true,
        fontSize,
        textMargin: 2,
        margin: 4,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      /* invalid value — leave empty */
    }
  }, [value, height, fontSize]);

  return <svg ref={ref} className={className} />;
}
