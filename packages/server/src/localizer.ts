/**
 * Localizer: for an inference capture (no calibration label), load the active
 * model for the target AP, estimate position, persist + return the result.
 * Returns null when no model exists yet for that AP (system stays empty until
 * a real calibration has been completed — no fallback, no synthetic output).
 */
import { localize, type Capture, type LocalizationResult } from "@ionity/metrification";
import type { Db } from "./db.js";

export class Localizer {
  constructor(private readonly db: Db) {}

  process(capture: Capture, minConfidence: number): LocalizationResult | null {
    const model = this.db.getActiveModel(capture.ap.bssid);
    if (!model) return null;

    const result = localize(model, capture);
    if (result.confidence < minConfidence) return null;

    this.db.insertLocalization(capture.ap.bssid, result);
    return result;
  }
}
