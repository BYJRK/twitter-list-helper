export function menuPosition(anchor: { left: number; top: number; bottom: number }, width: number, height: number, viewport: { width: number; height: number }): { left: number; top: number; maxHeight: number } {
  const margin = 12;
  const gap = 6;
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const upward = below < Math.min(height, 220) && above > below;
  const maxHeight = Math.min(upward ? above : below, viewport.height - margin * 2);
  const actualHeight = Math.min(height, maxHeight);
  const top = upward ? anchor.top - gap - actualHeight : anchor.bottom + gap;
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - actualHeight - margin)),
    maxHeight: Math.max(0, maxHeight)
  };
}
