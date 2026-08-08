// Shared ApexCharts styling for the CTRL dark theme: transparent canvas, muted
// axis text, hairline grid, dark tooltips. Brand green leads the palette.
import theme from "@/config/theme";

export const PALETTE = [
  theme.accent,
  "#38BDF8",
  "#FBBF24",
  "#A78BFA",
  "#FB7185",
  "#34D399",
  "#F472B6",
];

const GRID = "rgba(255,255,255,0.07)";

export function baseOptions() {
  return {
    chart: {
      toolbar: { show: false },
      zoom: { enabled: false },
      background: "transparent",
      foreColor: theme.muted,
      fontFamily: "inherit",
      animations: { enabled: true, speed: 400 },
    },
    grid: { borderColor: GRID, strokeDashArray: 3, padding: { left: 8, right: 8 } },
    dataLabels: { enabled: false },
    tooltip: { theme: "dark" },
    legend: { labels: { colors: theme.muted }, markers: { radius: 3 } },
    xaxis: { axisBorder: { color: GRID }, axisTicks: { color: GRID } },
    noData: { text: "" },
  };
}

// Donut/pie defaults — legend below, centred total in the hole.
export function donutOptions({ labels, totalLabel, totalValue }) {
  return {
    ...baseOptions(),
    labels,
    colors: PALETTE,
    stroke: { width: 0 },
    legend: {
      position: "bottom",
      labels: { colors: theme.muted },
      markers: { radius: 3 },
      itemMargin: { horizontal: 6, vertical: 2 },
    },
    plotOptions: {
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            name: { color: theme.muted, fontSize: "12px" },
            value: { color: theme.text, fontSize: "18px", fontWeight: 700 },
            total: {
              show: true,
              label: totalLabel,
              color: theme.muted,
              fontSize: "12px",
              formatter: () => totalValue,
            },
          },
        },
      },
    },
  };
}
