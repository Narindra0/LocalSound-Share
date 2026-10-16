'use strict';
function panelBounds(width, height, expanded = false) {
  const margin = 16;
  const panelWidth = Math.max(1, Math.min(expanded ? 1080 : 460, width - margin * 2));
  const panelHeight = Math.max(1, Math.min(expanded ? 730 : 410, height - 100));
  return {
    x: expanded ? Math.round((width - panelWidth) / 2) : Math.max(0, width - panelWidth - margin),
    y: expanded ? Math.max(60, Math.round((height - panelHeight) / 2)) : Math.max(0, height - panelHeight - 40),
    width: panelWidth, height: panelHeight
  };
}
module.exports = { panelBounds };
