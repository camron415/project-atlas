import { updateWidgetSnapshot, type WidgetSnapshot } from "atlas-widget-status";

export type { WidgetSnapshot };

export function syncWidgetSnapshot(snapshot: WidgetSnapshot): void {
  void updateWidgetSnapshot(snapshot);
}
